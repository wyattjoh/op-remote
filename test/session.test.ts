import { describe, expect, test } from "bun:test";
import type { SocketRequest } from "../src/protocol.ts";
import {
  type EnvResolver,
  type ResumeApprovalFn,
  type RunApprovalFn,
  createSession,
} from "../src/serve/session.ts";
import type { ApprovalResult } from "../src/serve/telegram.ts";

/** Programmable approval stub: dequeues one canned result per call. */
function stubApproval(queue: ApprovalResult[]): {
  fn: RunApprovalFn;
  calls: number;
} {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    fn: async () => {
      calls++;
      const next = queue.shift();
      if (!next) throw new Error("runApproval called more times than queued");
      return next;
    },
  };
}

function stubResume(queue: ApprovalResult[]): {
  fn: ResumeApprovalFn;
  calls: number;
} {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    fn: async () => {
      calls++;
      const next = queue.shift();
      if (!next) throw new Error("resumeApproval called more times than queued");
      return next;
    },
  };
}

/** Env resolver backed by a static map. */
function staticResolver(env: Record<string, string>): EnvResolver {
  return (names) => {
    const resolved: Record<string, string> = {};
    const missing: string[] = [];
    for (const name of names) {
      if (name in env) {
        resolved[name] = env[name];
      } else {
        missing.push(name);
      }
    }
    return missing.length > 0 ? { ok: false, missing } : { ok: true, env: resolved };
  };
}

function makeRequest(overrides: Partial<SocketRequest> = {}): SocketRequest {
  return {
    token: "t",
    envVars: [{ name: "API_KEY", ref: "op://Dev/item/field" }],
    command: ["echo", "hi"],
    cwd: "/tmp",
    reason: "test",
    ...overrides,
  };
}

describe("session state machine", () => {
  test("approve returns resolved env", async () => {
    const run = stubApproval([{ action: "approve" }]);
    const resume = stubResume([]);
    const session = createSession(run.fn, resume.fn);
    const resolver = staticResolver({ API_KEY: "secret-value" });

    const res = await session.handleRequest(makeRequest(), resolver);

    expect(res.status).toBe("approved");
    expect(res.env).toEqual({ API_KEY: "secret-value" });
    expect(run.calls).toBe(1);
  });

  test("reject returns rejection reason and does not leak env", async () => {
    const run = stubApproval([{ action: "reject", reason: "nope" }]);
    const session = createSession(run.fn, stubResume([]).fn);
    const resolver = staticResolver({ API_KEY: "secret-value" });

    const res = await session.handleRequest(makeRequest(), resolver);

    expect(res.status).toBe("rejected");
    expect(res.reason).toBe("nope");
    expect(res.env).toBeUndefined();
  });

  test("reject without reason uses default", async () => {
    const run = stubApproval([{ action: "reject" }]);
    const session = createSession(run.fn, stubResume([]).fn);

    const res = await session.handleRequest(makeRequest(), staticResolver({ API_KEY: "v" }));

    expect(res.status).toBe("rejected");
    expect(res.reason).toBe("rejected");
  });

  test("unknown env vars short-circuit before approval", async () => {
    const run = stubApproval([]);
    const session = createSession(run.fn, stubResume([]).fn);

    const res = await session.handleRequest(
      makeRequest({
        envVars: [
          { name: "API_KEY", ref: "op://Dev/a/b" },
          { name: "MISSING", ref: "op://Dev/c/d" },
        ],
      }),
      staticResolver({ API_KEY: "v" }),
    );

    expect(res.status).toBe("rejected");
    expect(res.reason).toContain("unknown env vars: MISSING");
    expect(run.calls).toBe(0);
  });

  test("auto_approve caches and skips approval on subsequent requests", async () => {
    const run = stubApproval([{ action: "auto_approve" }]);
    const session = createSession(run.fn, stubResume([]).fn);
    const resolver = staticResolver({ API_KEY: "v" });

    const first = await session.handleRequest(makeRequest(), resolver);
    expect(first.status).toBe("approved");
    expect(session.isAutoApprove()).toBe(true);

    // Further requests must not call runApproval; the queue is empty so any
    // call would throw, which would flip this assertion.
    const second = await session.handleRequest(makeRequest(), resolver);
    const third = await session.handleRequest(makeRequest(), resolver);
    expect(second.status).toBe("approved");
    expect(third.status).toBe("approved");
    expect(run.calls).toBe(1);
  });

  test("disableAutoApprove requires approval on the next request", async () => {
    const run = stubApproval([{ action: "auto_approve" }, { action: "approve" }]);
    const session = createSession(run.fn, stubResume([]).fn);
    const resolver = staticResolver({ API_KEY: "v" });

    await session.handleRequest(makeRequest(), resolver);
    expect(session.isAutoApprove()).toBe(true);

    session.disableAutoApprove();
    expect(session.isAutoApprove()).toBe(false);

    const res = await session.handleRequest(makeRequest(), resolver);
    expect(res.status).toBe("approved");
    expect(run.calls).toBe(2);
  });

  test("stop sets stopped flag and returns rejection", async () => {
    const run = stubApproval([{ action: "stop", reason: "halt" }]);
    const session = createSession(run.fn, stubResume([]).fn);

    const res = await session.handleRequest(makeRequest(), staticResolver({ API_KEY: "v" }));

    expect(res.status).toBe("rejected");
    expect(res.reason).toBe("halt");
    expect(session.isStopped()).toBe(true);
  });

  test("tryResume when not stopped is a no-op", async () => {
    const resume = stubResume([]);
    const session = createSession(stubApproval([]).fn, resume.fn);

    const res = await session.tryResume();

    expect(res.kind).toBe("not-stopped");
    expect(resume.calls).toBe(0);
  });

  test("tryResume approved clears stopped flag", async () => {
    const run = stubApproval([{ action: "stop", reason: "halt" }]);
    const resume = stubResume([{ action: "approve" }]);
    const session = createSession(run.fn, resume.fn);

    await session.handleRequest(makeRequest(), staticResolver({ API_KEY: "v" }));
    expect(session.isStopped()).toBe(true);

    const res = await session.tryResume();

    expect(res.kind).toBe("resumed");
    expect(session.isStopped()).toBe(false);
    expect(resume.calls).toBe(1);
  });

  test("tryResume denied keeps session stopped", async () => {
    const run = stubApproval([{ action: "stop" }]);
    const resume = stubResume([{ action: "reject", reason: "still no" }]);
    const session = createSession(run.fn, resume.fn);

    await session.handleRequest(makeRequest(), staticResolver({ API_KEY: "v" }));
    const res = await session.tryResume();

    expect(res.kind).toBe("denied");
    expect(res.reason).toBe("still no");
    expect(session.isStopped()).toBe(true);
  });

  test("full lifecycle: approve, auto-approve, disable, stop, resume", async () => {
    // Matches the end-to-end scenarios exercised manually against Telegram.
    const run = stubApproval([
      { action: "approve" },
      { action: "auto_approve" },
      { action: "approve" },
      { action: "stop", reason: "time to halt" },
    ]);
    const resume = stubResume([{ action: "approve" }]);
    const session = createSession(run.fn, resume.fn);
    const resolver = staticResolver({ API_KEY: "v" });

    // 1. Normal approve.
    expect((await session.handleRequest(makeRequest(), resolver)).status).toBe("approved");
    expect(run.calls).toBe(1);

    // 2. Auto-approve latches.
    expect((await session.handleRequest(makeRequest(), resolver)).status).toBe("approved");
    expect(session.isAutoApprove()).toBe(true);
    expect(run.calls).toBe(2);

    // 3. Auto-approve bypasses a subsequent request entirely.
    expect((await session.handleRequest(makeRequest(), resolver)).status).toBe("approved");
    expect(run.calls).toBe(2);

    // 4. Disable auto-approve -> next request needs approval again.
    session.disableAutoApprove();
    expect((await session.handleRequest(makeRequest(), resolver)).status).toBe("approved");
    expect(run.calls).toBe(3);

    // 5. Stop halts the session.
    const stopRes = await session.handleRequest(makeRequest(), resolver);
    expect(stopRes.status).toBe("rejected");
    expect(session.isStopped()).toBe(true);
    expect(run.calls).toBe(4);

    // 6. Resume brings it back.
    expect((await session.tryResume()).kind).toBe("resumed");
    expect(session.isStopped()).toBe(false);
  });
});
