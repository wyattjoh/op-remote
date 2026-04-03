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
