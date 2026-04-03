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

export function parseRunArgs(argv: string[]): RunArgs {
  let token: string | undefined;
  let sock: string | undefined;
  let envFile: string | undefined;
  let reason: string | undefined;
  let command: string[] | undefined;

  const args = argv.slice(3); // skip: bun, cli.ts, "run"
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--") {
      command = args.slice(i + 1);
      break;
    }

    if (arg.startsWith("--token=")) {
      token = arg.slice(8);
    } else if (arg.startsWith("--sock=")) {
      sock = arg.slice(7);
    } else if (arg.startsWith("--env-file=")) {
      envFile = arg.slice(11);
    } else if (arg.startsWith("--reason=")) {
      reason = arg.slice(9);
    } else {
      console.error(`Unknown flag: ${arg}`);
      process.exit(EXIT_PROTOCOL_ERROR);
    }
  }

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
