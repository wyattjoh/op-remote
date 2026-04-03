import type { SocketRequest, SocketResponse } from "../protocol.ts";

export function sendRequest(sockPath: string, req: SocketRequest): Promise<SocketResponse> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let settled = false;

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    Bun.connect({
      unix: sockPath,
      socket: {
        open(socket) {
          socket.write(JSON.stringify(req));
        },
        data(_socket, chunk: Uint8Array) {
          chunks.push(chunk);
        },
        close() {
          settle(() => {
            try {
              const raw = Buffer.concat(chunks).toString("utf-8");
              const res = JSON.parse(raw) as SocketResponse;
              resolve(res);
            } catch (err) {
              reject(new Error(`Failed to parse server response: ${err}`));
            }
          });
        },
        error(_socket, err) {
          settle(() => {
            reject(new Error(`Socket connection error: ${err.message}`));
          });
        },
      },
    }).catch((err) => {
      settle(() => reject(new Error(`Socket connection error: ${err.message}`)));
    });
  });
}
