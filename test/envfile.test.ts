import { describe, expect, test } from "bun:test";
import { parseEnvFile } from "../src/run/envfile.ts";

describe("parseEnvFile", () => {
  test("extracts op:// references as secret vars", () => {
    const content = [
      'CLERK_API_KEY="op://AI Enablement/Clerk/key"',
      'APP_ID="op://Development/app/id"',
    ].join("\n");

    const result = parseEnvFile(content);

    expect(result.secretVars).toEqual(["CLERK_API_KEY", "APP_ID"]);
    expect(result.plainVars).toEqual({});
  });

  test("extracts plain vars separately", () => {
    const content = ["APP_URL=https://example.com", 'SECRET="op://Dev/item/field"'].join("\n");

    const result = parseEnvFile(content);

    expect(result.secretVars).toEqual(["SECRET"]);
    expect(result.plainVars).toEqual({ APP_URL: "https://example.com" });
  });

  test("skips comments and blank lines", () => {
    const content = [
      "# this is a comment",
      "",
      "  # indented comment",
      'KEY="op://Vault/item/field"',
    ].join("\n");

    const result = parseEnvFile(content);

    expect(result.secretVars).toEqual(["KEY"]);
    expect(result.plainVars).toEqual({});
  });

  test("handles unquoted values", () => {
    const content = "KEY=op://Vault/item/field";
    const result = parseEnvFile(content);
    expect(result.secretVars).toEqual(["KEY"]);
  });

  test("handles single-quoted values", () => {
    const content = "KEY='op://Vault/item/field'";
    const result = parseEnvFile(content);
    expect(result.secretVars).toEqual(["KEY"]);
  });

  test("handles export prefix", () => {
    const content = 'export KEY="op://Vault/item/field"';
    const result = parseEnvFile(content);
    expect(result.secretVars).toEqual(["KEY"]);
  });

  test("returns empty for empty file", () => {
    const result = parseEnvFile("");
    expect(result.secretVars).toEqual([]);
    expect(result.plainVars).toEqual({});
  });
});
