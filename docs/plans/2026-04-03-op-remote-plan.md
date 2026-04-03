# op-remote Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Bun/TypeScript CLI tool that gates 1Password secret access behind Telegram approval, operating as both an MCP server and a CLI.

**Architecture:** Single npm package `@wyattjoh/op-remote` with two subcommands. `serve` runs as an MCP server holding resolved secrets in memory, exposing tools for token management. `run` is a CLI that connects to the running server via Unix socket, requests secrets with a one-time token, and launches a subprocess with them injected as env vars. Telegram approval is on-demand (connect-poll-disconnect per request).

**Tech Stack:** Bun, TypeScript, `@modelcontextprotocol/sdk` (MCP server), raw `fetch` (Telegram Bot API), `node:net` (Unix sockets), `node:child_process` (subprocess exec), `zod` (schema validation)

**Spec:** `docs/specs/2026-04-03-op-remote-design.md`

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `biome.json`
- Create: `src/cli.ts`
- Create: `.gitignore`

- [ ] **Step 1: Initialize project**

```bash
cd /Users/wyatt.johnson/Code/github.com/wyattjoh/remote-op
bun init -y
```

- [ ] **Step 2: Write package.json**

```json
{
  "name": "@wyattjoh/op-remote",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "op-remote": "./src/cli.ts"
  },
  "files": ["src"],
  "scripts": {
    "test": "bun test",
    "check": "bunx @biomejs/biome check --write .",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.0",
    "zod": "^3.25.0"
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9.0",
    "@types/bun": "latest",
    "typescript": "^5.8.0"
  }
}
```

- [ ] **Step 3: Write tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["bun"]
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Write biome.json**

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.0/schema.json",
  "organizeImports": { "enabled": true },
  "linter": { "enabled": true },
  "formatter": {
    "enabled": true,
    "indentStyle": "tab"
  }
}
```

- [ ] **Step 5: Write .gitignore**

```
node_modules/
dist/
*.tsbuildinfo
```

- [ ] **Step 6: Write CLI entrypoint stub**

Create `src/cli.ts`:

```typescript
#!/usr/bin/env bun

const [subcommand] = process.argv.slice(2);

switch (subcommand) {
	case "serve":
		console.error("serve: not yet implemented");
		process.exit(1);
		break;
	case "run":
		console.error("run: not yet implemented");
		process.exit(1);
		break;
	default:
		console.error("Usage: op-remote <serve|run>");
		process.exit(1);
}
```

- [ ] **Step 7: Install dependencies and verify**

```bash
bun install
bun run typecheck
bun src/cli.ts
```

Expected: prints "Usage: op-remote <serve|run>" and exits 1.

- [ ] **Step 8: Commit**

```bash
git add package.json tsconfig.json biome.json src/cli.ts .gitignore bun.lock
git commit -m "feat: scaffold op-remote project with Bun"
```

---

### Task 2: Protocol Types

**Files:**
- Create: `src/protocol.ts`

- [ ] **Step 1: Write protocol types**

Create `src/protocol.ts`:

```typescript
/** Sent by the CLI to the MCP server over the Unix socket. */
export interface SocketRequest {
	token: string;
	envVars: string[];
	command: string[];
	cwd: string;
	reason: string;
}

/** Sent by the MCP server back to the CLI over the Unix socket. */
export interface SocketResponse {
	status: "approved" | "rejected";
	env?: Record<string, string>;
	reason?: string;
}

/** Returned by the request_token MCP tool. */
export interface TokenResult {
	token: string;
	sock: string;
}

/** Exit codes for the CLI. */
export const EXIT_REJECTED = 1;
export const EXIT_PROTOCOL_ERROR = 2;
```

- [ ] **Step 2: Run typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/protocol.ts
git commit -m "feat: add shared protocol types for socket communication"
```

---

### Task 3: Env File Parser (TDD)

**Files:**
- Create: `src/run/envfile.ts`
- Create: `test/envfile.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/envfile.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { parseEnvFile } from "../src/run/envfile.ts";

describe("parseEnvFile", () => {
	test("extracts op:// references as secret vars", () => {
		const content = [
			'CLERK_API_KEY="op://AI Enablement/Clerk/key"',
			'APP_ID="op://Development/app/id"',
		].join("\n");

		const result = parseEnvFile(content);

		expect(result.secretVars).toEqual([
			"CLERK_API_KEY",
			"APP_ID",
		]);
		expect(result.plainVars).toEqual({});
	});

	test("extracts plain vars separately", () => {
		const content = [
			"APP_URL=https://example.com",
			'SECRET="op://Dev/item/field"',
		].join("\n");

		const result = parseEnvFile(content);

		expect(result.secretVars).toEqual(["SECRET"]);
		expect(result.plainVars).toEqual({ APP_URL: "https://example.com" });
	});

	test("skips comments and blank lines", () => {
		const content = [
			"# this is a comment",
			"",
			"  # indented comment",
			'KEY="op://Vault/item/field"',
		].join("\n");

		const result = parseEnvFile(content);

		expect(result.secretVars).toEqual(["KEY"]);
		expect(result.plainVars).toEqual({});
	});

	test("handles unquoted values", () => {
		const content = "KEY=op://Vault/item/field";
		const result = parseEnvFile(content);
		expect(result.secretVars).toEqual(["KEY"]);
	});

	test("handles single-quoted values", () => {
		const content = "KEY='op://Vault/item/field'";
		const result = parseEnvFile(content);
		expect(result.secretVars).toEqual(["KEY"]);
	});

	test("handles export prefix", () => {
		const content = 'export KEY="op://Vault/item/field"';
		const result = parseEnvFile(content);
		expect(result.secretVars).toEqual(["KEY"]);
	});

	test("returns empty for empty file", () => {
		const result = parseEnvFile("");
		expect(result.secretVars).toEqual([]);
		expect(result.plainVars).toEqual({});
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test test/envfile.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement parseEnvFile**

Create `src/run/envfile.ts`:

```typescript
export interface ParsedEnvFile {
	/** Env var names whose values are op:// references. */
	secretVars: string[];
	/** Env vars with plain (non-secret) values. */
	plainVars: Record<string, string>;
}

export function parseEnvFile(content: string): ParsedEnvFile {
	const secretVars: string[] = [];
	const plainVars: Record<string, string> = {};

	for (const rawLine of content.split("\n")) {
		const line = rawLine.trim();
		if (line === "" || line.startsWith("#")) {
			continue;
		}

		// Strip optional "export " prefix.
		const stripped = line.startsWith("export ")
			? line.slice(7).trim()
			: line;

		const eqIdx = stripped.indexOf("=");
		if (eqIdx === -1) {
			continue;
		}

		const key = stripped.slice(0, eqIdx).trim();
		const rawValue = stripped.slice(eqIdx + 1).trim();

		// Remove surrounding quotes (single or double).
		const value = rawValue.replace(/^(['"])(.*)\1$/, "$2");

		if (value.startsWith("op://")) {
			secretVars.push(key);
		} else {
			plainVars[key] = value;
		}
	}

	return { secretVars, plainVars };
}

export async function readEnvFile(path: string): Promise<ParsedEnvFile> {
	const content = await Bun.file(path).text();
	return parseEnvFile(content);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test test/envfile.test.ts
```

Expected: all 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/run/envfile.ts test/envfile.test.ts
git commit -m "feat: add env file parser with op:// reference detection"
```

---

### Task 4: Token Store (TDD)

**Files:**
- Create: `src/serve/tokens.ts`
- Create: `test/tokens.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/tokens.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { TokenStore } from "../src/serve/tokens.ts";

describe("TokenStore", () => {
	test("generates and validates a token", () => {
		const store = new TokenStore(60_000);
		const token = store.create();

		expect(typeof token).toBe("string");
		expect(token.length).toBeGreaterThan(0);
		expect(store.validate(token)).toBe(true);
	});

	test("invalidates token after first use", () => {
		const store = new TokenStore(60_000);
		const token = store.create();

		expect(store.consume(token)).toBe(true);
		expect(store.consume(token)).toBe(false);
		expect(store.validate(token)).toBe(false);
	});

	test("rejects unknown tokens", () => {
		const store = new TokenStore(60_000);
		expect(store.validate("nonexistent")).toBe(false);
		expect(store.consume("nonexistent")).toBe(false);
	});

	test("rejects expired tokens", async () => {
		const store = new TokenStore(50); // 50ms TTL
		const token = store.create();

		await Bun.sleep(100);

		expect(store.validate(token)).toBe(false);
		expect(store.consume(token)).toBe(false);
	});

	test("multiple tokens are independent", () => {
		const store = new TokenStore(60_000);
		const t1 = store.create();
		const t2 = store.create();

		expect(store.consume(t1)).toBe(true);
		expect(store.validate(t2)).toBe(true);
		expect(store.consume(t2)).toBe(true);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test test/tokens.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement TokenStore**

Create `src/serve/tokens.ts`:

```typescript
import { randomUUID } from "node:crypto";

export class TokenStore {
	private tokens = new Map<string, number>();
	private ttlMs: number;

	constructor(ttlMs: number) {
		this.ttlMs = ttlMs;
	}

	create(): string {
		const token = randomUUID();
		this.tokens.set(token, Date.now() + this.ttlMs);
		return token;
	}

	validate(token: string): boolean {
		const expiry = this.tokens.get(token);
		if (expiry === undefined) {
			return false;
		}
		if (Date.now() > expiry) {
			this.tokens.delete(token);
			return false;
		}
		return true;
	}

	consume(token: string): boolean {
		if (!this.validate(token)) {
			return false;
		}
		this.tokens.delete(token);
		return true;
	}
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test test/tokens.test.ts
```

Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/serve/tokens.ts test/tokens.test.ts
git commit -m "feat: add single-use token store with TTL expiry"
```

---

### Task 5: Secret Masking (TDD)

**Files:**
- Create: `src/run/masking.ts`
- Create: `test/masking.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/masking.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { createMasker } from "../src/run/masking.ts";

describe("createMasker", () => {
	test("replaces secret values with <redacted>", () => {
		const mask = createMasker(["sk_live_abc123", "app_2x7f"]);
		expect(mask("token is sk_live_abc123 here")).toBe(
			"token is <redacted> here",
		);
	});

	test("replaces multiple secrets in one line", () => {
		const mask = createMasker(["secret1", "secret2"]);
		expect(mask("a=secret1 b=secret2")).toBe("a=<redacted> b=<redacted>");
	});

	test("replaces all occurrences of a secret", () => {
		const mask = createMasker(["abc"]);
		expect(mask("abc and abc again")).toBe(
			"<redacted> and <redacted> again",
		);
	});

	test("handles no secrets", () => {
		const mask = createMasker([]);
		expect(mask("nothing to mask")).toBe("nothing to mask");
	});

	test("handles empty string input", () => {
		const mask = createMasker(["secret"]);
		expect(mask("")).toBe("");
	});

	test("escapes regex special characters in secrets", () => {
		const mask = createMasker(["secret.with+special(chars)"]);
		expect(mask("val: secret.with+special(chars) end")).toBe(
			"val: <redacted> end",
		);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test test/masking.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement createMasker**

Create `src/run/masking.ts`:

```typescript
function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function createMasker(secrets: string[]): (input: string) => string {
	if (secrets.length === 0) {
		return (input) => input;
	}

	const pattern = new RegExp(
		secrets.map(escapeRegExp).join("|"),
		"g",
	);

	return (input: string) => input.replace(pattern, "<redacted>");
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test test/masking.test.ts
```

Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/run/masking.ts test/masking.test.ts
git commit -m "feat: add secret masking for subprocess output"
```

---

### Task 6: Telegram Client

**Files:**
- Create: `src/serve/telegram.ts`

- [ ] **Step 1: Write the Telegram client**

Create `src/serve/telegram.ts`:

```typescript
const API_BASE = "https://api.telegram.org/bot";

interface TelegramConfig {
	botToken: string;
	chatId: string;
	timeoutMs: number;
}

interface InlineButton {
	text: string;
	callbackData: string;
}

interface ApprovalResult {
	action: "approve" | "reject" | "auto_approve" | "stop";
	reason?: string;
}

async function apiCall<T>(
	token: string,
	method: string,
	body: Record<string, unknown>,
): Promise<T> {
	const res = await fetch(`${API_BASE}${token}/${method}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	const data = (await res.json()) as { ok: boolean; result: T; description?: string };
	if (!data.ok) {
		throw new Error(`Telegram API error: ${data.description}`);
	}
	return data.result;
}

interface TelegramMessage {
	message_id: number;
	chat: { id: number };
}

interface TelegramUpdate {
	update_id: number;
	callback_query?: {
		id: string;
		from: { id: number };
		message?: TelegramMessage;
		data?: string;
	};
	message?: {
		message_id: number;
		from?: { id: number };
		chat: { id: number };
		text?: string;
		reply_to_message?: TelegramMessage;
	};
}

function buildKeyboard(
	nonce: string,
	buttons: InlineButton[][],
): { inline_keyboard: { text: string; callback_data: string }[][] } {
	return {
		inline_keyboard: buttons.map((row) =>
			row.map((btn) => ({
				text: btn.text,
				callback_data: `${nonce}:${btn.callbackData}`,
			})),
		),
	};
}

export async function requestRunApproval(
	config: TelegramConfig,
	opts: {
		command: string[];
		cwd: string;
		reason: string;
		secretNames: string[];
	},
): Promise<ApprovalResult> {
	const nonce = crypto.randomUUID().slice(0, 8);
	const secretList = opts.secretNames.map((s) => `  - ${s}`).join("\n");
	const text = [
		"\u{1F511} Secret access request",
		"",
		`Reason: ${opts.reason}`,
		"",
		`Command: ${opts.command.join(" ")}`,
		`Working dir: ${opts.cwd}`,
		`Secrets:`,
		secretList,
	].join("\n");

	const keyboard = buildKeyboard(nonce, [
		[
			{ text: "Approve", callbackData: "approve" },
			{ text: "Reject", callbackData: "reject" },
		],
		[
			{ text: "Auto-Approve", callbackData: "auto_approve" },
			{ text: "Stop", callbackData: "stop" },
		],
	]);

	const sent = await apiCall<TelegramMessage>(config.botToken, "sendMessage", {
		chat_id: config.chatId,
		text,
		reply_markup: keyboard,
	});

	return pollForResponse(config, sent.message_id, nonce);
}

export async function requestResumeApproval(
	config: TelegramConfig,
): Promise<ApprovalResult> {
	const nonce = crypto.randomUUID().slice(0, 8);
	const text = [
		"\u{1F504} Resume request",
		"",
		"Agent is requesting to resume the session.",
	].join("\n");

	const keyboard = buildKeyboard(nonce, [
		[
			{ text: "Approve", callbackData: "approve" },
			{ text: "Reject", callbackData: "reject" },
		],
	]);

	const sent = await apiCall<TelegramMessage>(config.botToken, "sendMessage", {
		chat_id: config.chatId,
		text,
		reply_markup: keyboard,
	});

	return pollForResponse(config, sent.message_id, nonce);
}

async function pollForResponse(
	config: TelegramConfig,
	messageId: number,
	nonce: string,
): Promise<ApprovalResult> {
	const deadline = Date.now() + config.timeoutMs;
	let offset = 0;

	while (Date.now() < deadline) {
		const remainingMs = deadline - Date.now();
		const pollTimeout = Math.min(Math.floor(remainingMs / 1000), 30);
		if (pollTimeout <= 0) {
			break;
		}

		const updates = await apiCall<TelegramUpdate[]>(
			config.botToken,
			"getUpdates",
			{ offset, timeout: pollTimeout },
		);

		for (const update of updates) {
			offset = update.update_id + 1;

			// Handle callback query (button press).
			if (update.callback_query?.data?.startsWith(`${nonce}:`)) {
				const action = update.callback_query.data.slice(nonce.length + 1);

				await apiCall(config.botToken, "answerCallbackQuery", {
					callback_query_id: update.callback_query.id,
				});

				if (action === "approve" || action === "auto_approve") {
					const label =
						action === "auto_approve" ? "Auto-approved" : "Approved";
					await apiCall(config.botToken, "editMessageText", {
						chat_id: config.chatId,
						message_id: messageId,
						text: `\u2705 ${label} at ${new Date().toLocaleTimeString()}`,
					});
					return { action: action as ApprovalResult["action"] };
				}

				// Reject or Stop: ask for reason via force reply.
				const label = action === "stop" ? "Stopped" : "Rejected";
				await apiCall(config.botToken, "editMessageText", {
					chat_id: config.chatId,
					message_id: messageId,
					text: `\u274C ${label}. Reply with a reason:`,
					reply_markup: {
						force_reply: true,
						selective: true,
					},
				});

				// Poll for the text reply.
				const reason = await pollForTextReply(
					config,
					messageId,
					offset,
					deadline,
				);

				await apiCall(config.botToken, "editMessageText", {
					chat_id: config.chatId,
					message_id: messageId,
					text: `\u274C ${label}: ${reason}`,
				});

				return {
					action: action as ApprovalResult["action"],
					reason,
				};
			}
		}
	}

	// Timeout: edit message and reject.
	await apiCall(config.botToken, "editMessageText", {
		chat_id: config.chatId,
		message_id: messageId,
		text: "\u23F0 Timed out",
	}).catch(() => {});

	return { action: "reject", reason: "permission request timed out" };
}

async function pollForTextReply(
	config: TelegramConfig,
	originalMessageId: number,
	startOffset: number,
	deadline: number,
): Promise<string> {
	let offset = startOffset;

	while (Date.now() < deadline) {
		const remainingMs = deadline - Date.now();
		const pollTimeout = Math.min(Math.floor(remainingMs / 1000), 30);
		if (pollTimeout <= 0) {
			break;
		}

		const updates = await apiCall<TelegramUpdate[]>(
			config.botToken,
			"getUpdates",
			{ offset, timeout: pollTimeout },
		);

		for (const update of updates) {
			offset = update.update_id + 1;

			if (
				update.message?.reply_to_message?.message_id === originalMessageId &&
				update.message.text
			) {
				return update.message.text;
			}
		}
	}

	return "(no reason provided)";
}
```

- [ ] **Step 2: Run typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/serve/telegram.ts
git commit -m "feat: add Telegram approval client with inline keyboards"
```

---

### Task 7: Unix Socket Server

**Files:**
- Create: `src/serve/socket.ts`

- [ ] **Step 1: Write the socket server**

Create `src/serve/socket.ts`:

```typescript
import { createServer, type Socket as NetSocket } from "node:net";
import { mkdirSync, chmodSync, unlinkSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { SocketRequest, SocketResponse } from "../protocol.ts";
import type { TokenStore } from "./tokens.ts";

export interface SocketHandler {
	handleRequest(req: SocketRequest): Promise<SocketResponse>;
}

export function createSocketServer(
	tokens: TokenStore,
	handler: SocketHandler,
): { sockPath: string; close: () => void } {
	const dir = `${process.env.TMPDIR ?? "/tmp"}/op-remote`;
	mkdirSync(dir, { recursive: true });

	const sockPath = `${dir}/${randomUUID()}.sock`;

	// Clean up stale socket if present.
	if (existsSync(sockPath)) {
		unlinkSync(sockPath);
	}

	const server = createServer((conn) => {
		handleConnection(conn, tokens, handler);
	});

	server.listen(sockPath, () => {
		chmodSync(sockPath, 0o600);
	});

	const close = () => {
		server.close();
		try {
			unlinkSync(sockPath);
		} catch {
			// Already cleaned up.
		}
	};

	// Clean up on process exit.
	process.on("exit", close);
	process.on("SIGINT", () => {
		close();
		process.exit(0);
	});
	process.on("SIGTERM", () => {
		close();
		process.exit(0);
	});

	return { sockPath, close };
}

function handleConnection(
	conn: NetSocket,
	tokens: TokenStore,
	handler: SocketHandler,
): void {
	const chunks: Buffer[] = [];

	conn.on("data", (chunk) => {
		chunks.push(chunk);
	});

	conn.on("end", async () => {
		try {
			const raw = Buffer.concat(chunks).toString("utf-8");
			const req = JSON.parse(raw) as SocketRequest;

			// Validate token (single-use).
			if (!tokens.consume(req.token)) {
				const res: SocketResponse = {
					status: "rejected",
					reason: "invalid or expired token",
				};
				conn.end(JSON.stringify(res));
				return;
			}

			// Validate peer UID (defense in depth).
			// node:net doesn't expose SO_PEERCRED on macOS, so we rely on
			// socket file permissions (0600) as the primary guard.

			const response = await handler.handleRequest(req);
			conn.end(JSON.stringify(response));
		} catch (err) {
			const res: SocketResponse = {
				status: "rejected",
				reason: `protocol error: ${err instanceof Error ? err.message : String(err)}`,
			};
			conn.end(JSON.stringify(res));
		}
	});
}
```

- [ ] **Step 2: Run typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/serve/socket.ts
git commit -m "feat: add Unix socket server with token validation"
```

---

### Task 8: Unix Socket Client

**Files:**
- Create: `src/run/client.ts`
- Create: `test/socket.test.ts`

- [ ] **Step 1: Write the socket client**

Create `src/run/client.ts`:

```typescript
import { connect } from "node:net";
import type { SocketRequest, SocketResponse } from "../protocol.ts";

export function sendRequest(
	sockPath: string,
	req: SocketRequest,
): Promise<SocketResponse> {
	return new Promise((resolve, reject) => {
		const conn = connect(sockPath, () => {
			conn.end(JSON.stringify(req));
		});

		const chunks: Buffer[] = [];

		conn.on("data", (chunk) => {
			chunks.push(chunk);
		});

		conn.on("end", () => {
			try {
				const raw = Buffer.concat(chunks).toString("utf-8");
				const res = JSON.parse(raw) as SocketResponse;
				resolve(res);
			} catch (err) {
				reject(new Error(`Failed to parse server response: ${err}`));
			}
		});

		conn.on("error", (err) => {
			reject(new Error(`Socket connection error: ${err.message}`));
		});
	});
}
```

- [ ] **Step 2: Write integration test for socket client + server**

Create `test/socket.test.ts`:

```typescript
import { afterEach, describe, expect, test } from "bun:test";
import { TokenStore } from "../src/serve/tokens.ts";
import {
	createSocketServer,
	type SocketHandler,
} from "../src/serve/socket.ts";
import { sendRequest } from "../src/run/client.ts";
import type { SocketRequest, SocketResponse } from "../src/protocol.ts";

describe("socket client/server", () => {
	let cleanup: (() => void) | undefined;

	afterEach(() => {
		cleanup?.();
		cleanup = undefined;
	});

	test("approved request returns env vars", async () => {
		const tokens = new TokenStore(60_000);
		const token = tokens.create();

		const handler: SocketHandler = {
			async handleRequest(req: SocketRequest): Promise<SocketResponse> {
				return {
					status: "approved",
					env: { MY_SECRET: "resolved_value" },
				};
			},
		};

		const { sockPath, close } = createSocketServer(tokens, handler);
		cleanup = close;

		// Give the server a moment to bind.
		await Bun.sleep(50);

		const res = await sendRequest(sockPath, {
			token,
			envVars: ["MY_SECRET"],
			command: ["echo", "hello"],
			cwd: "/tmp",
			reason: "test",
		});

		expect(res.status).toBe("approved");
		expect(res.env).toEqual({ MY_SECRET: "resolved_value" });
	});

	test("invalid token is rejected", async () => {
		const tokens = new TokenStore(60_000);

		const handler: SocketHandler = {
			async handleRequest(): Promise<SocketResponse> {
				return { status: "approved", env: {} };
			},
		};

		const { sockPath, close } = createSocketServer(tokens, handler);
		cleanup = close;
		await Bun.sleep(50);

		const res = await sendRequest(sockPath, {
			token: "bogus-token",
			envVars: [],
			command: ["true"],
			cwd: "/tmp",
			reason: "test",
		});

		expect(res.status).toBe("rejected");
		expect(res.reason).toContain("invalid or expired token");
	});

	test("token cannot be reused", async () => {
		const tokens = new TokenStore(60_000);
		const token = tokens.create();

		const handler: SocketHandler = {
			async handleRequest(): Promise<SocketResponse> {
				return { status: "approved", env: {} };
			},
		};

		const { sockPath, close } = createSocketServer(tokens, handler);
		cleanup = close;
		await Bun.sleep(50);

		const res1 = await sendRequest(sockPath, {
			token,
			envVars: [],
			command: ["true"],
			cwd: "/tmp",
			reason: "test",
		});
		expect(res1.status).toBe("approved");

		const res2 = await sendRequest(sockPath, {
			token,
			envVars: [],
			command: ["true"],
			cwd: "/tmp",
			reason: "test",
		});
		expect(res2.status).toBe("rejected");
	});
});
```

- [ ] **Step 3: Run tests**

```bash
bun test test/socket.test.ts
```

Expected: all 3 tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/run/client.ts test/socket.test.ts
git commit -m "feat: add Unix socket client with integration tests"
```

---

### Task 9: MCP Server (Tools + State)

**Files:**
- Create: `src/serve/server.ts`

- [ ] **Step 1: Write the MCP server**

Create `src/serve/server.ts`:

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { TokenStore } from "./tokens.ts";
import {
	createSocketServer,
	type SocketHandler,
} from "./socket.ts";
import {
	requestRunApproval,
	requestResumeApproval,
} from "./telegram.ts";
import type { SocketRequest, SocketResponse } from "../protocol.ts";

interface ServerConfig {
	telegramBotToken: string;
	telegramChatId: string;
	timeoutMs: number;
}

function readConfig(): ServerConfig {
	const botToken = process.env.REMOTE_OP_TELEGRAM_BOT_TOKEN;
	const chatId = process.env.REMOTE_OP_TELEGRAM_CHAT_ID;

	if (!botToken) {
		throw new Error("REMOTE_OP_TELEGRAM_BOT_TOKEN is required");
	}
	if (!chatId) {
		throw new Error("REMOTE_OP_TELEGRAM_CHAT_ID is required");
	}

	const timeoutMs =
		Number.parseInt(process.env.REMOTE_OP_TIMEOUT ?? "120", 10) * 1000;

	return { telegramBotToken: botToken, telegramChatId: chatId, timeoutMs };
}

export async function startServer(): Promise<void> {
	const config = readConfig();
	const tokens = new TokenStore(config.timeoutMs);

	// State.
	let stopped = false;
	let autoApprove = false;

	// Socket handler that resolves secrets from process.env.
	const socketHandler: SocketHandler = {
		async handleRequest(req: SocketRequest): Promise<SocketResponse> {
			// Check that all requested env vars exist.
			const missing = req.envVars.filter((v) => !(v in process.env));
			if (missing.length > 0) {
				return {
					status: "rejected",
					reason: `unknown env vars: ${missing.join(", ")}`,
				};
			}

			// If auto-approve is on, skip Telegram.
			if (!autoApprove) {
				const telegramConfig = {
					botToken: config.telegramBotToken,
					chatId: config.telegramChatId,
					timeoutMs: config.timeoutMs,
				};

				const result = await requestRunApproval(telegramConfig, {
					command: req.command,
					cwd: req.cwd,
					reason: req.reason,
					secretNames: req.envVars,
				});

				if (result.action === "auto_approve") {
					autoApprove = true;
				} else if (result.action === "stop") {
					stopped = true;
					return { status: "rejected", reason: result.reason ?? "stopped" };
				} else if (result.action === "reject") {
					return { status: "rejected", reason: result.reason ?? "rejected" };
				}
			}

			// Resolve secrets from own environment.
			const env: Record<string, string> = {};
			for (const name of req.envVars) {
				env[name] = process.env[name]!;
			}

			return { status: "approved", env };
		},
	};

	const { sockPath } = createSocketServer(tokens, socketHandler);

	// MCP server.
	const mcp = new McpServer(
		{ name: "op-remote", version: "0.1.0" },
		{ capabilities: { logging: {} } },
	);

	// Tool: request_token
	mcp.registerTool(
		"request_token",
		{
			title: "Request Token",
			description:
				"Request a one-time token for authenticating with the op-remote CLI. Returns a token and socket path. If the session has been stopped by the user, this will return an error instructing you to stop what you are doing and wait for further instructions from the user.",
			inputSchema: z.object({}),
		},
		async () => {
			if (stopped) {
				return {
					isError: true,
					content: [
						{
							type: "text" as const,
							text: "Session has been stopped by the user. Stop what you are doing and wait for further instructions from the user.",
						},
					],
				};
			}

			const token = tokens.create();
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({ token, sock: sockPath }),
					},
				],
			};
		},
	);

	// Tool: resume
	mcp.registerTool(
		"resume",
		{
			title: "Resume Session",
			description:
				"Request to resume a stopped session. Requires Telegram approval. Only use when the user explicitly asks you to resume.",
			inputSchema: z.object({}),
		},
		async (_input, ctx) => {
			if (!stopped) {
				return {
					content: [
						{ type: "text" as const, text: "Session is not stopped." },
					],
				};
			}

			const telegramConfig = {
				botToken: config.telegramBotToken,
				chatId: config.telegramChatId,
				timeoutMs: config.timeoutMs,
			};

			const result = await requestResumeApproval(telegramConfig);

			if (result.action === "approve") {
				stopped = false;
				return {
					content: [
						{ type: "text" as const, text: "Session resumed." },
					],
				};
			}

			const reason = result.reason ?? "resume denied";
			await ctx.log("warning", `Resume denied: ${reason}`);
			return {
				isError: true,
				content: [
					{
						type: "text" as const,
						text: `Resume denied: ${reason}`,
					},
				],
			};
		},
	);

	// Tool: disable_auto_approve
	mcp.registerTool(
		"disable_auto_approve",
		{
			title: "Disable Auto-Approve",
			description:
				"Disable auto-approval so future secret access requests require Telegram approval again. Only use when the user explicitly asks.",
			inputSchema: z.object({}),
		},
		async () => {
			autoApprove = false;
			return {
				content: [
					{
						type: "text" as const,
						text: "Auto-approve disabled. Future requests will require Telegram approval.",
					},
				],
			};
		},
	);

	// Start MCP server on stdio.
	const transport = new StdioServerTransport();
	await mcp.connect(transport);
}
```

- [ ] **Step 2: Run typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/serve/server.ts
git commit -m "feat: add MCP server with token, resume, and auto-approve tools"
```

---

### Task 10: CLI Run Command

**Files:**
- Create: `src/run/exec.ts`
- Create: `src/run/run.ts`

- [ ] **Step 1: Write the subprocess executor**

Create `src/run/exec.ts`:

```typescript
import { spawn } from "node:child_process";
import { createMasker } from "./masking.ts";

export function execWithSecrets(
	command: string[],
	cwd: string,
	inheritedEnv: Record<string, string>,
	resolvedSecrets: Record<string, string>,
	plainVars: Record<string, string>,
): Promise<number> {
	// Merge env: inherited < plain vars < resolved secrets.
	const env = { ...inheritedEnv, ...plainVars, ...resolvedSecrets };

	const mask = createMasker(Object.values(resolvedSecrets));

	return new Promise((resolve) => {
		const child = spawn(command[0], command.slice(1), {
			cwd,
			env,
			stdio: ["inherit", "pipe", "pipe"],
		});

		child.stdout.on("data", (chunk: Buffer) => {
			process.stdout.write(mask(chunk.toString()));
		});

		child.stderr.on("data", (chunk: Buffer) => {
			process.stderr.write(mask(chunk.toString()));
		});

		child.on("close", (code) => {
			resolve(code ?? 1);
		});

		child.on("error", (err) => {
			process.stderr.write(`Failed to start process: ${err.message}\n`);
			resolve(2);
		});
	});
}
```

- [ ] **Step 2: Write the run command**

Create `src/run/run.ts`:

```typescript
import { readEnvFile } from "./envfile.ts";
import { sendRequest } from "./client.ts";
import { execWithSecrets } from "./exec.ts";
import { EXIT_PROTOCOL_ERROR, EXIT_REJECTED } from "../protocol.ts";

interface RunArgs {
	token: string;
	sock: string;
	envFile: string;
	reason: string;
	command: string[];
}

export function parseRunArgs(argv: string[]): RunArgs {
	let token: string | undefined;
	let sock: string | undefined;
	let envFile: string | undefined;
	let reason: string | undefined;
	let command: string[] | undefined;

	const args = argv.slice(3); // skip: bun, cli.ts, "run"
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];

		if (arg === "--") {
			command = args.slice(i + 1);
			break;
		}

		if (arg.startsWith("--token=")) {
			token = arg.slice(8);
		} else if (arg.startsWith("--sock=")) {
			sock = arg.slice(7);
		} else if (arg.startsWith("--env-file=")) {
			envFile = arg.slice(11);
		} else if (arg.startsWith("--reason=")) {
			reason = arg.slice(9);
		} else {
			console.error(`Unknown flag: ${arg}`);
			process.exit(EXIT_PROTOCOL_ERROR);
		}
	}

	if (!token || !sock || !envFile || !reason || !command?.length) {
		console.error(
			"Usage: op-remote run --token=TOKEN --sock=SOCK --env-file=FILE --reason=REASON -- COMMAND...",
		);
		process.exit(EXIT_PROTOCOL_ERROR);
	}

	return { token, sock, envFile, reason, command };
}

export async function runCommand(args: RunArgs): Promise<never> {
	// Parse the env file.
	const { secretVars, plainVars } = await readEnvFile(args.envFile);

	if (secretVars.length === 0) {
		console.error("No op:// references found in env file");
		process.exit(EXIT_PROTOCOL_ERROR);
	}

	// Request secrets from the MCP server.
	const cwd = process.cwd();
	let response;
	try {
		response = await sendRequest(args.sock, {
			token: args.token,
			envVars: secretVars,
			command: args.command,
			cwd,
			reason: args.reason,
		});
	} catch (err) {
		console.error(
			`Failed to connect to op-remote server: ${err instanceof Error ? err.message : String(err)}`,
		);
		process.exit(EXIT_PROTOCOL_ERROR);
	}

	if (response.status === "rejected") {
		console.error(`Rejected: ${response.reason ?? "unknown reason"}`);
		process.exit(EXIT_REJECTED);
	}

	// Execute the subprocess with resolved secrets.
	const exitCode = await execWithSecrets(
		args.command,
		cwd,
		process.env as Record<string, string>,
		response.env!,
		plainVars,
	);

	process.exit(exitCode);
}
```

- [ ] **Step 3: Run typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/run/exec.ts src/run/run.ts
git commit -m "feat: add CLI run command with env merging and secret masking"
```

---

### Task 11: Wire CLI Entrypoint

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Update cli.ts to wire subcommands**

Replace `src/cli.ts` with:

```typescript
#!/usr/bin/env bun

const [subcommand] = process.argv.slice(2);

switch (subcommand) {
	case "serve": {
		const { startServer } = await import("./serve/server.ts");
		await startServer();
		break;
	}
	case "run": {
		const { parseRunArgs, runCommand } = await import("./run/run.ts");
		const args = parseRunArgs(process.argv);
		await runCommand(args);
		break;
	}
	default:
		console.error("Usage: op-remote <serve|run>");
		process.exit(1);
}
```

- [ ] **Step 2: Make cli.ts executable**

```bash
chmod +x src/cli.ts
```

- [ ] **Step 3: Run all tests**

```bash
bun test
```

Expected: all tests pass (envfile, tokens, masking, socket).

- [ ] **Step 4: Run typecheck and format**

```bash
bun run typecheck && bun run check
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts
git commit -m "feat: wire serve and run subcommands in CLI entrypoint"
```

---

### Task 12: End-to-End Manual Test

**Files:** none (manual verification)

- [ ] **Step 1: Set up a test Telegram bot**

Create a bot via @BotFather on Telegram. Note the bot token and chat ID.

- [ ] **Step 2: Create a test .env.tpl**

```bash
cat > /tmp/test.env.tpl << 'EOF'
TEST_SECRET="op://Development/test/secret"
PLAIN_VAR=hello
EOF
```

- [ ] **Step 3: Test the serve command locally (with mock secrets)**

```bash
REMOTE_OP_TELEGRAM_BOT_TOKEN="<bot-token>" \
REMOTE_OP_TELEGRAM_CHAT_ID="<chat-id>" \
REMOTE_OP_TIMEOUT="60" \
TEST_SECRET="super_secret_value" \
bun src/cli.ts serve
```

This starts the MCP server on stdio. It should block waiting for MCP messages.

- [ ] **Step 4: Verify run command flag parsing**

```bash
bun src/cli.ts run --token=test --sock=/tmp/nonexistent.sock --env-file=/tmp/test.env.tpl --reason="testing" -- echo hello
```

Expected: error about failed socket connection.

- [ ] **Step 5: Full integration with Claude Code**

Create a `.mcp.json` in a test project:

```json
{
  "mcpServers": {
    "op-remote": {
      "command": "op",
      "args": ["run", "--env-file", ".env.tpl", "--", "bun", "/path/to/op-remote/src/cli.ts", "serve"],
      "env": {
        "REMOTE_OP_TELEGRAM_BOT_TOKEN": "op://Development/op-remote/telegram-bot-token",
        "REMOTE_OP_TELEGRAM_CHAT_ID": "op://Development/op-remote/telegram-chat-id",
        "REMOTE_OP_TIMEOUT": "120"
      }
    }
  }
}
```

Start a Claude Code session and verify:
1. `request_token` tool returns `{token, sock}`
2. `op-remote run --token=... --sock=... --env-file=.env.tpl --reason="test" -- env` shows resolved secrets
3. Telegram message appears with approval buttons
4. Approve/Reject/Auto-Approve/Stop all work correctly
5. Secret values are masked in output

---

### Task 13: Claude Code Skill + Plugin Structure

**Files:**
- Create: `.claude-plugin/plugin.json`
- Create: `skills/op-remote/SKILL.md`

- [ ] **Step 1: Create plugin manifest**

Create `.claude-plugin/plugin.json`:

```json
{
  "name": "op-remote",
  "version": "0.1.0",
  "description": "Remote 1Password secret access with Telegram approval for AI agents",
  "author": {
    "name": "Wyatt Johnson"
  }
}
```

- [ ] **Step 2: Create the skill**

Create `skills/op-remote/SKILL.md`:

````markdown
---
name: op-remote
description: "Guides usage of the op-remote MCP server for running commands with 1Password secrets. Triggers when op-remote:request_token tool is available, when running commands that need secrets from .env.tpl, or when encountering \"op-remote\", \"secret access\", \"op://\"."
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
````

- [ ] **Step 3: Verify skill structure**

```bash
test -f .claude-plugin/plugin.json && echo "plugin.json exists"
test -f skills/op-remote/SKILL.md && echo "SKILL.md exists"
```

Expected: both files exist.

- [ ] **Step 4: Register in marketplace**

Add the plugin entry to `/Users/wyatt.johnson/Code/github.com/wyattjoh/claude-code-marketplace/.claude-plugin/marketplace.json` in the `plugins` array:

```json
{
  "name": "op-remote",
  "description": "Remote 1Password secret access with Telegram approval for AI agents",
  "version": "0.1.0",
  "author": {
    "name": "Wyatt Johnson"
  },
  "repository": "https://github.com/wyattjoh/remote-op",
  "license": "MIT",
  "keywords": ["1password", "telegram", "secrets", "mcp", "security"],
  "category": "security",
  "source": {
    "source": "github",
    "repo": "wyattjoh/remote-op"
  }
}
```

- [ ] **Step 5: Commit plugin and skill**

```bash
git add .claude-plugin/plugin.json skills/op-remote/SKILL.md
git commit -m "feat: add Claude Code plugin manifest and op-remote skill"
```

- [ ] **Step 6: Commit marketplace update (in marketplace repo)**

```bash
cd /Users/wyatt.johnson/Code/github.com/wyattjoh/claude-code-marketplace
git add .claude-plugin/marketplace.json
git commit -m "feat: add op-remote plugin to marketplace"
```
