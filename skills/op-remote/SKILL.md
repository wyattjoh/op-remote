---
name: op-remote
description: 'Guides usage of the op-remote MCP server for running commands with 1Password secrets. Triggers when op-remote:request_token tool is available, when running commands that need secrets from .env.tpl, or when encountering "op-remote", "secret access", "op://".'
user-invocable: true
---

# op-remote: Secure Secret Access

Run commands with 1Password secrets injected via Telegram-approved access.
Secrets never enter your context. You see tokens and masked output only.

## Workflow

When you need to run a command that requires secrets from a `.env.tpl` file:

1. **Request a token** by calling the `op-remote:request_token` MCP tool (no arguments)
2. **Parse the response** which contains `{"token": "...", "sock": "..."}`
3. **Run the command** using the CLI:

```bash
op-remote run \
  --token=<token> \
  --sock=<sock> \
  --env-file=.env.tpl \
  --reason="<explain why you need to run this command>" \
  -- <command and args>
```

4. **Wait for approval**: the user will approve or reject via Telegram
5. **Handle the result**: on success you get stdout/stderr (secrets masked), on rejection you get an error

## The `--reason` Flag

Always provide a clear, specific reason. The user sees this on their phone and uses it to decide whether to approve. Good reasons:

- "Running e2e tests to verify the auth flow fix from commit abc123"
- "Starting the dev server to test the new API endpoint"
- "Executing database migration for the users table schema change"

Bad reasons:

- "Running a command"
- "Need secrets"
- "Testing"

## Handling Errors

### "Session has been stopped by the user"

The `op-remote:request_token` tool returns this when the user tapped **Stop** in Telegram. **You must immediately stop what you are doing and wait for the user to give you further instructions.** Do not retry, do not attempt workarounds.

### "Rejected: <reason>"

The user denied the request. Read the reason they provided. It may contain instructions (e.g., "don't run tests right now, focus on the linting issues instead"). Adjust your approach accordingly.

### "permission request timed out"

The user didn't respond within the timeout window. They may be unavailable. Wait and ask the user if they'd like you to retry.

## Other MCP Tools

### `op-remote:resume`

Only call this when the **user explicitly asks** you to resume after a stop. Do not call it on your own initiative. It requires Telegram approval.

### `op-remote:disable_auto_approve`

Only call this when the **user explicitly asks** to disable auto-approval. This re-enables per-request Telegram approval for subsequent commands.

## Security Rules

- **Never** attempt to read the Unix socket path directly or connect to it outside of `op-remote run`
- **Never** try to extract secret values from masked output
- **Never** call `op-remote:resume` without explicit user instruction
- **Never** call `op-remote:disable_auto_approve` without explicit user instruction
- The `--reason` flag is visible to the user; be honest about what you are doing and why
