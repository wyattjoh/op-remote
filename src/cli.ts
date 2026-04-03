#!/usr/bin/env bun

const [subcommand] = process.argv.slice(2);

switch (subcommand) {
	case "serve":
		console.error("serve: not yet implemented");
		process.exit(1);
		break;
	case "run":
		console.error("run: not yet implemented");
		process.exit(1);
		break;
	default:
		console.error("Usage: op-remote <serve|run>");
		process.exit(1);
}
