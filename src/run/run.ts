import { EXIT_PROTOCOL_ERROR, EXIT_REJECTED } from "../protocol.ts";
import type { SocketResponse } from "../protocol.ts";
import { sendRequest } from "./client.ts";
import { readEnvFile } from "./envfile.ts";
import { execWithSecrets } from "./exec.ts";

interface RunArgs {
  token: string;
  sock: string;
  envFile: string;
  reason: string;
  command: string[];
}

const FLAG_KEYS = ["--token=", "--sock=", "--env-file=", "--reason="] as const;

export function parseRunArgs(argv: string[]): RunArgs {
  const flags: Record<string, string> = {};
  let command: string[] | undefined;

  const args = argv.slice(3); // skip: bun, cli.ts, "run"
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--") {
      command = args.slice(i + 1);
      break;
    }

    const match = FLAG_KEYS.find((key) => arg.startsWith(key));
    if (!match) {
      console.error(`Unknown flag: ${arg}`);
      process.exit(EXIT_PROTOCOL_ERROR);
    }
    flags[match] = arg.slice(match.length);
  }

  const token = flags["--token="];
  const sock = flags["--sock="];
  const envFile = flags["--env-file="];
  const reason = flags["--reason="];

  if (!token || !sock || !envFile || !reason || !command?.length) {
    console.error(
      "Usage: op-remote run --token=TOKEN --sock=SOCK --env-file=FILE --reason=REASON -- COMMAND...",
    );
    process.exit(EXIT_PROTOCOL_ERROR);
  }

  return { token, sock, envFile, reason, command };
}

export async function runCommand(args: RunArgs): Promise<never> {
  // Parse the env file.
  const { secretVars, plainVars } = await readEnvFile(args.envFile);

  if (secretVars.length === 0) {
    console.error("No op:// references found in env file");
    process.exit(EXIT_PROTOCOL_ERROR);
  }

  // Request secrets from the MCP server.
  const cwd = process.cwd();
  let response: SocketResponse;
  try {
    response = await sendRequest(args.sock, {
      token: args.token,
      envVars: secretVars,
      command: args.command,
      cwd,
      reason: args.reason,
    });
  } catch (err) {
    console.error(
      `Failed to connect to op-remote server: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(EXIT_PROTOCOL_ERROR);
  }

  if (response.status === "rejected") {
    console.error(`Rejected: ${response.reason ?? "unknown reason"}`);
    process.exit(EXIT_REJECTED);
  }

  // Execute the subprocess with resolved secrets.
  const exitCode = await execWithSecrets(
    args.command,
    cwd,
    process.env as Record<string, string>,
    response.env ?? {},
    plainVars,
  );

  process.exit(exitCode);
}
