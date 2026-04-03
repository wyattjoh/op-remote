import { describe, expect, test } from "bun:test";
import { createMasker } from "../src/run/masking.ts";

describe("createMasker", () => {
  test("replaces secret values with <redacted>", () => {
    const mask = createMasker(["sk_live_abc123", "app_2x7f"]);
    expect(mask("token is sk_live_abc123 here")).toBe("token is <redacted> here");
  });

  test("replaces multiple secrets in one line", () => {
    const mask = createMasker(["secret1", "secret2"]);
    expect(mask("a=secret1 b=secret2")).toBe("a=<redacted> b=<redacted>");
  });

  test("replaces all occurrences of a secret", () => {
    const mask = createMasker(["abc"]);
    expect(mask("abc and abc again")).toBe("<redacted> and <redacted> again");
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
    expect(mask("val: secret.with+special(chars) end")).toBe("val: <redacted> end");
  });
});
