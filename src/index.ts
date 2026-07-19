import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";

export class MyMCP extends McpAgent {
	server = new McpServer({
		name: "Secure Edge Calculator",
		version: "1.0.0",
	});

	// 🛡️ SECURITY GATEWAY: Intercept requests before they hit the MCP engine
	async fetch(request: Request) {
		const url = new URL(request.url);
		const token = url.searchParams.get("token");

		// Compare the incoming token to your Cloudflare encrypted secret
		// @ts-ignore - Bypass strict TS if Env is not fully mapped in worker-configuration.d.ts
		if (token !== this.env.MCP_SECRET_KEY) {
			return new Response("Unauthorized: Invalid or missing token", { status: 401 });
		}

		// If authorized, pass the request to the underlying MCP Agent handler
		return super.fetch(request);
	}

	async init() {
		// Simple addition tool
		this.server.registerTool(
			"add",
			{ inputSchema: { a: z.number(), b: z.number() } },
			async ({ a, b }) => ({
				content: [{ type: "text", text: String(a + b) }],
			}),
		);

		// Calculator tool with multiple operations
		this.server.registerTool(
			"calculate",
			{
				inputSchema: {
					operation: z.enum(["add", "subtract", "multiply", "divide"]),
					a: z.number(),
					b: z.number(),
				},
			},
			async ({ operation, a, b }) => {
				let result: number;
				switch (operation) {
					case "add":
						result = a + b;
						break;
					case "subtract":
						result = a - b;
						break;
					case "multiply":
						result = a * b;
						break;
					case "divide":
						if (b === 0)
							return {
								content: [
									{
										type: "text",
										text: "Error: Cannot divide by zero",
									},
								],
							};
						result = a / b;
						break;
				}
				return { content: [{ type: "text", text: String(result) }] };
			}
		);
	}
}
