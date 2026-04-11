import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { type Socket as NetSocket, createServer } from "node:net";
import { z } from "zod";
import type { SocketRequest, SocketResponse } from "../protocol.ts";
import type { TokenStore } from "./tokens.ts";

const socketRequestSchema = z.object({
  token: z.string(),
  envVars: z.array(z.object({ name: z.string(), ref: z.string() })),
  command: z.array(z.string()),
  cwd: z.string(),
  reason: z.string(),
});

/** Maximum allowed request payload size (1 MiB). */
const MAX_REQUEST_BYTES = 1024 * 1024;

export interface SocketHandler {
  handleRequest(req: SocketRequest): Promise<SocketResponse>;
}

export function createSocketServer(
  tokens: TokenStore,
  handler: SocketHandler,
): { sockPath: string; close: () => void } {
  const dir = `${process.env.TMPDIR ?? "/tmp"}/op-remote`;
  mkdirSync(dir, { recursive: true, mode: 0o700 });

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
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      close();
      process.exit(0);
    });
  }

  return { sockPath, close };
}

/**
 * True once `chunks` concatenated form a complete JSON document. We probe on
 * every chunk because Bun's node:net client drops incoming data after calling
 * end(), so we can't wait for FIN to know the request is complete.
 */
function isCompleteJson(chunks: Uint8Array[]): boolean {
  try {
    JSON.parse(Buffer.concat(chunks).toString("utf-8"));
    return true;
  } catch {
    return false;
  }
}

function handleConnection(conn: NetSocket, tokens: TokenStore, handler: SocketHandler): void {
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let responded = false;
  let responding = false;

  const sendResponse = (res: SocketResponse) => {
    if (responded) return;
    responded = true;
    conn.end(JSON.stringify(res));
  };

  const respond = async () => {
    if (responded || responding) return;
    responding = true;

    let req: SocketRequest;
    try {
      const raw = Buffer.concat(chunks).toString("utf-8");
      req = socketRequestSchema.parse(JSON.parse(raw));
    } catch (err) {
      sendResponse({
        status: "rejected",
        reason: `protocol error: ${err instanceof Error ? err.message : String(err)}`,
      });
      return;
    }

    // Atomically reserve the token (prevents concurrent use).
    // Peer identity is guarded by 0600 socket file permissions; node:net
    // doesn't expose SO_PEERCRED on macOS.
    if (!tokens.reserve(req.token)) {
      sendResponse({ status: "rejected", reason: "invalid or expired token" });
      return;
    }

    try {
      const response = await handler.handleRequest(req);
      tokens.consume(req.token);
      sendResponse(response);
    } catch (err) {
      // Release the reservation so the token can be retried.
      tokens.release(req.token);
      sendResponse({
        status: "rejected",
        reason: `protocol error: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  };

  conn.on("data", (chunk: Uint8Array) => {
    totalBytes += chunk.length;

    if (totalBytes > MAX_REQUEST_BYTES) {
      sendResponse({ status: "rejected", reason: "request too large" });
      conn.destroy();
      return;
    }

    chunks.push(chunk);
    if (isCompleteJson(chunks)) {
      void respond();
    }
  });

  // Fallback for the edge case where data arrives but isCompleteJson never
  // returns true (e.g. malformed JSON) and the client then half-closes. Still
  // needed because respond() surfaces the parse error back to the caller.
  conn.on("end", () => {
    void respond();
  });
}
