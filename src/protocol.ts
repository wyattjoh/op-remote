/** Sent by the CLI to the MCP server over the Unix socket. */
export interface SocketRequest {
	token: string;
	envVars: string[];
	command: string[];
	cwd: string;
	reason: string;
}

/** Sent by the MCP server back to the CLI over the Unix socket. */
export interface SocketResponse {
	status: "approved" | "rejected";
	env?: Record<string, string>;
	reason?: string;
}

/** Returned by the request_token MCP tool. */
export interface TokenResult {
	token: string;
	sock: string;
}

/** Exit codes for the CLI. */
export const EXIT_REJECTED = 1;
export const EXIT_PROTOCOL_ERROR = 2;
