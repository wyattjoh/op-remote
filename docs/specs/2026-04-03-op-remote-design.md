# op-remote Design Spec

## Overview

`op-remote` is a Bun/TypeScript CLI tool that enables remote approval of 1Password secret access via Telegram. It acts as a bridge between Claude Code (or other AI agents) and 1Password secrets, ensuring secrets never cross the boundary back to the calling agent.

The tool operates in two modes from a single npm package (`@wyattjoh/op-remote`):

- **`op-remote serve`**: MCP server that holds resolved secrets in memory and gates access via Telegram approval
- **`op-remote run`**: CLI that requests secrets from the running MCP server and injects them into a subprocess

## Problem

When running Claude Code remotely, `op run` requires biometric approval (Touch ID, etc.) which isn't possible without physical presence. Service accounts solve the auth problem but grant broad vault access with no per-invocation approval. We need per-invocation approval routed to Telegram, with secrets never exposed to the AI agent.

## Architecture

### Startup Flow

1. Claude Code session starts
2. `.mcp.json` config starts `op run --env-file .env.tpl -- op-remote serve`
3. `op` prompts for biometrics (user is present at session start), resolves all `op://` references
4. `op-remote serve` starts with all secrets resolved in its process environment
5. MCP server opens Unix socket, registers MCP tools, is ready

### Runtime Flow

```
Claude Code                    MCP Server (op-remote serve)     CLI (op-remote run)      Telegram
    |                               |                              |                      |
    |  1. MCP tool:                 |                              |                      |
    |     request_token()           |                              |                      |
    |     (no args)                 |                              |                      |
    |------------------------------>|                              |                      |
    |                               |  check: stopped?             |                      |
    |  2. {token, sock}             |                              |                      |
    |<------------------------------|                              |                      |
    |                               |                              |                      |
    |  3. Bash: op-remote run       |                              |                      |
    |     --token=abc123            |                              |                      |
    |     --sock=/tmp/...           |                              |                      |
    |     --env-file=.env.tpl       |                              |                      |
    |     --reason="Running e2e..." |                              |                      |
    |     -- npm test               |                              |                      |
    |------------------------------------------------------------>|                      |
    |                               |                              |                      |
    |                               |  4. Unix socket connect:     |                      |
    |                               |     {token, env_vars,        |                      |
    |                               |      command, cwd, reason}   |                      |
    |                               |<-----------------------------|                      |
    |                               |                              |                      |
    |                               |  5. Validate token           |                      |
    |                               |     (single-use, TTL, UID)   |                      |
    |                               |                              |                      |
    |                               |     if autoApprove: skip to 8|                      |
    |                               |                              |                      |
    |                               |  6. Connect to Telegram,     |                      |
    |                               |     send approval message    |                      |
    |                               |     with inline keyboard     |                      |
    |                               |---------------------------------------------------->|
    |                               |                              |                      |
    |                               |  7. Long-poll for response   |               user   |
    |                               |     (or timeout)             |               taps   |
    |                               |<----------------------------------------------------|
    |                               |                              |                      |
    |                               |  8. Disconnect from Telegram |                      |
    |                               |                              |                      |
    |                               |  9. Send resolved secrets    |                      |
    |                               |     (or rejection) over socket                      |
    |                               |---------------------------->|                      |
    |                               |                              |                      |
    |                               |                              |  10. Merge env,      |
    |                               |                              |      launch subprocess|
    |                               |                              |      pipe stdio      |
    |                               |                              |                      |
    |  11. stdout/stderr (secrets masked)                          |                      |
    |<------------------------------------------------------------|                      |
```

## Binary & Subcommands

### `op-remote serve`

MCP server mode. Started by Claude Code via `.mcp.json` wrapped in `op run --env-file=.env.tpl`.

- Holds resolved secrets in process environment
- Opens Unix socket at `/tmp/op-remote/<random-uuid>.sock` (0600 permissions)
- Exposes MCP tools for token management
- Handles Telegram approval on demand (connect-poll-disconnect per request)
- Telegram config via env vars from `.mcp.json` `env` block

### `op-remote run`

CLI mode. Invoked by Claude Code (or shell scripts) to run a command with secrets.

```
op-remote run \
  --token=<from MCP> \
  --sock=<from MCP> \
  --env-file=.env.tpl \
  --reason="Running e2e tests to verify auth flow fix" \
  -- npm test
```

**Flow:**

1. Parse `--env-file`: extract env var names where value starts with `op://`
2. Connect to Unix socket at `--sock`
3. Send JSON request: `{token, env_vars, command, cwd, reason}`
4. Wait for response (blocks until Telegram approval, rejection, or timeout)
5. On approved: merge resolved secrets into inherited environment, launch subprocess, pipe stdio
6. On rejected: print reason to stderr, exit non-zero

### `.mcp.json` Configuration

```json
{
  "mcpServers": {
    "op-remote": {
      "command": "op",
      "args": ["run", "--env-file", ".env.tpl", "--", "op-remote", "serve"],
      "env": {
        "REMOTE_OP_TELEGRAM_BOT_TOKEN": "op://Development/op-remote/telegram-bot-token",
        "REMOTE_OP_TELEGRAM_CHAT_ID": "op://Development/op-remote/telegram-chat-id",
        "REMOTE_OP_TIMEOUT": "120"
      }
    }
  }
}
```

## MCP Server Internals

### State

- `stopped: bool` - set to `true` when user taps Stop. Cleared via `resume` tool (requires Telegram approval).
- `autoApprove: bool` - set to `true` when user taps Auto-Approve. Cleared via `disable_auto_approve` tool.

### MCP Tools

| Tool                   | Arguments | Behavior                                                                                                                                                                                                            |
| ---------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `request_token`        | none      | If stopped: return error instructing agent to stop and wait for user instructions. Otherwise: generate single-use token (UUID, TTL default 120s), return `{token, sock}`                                            |
| `resume`               | none      | If not stopped: return "session is not stopped". Otherwise: send Telegram approval request. On approve: set `stopped = false`, return confirmation. On reject: keep `stopped = true`, return rejection with reason. |
| `disable_auto_approve` | none      | Sets `autoApprove = false`. Returns confirmation.                                                                                                                                                                   |

`resume` and `disable_auto_approve` should only be invoked when the user explicitly asks.

### Socket Protocol

**Request (CLI to server):**

```json
{
  "token": "abc123-...",
  "env_vars": ["CLERK_PLATFORM_API_KEY", "TEST_CLERK_APP_ID"],
  "command": "npm test",
  "cwd": "/Users/wyatt/Code/clerk/cli-new",
  "reason": "Running e2e tests to verify auth flow fix"
}
```

**Server validation:**

1. Token exists, not expired, not already used. Invalidate immediately.
2. Peer UID matches server UID (defense in depth).
3. All requested env var names exist in server's environment.

**Response (server to CLI):**

Approved:

```json
{
  "status": "approved",
  "env": {
    "CLERK_PLATFORM_API_KEY": "sk_live_abc...",
    "TEST_CLERK_APP_ID": "app_2x7f..."
  }
}
```

Rejected:

```json
{
  "status": "rejected",
  "reason": "permission request timed out"
}
```

On rejection, the MCP server also sends a `logging/message` notification to Claude Code with the rejection reason.

## Telegram Approval Flow

### Connection Lifecycle

Connect to Telegram Bot API and start long-polling only when an approval is needed. Disconnect as soon as the response (or timeout) is received. No persistent connection.

### Run Approval Message

```
🔑 Secret access request

Reason: Running e2e tests to verify auth flow fix

Command: npm test
Working dir: /Users/wyatt/Code/clerk/cli-new
Secrets:
  - CLERK_PLATFORM_API_KEY
  - TEST_CLERK_APP_ID

[Approve] [Reject]
[Auto-Approve] [Stop]
```

### Resume Approval Message

```
🔄 Resume request

Agent is requesting to resume the session.

[Approve] [Reject]
```

### Button Behaviors

| Button       | Effect                                                                                                      | Appears on  |
| ------------ | ----------------------------------------------------------------------------------------------------------- | ----------- |
| Approve      | Resolve secrets, send to CLI. Edit message to show "Approved at HH:MM"                                      | Run, Resume |
| Reject       | Prompt user for rejection reason (force reply). Send reason to CLI. Edit message to show "Rejected: reason" | Run, Resume |
| Auto-Approve | Set `autoApprove = true`, then same as Approve. Edit message to show "Auto-approved at HH:MM"               | Run only    |
| Stop         | Set `stopped = true`, then same as Reject (prompt for reason). Edit message to show "Stopped: reason"       | Run only    |

### Timeout

Default 120s, configurable via `REMOTE_OP_TIMEOUT`. On timeout, auto-reject with reason "permission request timed out". Edit message to show "Timed out".

### Security

- Validate `callback_query.from.id` matches `REMOTE_OP_TELEGRAM_CHAT_ID`
- Unique nonce in `callback_data` per message to prevent replay
- Rejection reason collected via force-reply, matched to the originating request

## CLI Details

### Env File Parsing

Reads the `--env-file` in the same format as `op run` expects. Lines with values starting with `op://` are treated as secret references. The env var name is extracted and sent to the MCP server for resolution.

Non-secret lines (values not starting with `op://`) are applied directly to the subprocess environment.

### Env Merging Precedence (highest to lowest)

1. Resolved secrets from MCP server
2. Non-secret env vars from `--env-file`
3. Inherited environment from parent process

### Secret Masking

stdout/stderr of the subprocess are scanned. Any occurrence of a resolved secret value is replaced with `<redacted>` before being written to the parent's stdout/stderr.

### Exit Codes

- Subprocess exit code on success
- `1` on rejection
- `2` on connection/protocol error (socket not found, invalid token, etc.)

## Security Model

### Trust Boundaries

| Boundary                  | Protection                                                                             |
| ------------------------- | -------------------------------------------------------------------------------------- |
| MCP server process memory | Secrets only exist here. Never sent over MCP stdio.                                    |
| Unix socket               | 0600 permissions, peer UID verification, single-use tokens                             |
| Token lifecycle           | UUID, single-use, TTL (default 120s), invalidated on first use                         |
| Telegram                  | Chat ID validation on callback queries, nonce in callback_data, connect-on-demand only |
| Subprocess                | Secrets in env vars only, masked on stdout/stderr                                      |

### What Claude Code Sees

- One-time tokens (useless after use/expiry)
- Socket path
- Subprocess stdout/stderr (with secrets masked)
- Rejection reasons
- Never the secret values themselves

### What the CLI Sees (Transiently)

- Resolved secret values in memory, only long enough to set up subprocess env
- After exec, the CLI process is replaced by the subprocess

### What Other Processes See

- Unix socket exists but requires a valid token to get anything from it
- Tokens can only be minted via MCP stdio (only Claude Code has access)
- Even if a process finds the socket and guesses a token UUID, the token is single-use and short-lived

### Threat Model

| Threat                                | Mitigation                                                                               |
| ------------------------------------- | ---------------------------------------------------------------------------------------- |
| Agent exfiltrates secrets from stdout | Secret masking on CLI output                                                             |
| Agent calls `resume` to bypass Stop   | `resume` requires Telegram approval                                                      |
| Rogue process connects to socket      | Needs valid token (only mintable via MCP) + peer UID check                               |
| Token replay                          | Single-use, invalidated immediately                                                      |
| Telegram account compromise           | Chat ID validation, accepted risk                                                        |
| Telegram downtime                     | Timeout rejects, agent gets clear error                                                  |
| MCP server crash                      | Socket cleaned up, tokens invalidated. CLI gets connection error.                        |
| Stale socket from previous crash      | Server checks for stale socket on startup (try connect, if refused, unlink and recreate) |

## Tech Stack

- **Runtime:** Bun (TypeScript)
- **Distribution:** npm package `@wyattjoh/op-remote`, invoked via `bunx`/`npx`/`pnpm dlx`
- **MCP SDK:** `@modelcontextprotocol/sdk` (official TypeScript SDK)
- **Telegram:** Raw `fetch` to Bot API (only 4-5 endpoints needed)
- **Unix sockets:** `node:net` module
- **Process execution:** `Bun.spawn` or `node:child_process`
- **Env file parsing:** Custom parser (simple key=value format)

## Project Structure

```
op-remote/
├── .claude-plugin/
│   └── plugin.json           # Claude Code plugin manifest
├── skills/
│   └── op-remote/
│       └── SKILL.md          # Claude Code skill for op-remote workflow
├── src/
│   ├── cli.ts               # CLI entrypoint, subcommand routing
│   ├── serve/
│   │   ├── server.ts         # MCP server, tool handlers, state management
│   │   ├── socket.ts         # Unix socket listener, token validation, protocol
│   │   └── telegram.ts       # Telegram bot API, approval flow, long polling
│   ├── run/
│   │   ├── client.ts         # Socket client, sends request, receives response
│   │   ├── envfile.ts        # .env.tpl parser, extracts op:// references
│   │   └── exec.ts           # Subprocess launch, env merging, secret masking
│   └── protocol.ts           # Shared types: Request, Response, status codes
├── test/
│   ├── envfile.test.ts       # Env file parser tests
│   ├── token.test.ts         # Token store tests
│   ├── masking.test.ts       # Secret masking tests
│   └── socket.test.ts        # Socket protocol tests
├── package.json
├── tsconfig.json
└── biome.json
```

### Invocation

```bash
# MCP server (in .mcp.json)
op run --env-file .env.tpl -- bunx @wyattjoh/op-remote serve

# CLI
bunx @wyattjoh/op-remote run --token=... --sock=... --env-file=.env.tpl --reason="..." -- npm test
```
