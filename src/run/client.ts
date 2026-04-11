import { createConnection } from "node:net";
import type { SocketRequest, SocketResponse } from "../protocol.ts";

export function sendRequest(sockPath: string, req: SocketRequest): Promise<SocketResponse> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let settled = false;

    const socket = createConnection({ path: sockPath });

    socket.on("connect", () => {
      socket.write(JSON.stringify(req));
    });

    socket.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });

    const finish = () => {
      if (settled) return;
      settled = true;
      const raw = Buffer.concat(chunks).toString("utf-8");
      if (raw.length === 0) {
        reject(new Error("Server closed connection without sending a response"));
        return;
      }
      try {
        resolve(JSON.parse(raw) as SocketResponse);
      } catch (err) {
        reject(new Error(`Failed to parse server response: ${err}`));
      }
    };

    // `end` and `close` both fire on normal shutdown; `finish` is idempotent.
    socket.on("end", finish);
    socket.on("close", finish);

    socket.on("error", (err: Error) => {
      if (settled) return;
      settled = true;
      reject(new Error(`Socket connection error: ${err.message}`));
    });
  });
}
