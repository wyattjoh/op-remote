import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { type Socket as NetSocket, createServer } from "node:net";
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

function handleConnection(conn: NetSocket, tokens: TokenStore, handler: SocketHandler): void {
  const chunks: Uint8Array[] = [];
  let responded = false;

  const respond = async () => {
    if (responded) return;
    responded = true;
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
  };

  conn.on("data", (chunk: Uint8Array) => {
    chunks.push(chunk);
    // Attempt to parse immediately after each chunk so the response can be
    // sent before the client half-closes the connection. This is necessary
    // because Bun's node:net client drops incoming data after calling end().
    const raw = Buffer.concat(chunks).toString("utf-8");
    try {
      JSON.parse(raw);
      // Valid JSON received — respond now without waiting for client FIN.
      void respond();
    } catch {
      // Incomplete JSON; wait for more data.
    }
  });

  conn.on("end", () => {
    // Fallback: respond if we haven't already (e.g. data arrived all at once
    // but JSON parse failed above, or the data event never fired).
    void respond();
  });
}
