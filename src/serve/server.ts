import { spawn } from "node:child_process";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { SocketRequest, SocketResponse } from "../protocol.ts";
import { type SocketHandler, createSocketServer } from "./socket.ts";
import { requestResumeApproval, requestRunApproval } from "./telegram.ts";
import { TokenStore } from "./tokens.ts";

interface ServerConfig {
  telegramBotToken: string;
  telegramChatId: string;
  timeoutMs: number;
  telegramApproverIds: number[];
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

  const timeoutMs = Number.parseInt(process.env.REMOTE_OP_TIMEOUT ?? "120", 10) * 1000;

  const approverIdsRaw = process.env.REMOTE_OP_TELEGRAM_APPROVER_IDS ?? "";
  const telegramApproverIds = approverIdsRaw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map(Number)
    .filter((n) => !Number.isNaN(n));

  return { telegramBotToken: botToken, telegramChatId: chatId, timeoutMs, telegramApproverIds };
}

/**
 * Reads an env file and resolves all op:// references into process.env in a
 * single `op run` invocation at startup, while the user is present and can
 * authenticate with 1Password. Missing file is silently ignored so the plugin
 * works for projects without a .env.tpl.
 */
async function loadEnvFile(envFile: string): Promise<void> {
  const { access } = await import("node:fs/promises");
  try {
    await access(envFile);
  } catch {
    return;
  }

  const { readEnvFile } = await import("../run/envfile.ts");
  const { secretVars } = await readEnvFile(envFile);
  if (secretVars.length === 0) return;

  const names = new Set(secretVars.map((v) => v.name));

  // Resolve all op:// references in one shot via `op run -- env`.
  const resolved = await new Promise<Record<string, string>>((resolve, reject) => {
    const child = spawn("op", ["run", `--env-file=${envFile}`, "--", "env"], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`op run failed (exit code ${code})`));
        return;
      }
      const env: Record<string, string> = {};
      for (const line of stdout.split("\n")) {
        const idx = line.indexOf("=");
        if (idx === -1) continue;
        const key = line.slice(0, idx);
        if (names.has(key)) {
          env[key] = line.slice(idx + 1);
        }
      }
      resolve(env);
    });

    child.on("error", (err) => {
      reject(new Error(`Failed to start op: ${err.message}`));
    });
  });

  for (const [name, value] of Object.entries(resolved)) {
    process.env[name] = value;
  }
}

export async function startServer(opts: { envFile?: string } = {}): Promise<void> {
  // A Telegram hiccup or malformed update must never take the server down.
  // Log and keep running so the in-flight socket handler can still respond.
  process.on("unhandledRejection", (reason) => {
    console.error("[op-remote] unhandled rejection:", reason);
  });

  if (opts.envFile) {
    await loadEnvFile(opts.envFile);
  }

  const config = readConfig();
  const tokens = new TokenStore(config.timeoutMs);

  // State.
  let stopped = false;
  let autoApprove = false;

  // Socket handler that resolves secrets from process.env.
  const socketHandler: SocketHandler = {
    async handleRequest(req: SocketRequest): Promise<SocketResponse> {
      // Check that all requested env vars were loaded at startup.
      const missing = req.envVars.filter(({ name }) => !(name in process.env));
      if (missing.length > 0) {
        return {
          status: "rejected",
          reason: `unknown env vars: ${missing.map((v) => v.name).join(", ")}`,
        };
      }

      // If auto-approve is on, skip Telegram.
      if (!autoApprove) {
        const telegramConfig = {
          botToken: config.telegramBotToken,
          chatId: config.telegramChatId,
          timeoutMs: config.timeoutMs,
          approverIds: config.telegramApproverIds,
        };

        const result = await requestRunApproval(telegramConfig, {
          command: req.command,
          cwd: req.cwd,
          reason: req.reason,
          secretNames: req.envVars.map((v) => v.name),
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

      // Return secrets from process.env (loaded at startup).
      const env: Record<string, string> = {};
      for (const { name } of req.envVars) {
        const value = process.env[name];
        if (value === undefined) {
          return { status: "rejected", reason: `env var not available: ${name}` };
        }
        env[name] = value;
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
    async () => {
      if (!stopped) {
        return {
          content: [{ type: "text" as const, text: "Session is not stopped." }],
        };
      }

      const telegramConfig = {
        botToken: config.telegramBotToken,
        chatId: config.telegramChatId,
        timeoutMs: config.timeoutMs,
        approverIds: config.telegramApproverIds,
      };

      const result = await requestResumeApproval(telegramConfig);

      if (result.action === "approve") {
        stopped = false;
        return {
          content: [{ type: "text" as const, text: "Session resumed." }],
        };
      }

      const reason = result.reason ?? "resume denied";
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
