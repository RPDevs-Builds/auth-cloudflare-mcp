import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";

// 1. Define the Durable Object Agent
export class MyMCP extends McpAgent {
	server = new McpServer({
		name: "Secure Edge Calculator",
		version: "1.0.0",
	});

	// 🛡️ SECURITY GATEWAY
	async fetch(request: Request) {
		const url = new URL(request.url);
		const token = url.searchParams.get("token");

		// @ts-ignore - Bypass strict TS for dynamic Env mapping
		if (token !== this.env.MCP_SECRET_KEY) {
			return new Response("Unauthorized: Invalid or missing token", { status: 401 });
		}

		return super.fetch(request);
	}

	async init() {
		this.server.registerTool(
			"add",
			{ inputSchema: { a: z.number(), b: z.number() } },
			async ({ a, b }) => ({
				content: [{ type: "text", text: String(a + b) }],
			}),
		);

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
						if (b === 0) return { content: [{ type: "text", text: "Error: Cannot divide by zero" }] };
						result = a / b;
						break;
				}
				return { content: [{ type: "text", text: String(result) }] };
			}
		);
	}
}

// 2. 🚀 THE MISSING ES MODULE ENTRYPOINT 🚀
export default {
	async fetch(request: Request, env: any, ctx: any) {
		// Route the incoming HTTP request from the Edge directly to the Durable Object
		const id = env.MCP_OBJECT.idFromName("default-agent");
		const stub = env.MCP_OBJECT.get(id);
		return stub.fetch(request);
	}
};
