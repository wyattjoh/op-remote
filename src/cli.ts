#!/usr/bin/env bun

export {};

const [subcommand] = process.argv.slice(2);

switch (subcommand) {
  case "serve": {
    const { startServer } = await import("./serve/server.ts");
    await startServer();
    break;
  }
  case "run": {
    const { parseRunArgs, runCommand } = await import("./run/run.ts");
    const args = parseRunArgs(process.argv);
    await runCommand(args);
    break;
  }
  default:
    console.error("Usage: op-remote <serve|run>");
    process.exit(1);
}
