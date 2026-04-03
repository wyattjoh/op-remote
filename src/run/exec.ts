import { spawn } from "node:child_process";
import { createMasker } from "./masking.ts";

export function execWithSecrets(
	command: string[],
	cwd: string,
	inheritedEnv: Record<string, string>,
	resolvedSecrets: Record<string, string>,
	plainVars: Record<string, string>,
): Promise<number> {
	// Merge env: inherited < plain vars < resolved secrets.
	const env = { ...inheritedEnv, ...plainVars, ...resolvedSecrets };

	const mask = createMasker(Object.values(resolvedSecrets));

	return new Promise((resolve) => {
		const child = spawn(command[0], command.slice(1), {
			cwd,
			env,
			stdio: ["inherit", "pipe", "pipe"],
		});

		child.stdout.on("data", (chunk: Buffer) => {
			process.stdout.write(mask(chunk.toString()));
		});

		child.stderr.on("data", (chunk: Buffer) => {
			process.stderr.write(mask(chunk.toString()));
		});

		child.on("close", (code) => {
			resolve(code ?? 1);
		});

		child.on("error", (err) => {
			process.stderr.write(`Failed to start process: ${err.message}\n`);
			resolve(2);
		});
	});
}
