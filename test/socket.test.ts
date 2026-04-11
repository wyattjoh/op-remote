import { afterEach, describe, expect, test } from "bun:test";
import type { SocketRequest, SocketResponse } from "../src/protocol.ts";
import { sendRequest } from "../src/run/client.ts";
import { type SocketHandler, createSocketServer } from "../src/serve/socket.ts";
import { TokenStore } from "../src/serve/tokens.ts";

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
      async handleRequest(_req: SocketRequest): Promise<SocketResponse> {
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
      envVars: [{ name: "MY_SECRET", ref: "op://Dev/item/field" }],
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

    const req = {
      token,
      envVars: [],
      command: ["true"],
      cwd: "/tmp",
      reason: "test",
    };

    const res1 = await sendRequest(sockPath, req);
    expect(res1.status).toBe("approved");

    const res2 = await sendRequest(sockPath, req);
    expect(res2.status).toBe("rejected");
  });
});
