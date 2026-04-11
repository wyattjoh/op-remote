import type { SecretVar } from "../protocol.ts";

export type { SecretVar };

export interface ParsedEnvFile {
  /** Env vars whose values are op:// references. */
  secretVars: SecretVar[];
  /** Env vars with plain (non-secret) values. */
  plainVars: Record<string, string>;
}

export function parseEnvFile(content: string): ParsedEnvFile {
  const secretVars: SecretVar[] = [];
  const plainVars: Record<string, string> = {};

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) {
      continue;
    }

    // Strip optional "export " prefix.
    const stripped = line.startsWith("export ") ? line.slice(7).trim() : line;

    const eqIdx = stripped.indexOf("=");
    if (eqIdx === -1) {
      continue;
    }

    const key = stripped.slice(0, eqIdx).trim();
    const rawValue = stripped.slice(eqIdx + 1).trim();

    // Remove surrounding quotes (single or double).
    const value = rawValue.replace(/^(['"])(.*)\1$/, "$2");

    if (value.startsWith("op://")) {
      secretVars.push({ name: key, ref: value });
    } else {
      plainVars[key] = value;
    }
  }

  return { secretVars, plainVars };
}

export async function readEnvFile(path: string): Promise<ParsedEnvFile> {
  const { readFile } = await import("node:fs/promises");
  const content = await readFile(path, "utf-8");
  return parseEnvFile(content);
}
