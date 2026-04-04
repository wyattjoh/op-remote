# @wyattjoh/op-remote

CLI and MCP server for remote 1Password secret access with Telegram-based
approval. Designed for AI agents (Claude Code, etc.) that need secrets at
runtime without exposing them in plaintext config files or conversation context.

## How it works

1. The **MCP server** (`op-remote serve`) runs as a stdio MCP server, loaded
   with the real secrets via `op run`. It exposes a `request_token` tool that
   returns a one-time token and Unix socket path.
2. The **CLI** (`op-remote run`) is called by the agent with the token, a
   `.env.tpl` file containing `op://` references, and the command to run. It
   connects to the MCP server's Unix socket to request the resolved secrets.
3. The MCP server sends a **Telegram approval request** with inline buttons
   (Approve, Reject, Auto-Approve, Stop). The approver can also reply with a
   reason when rejecting.
4. On approval, secrets are injected into the subprocess environment. All
   stdout/stderr output is **masked** to prevent secret leakage.

## Install

```bash
npm install -g @wyattjoh/op-remote
```

Or with Bun:

```bash
bun install -g @wyattjoh/op-remote
```

## Configuration

### Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `REMOTE_OP_TELEGRAM_BOT_TOKEN` | Yes | Telegram bot token for sending approval requests |
| `REMOTE_OP_TELEGRAM_CHAT_ID` | Yes | Telegram chat ID to send approval messages to |
| `REMOTE_OP_TELEGRAM_APPROVER_IDS` | No | Comma-separated Telegram user IDs allowed to approve/reject (all users if unset) |
| `REMOTE_OP_TIMEOUT` | No | Approval timeout in seconds (default: `120`) |

The MCP server also needs the actual secrets loaded into its environment (the
ones referenced by `op://` URIs in your `.env.tpl` files). Use `op run` to
inject them.

### Env file format (`.env.tpl`)

The CLI reads a `.env.tpl` file that distinguishes secrets from plain config:

```
# Plain values are passed through directly
DATABASE_HOST=localhost
DATABASE_PORT=5432

# op:// references are resolved via the MCP server
DATABASE_PASSWORD=op://Development/my-app-db/password
API_KEY=op://Development/my-app-api/credential
```

Lines with `op://` values become secret requests. All other key-value pairs are
injected as plain environment variables. Comments and blank lines are ignored.

## MCP client configuration

### Claude Code (`.mcp.json`)

Add to your project's `.mcp.json` or `~/.claude/.mcp.json`:

```json
{
  "mcpServers": {
    "op-remote": {
      "command": "op-remote",
      "args": ["serve"],
      "env": {
        "REMOTE_OP_TELEGRAM_BOT_TOKEN": "your-bot-token",
        "REMOTE_OP_TELEGRAM_CHAT_ID": "your-chat-id",
        "DATABASE_PASSWORD": "the-actual-secret-value"
      }
    }
  }
}
```

### Using 1Password CLI (recommended)

Use `op run` so secrets never touch config files:

```json
{
  "mcpServers": {
    "op-remote": {
      "command": "op",
      "args": ["run", "--env-file=.env.tpl", "--", "op-remote", "serve"],
      "env": {
        "REMOTE_OP_TELEGRAM_BOT_TOKEN": "op://Development/op-remote-telegram/bot-token",
        "REMOTE_OP_TELEGRAM_CHAT_ID": "op://Development/op-remote-telegram/chat-id"
      }
    }
  }
}
```

### Claude Code Plugin

op-remote is also available as a Claude Code plugin:

```json
{
  "mcpServers": {
    "op-remote": {
      "command": "npx",
      "args": ["@wyattjoh/op-remote", "serve"]
    }
  }
}
```

## Usage

### Agent workflow

The agent calls the `request_token` MCP tool, then uses the returned token and
socket path to run commands with secrets:

```bash
op-remote run \
  --token=TOKEN \
  --sock=SOCKET_PATH \
  --env-file=.env.tpl \
  --reason="Running database migration" \
  -- npm run migrate
```

### MCP tools

| Tool | Description |
| --- | --- |
| `request_token` | Returns a one-time token and Unix socket path for authenticating with the CLI |
| `resume` | Request to resume a stopped session (requires Telegram approval) |
| `disable_auto_approve` | Turn off auto-approval, requiring Telegram approval for future requests |

### Telegram approval buttons

When a secret access request is sent to Telegram, the approver sees:

- **Approve** - allow this single request
- **Reject** - deny the request (prompts for a reason via reply)
- **Auto-Approve** - approve this and all future requests in the session
- **Stop** - reject and halt the session entirely (the agent is instructed to stop)

## Security

- **One-time tokens** prevent replay attacks. Each token can only be used once.
- **Unix socket permissions** are set to `0600`, restricting access to the current user.
- **Output masking** replaces secret values in stdout/stderr with `<redacted>`.
- **Token reservation** prevents concurrent use of the same token.
- **Approver restrictions** optionally limit who can approve requests via Telegram user IDs.
- **Timeout** ensures abandoned requests don't hang indefinitely.

## Development

```bash
bun install
bun run build              # transpile to dist/ (Node.js target)
bun run lint               # oxlint
bun run fmt                # oxfmt
bun run typecheck          # tsc --noEmit
bun test                   # run tests
```

## License

MIT
