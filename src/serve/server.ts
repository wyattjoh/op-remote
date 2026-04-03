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
          approverIds: config.telegramApproverIds,
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
        env[name] = process.env[name] ?? "";
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
