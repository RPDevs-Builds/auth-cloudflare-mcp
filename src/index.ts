import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";

export class MyMCP extends McpAgent {
	server = new McpServer({
		name: "Secure Edge Calculator",
		version: "1.0.0",
	});

	// 🛡️ OAUTH RESOURCE SERVER
	async fetch(request: Request) {
		// 1. Bypass Auth for CORS Preflight (OPTIONS requests have no tokens)
		if (request.method === "OPTIONS") {
			return super.fetch(request);
		}

		const authHeader = request.headers.get("Authorization");

		// 2. Require Bearer Token & inject Google's mandatory WWW-Authenticate header
		if (!authHeader || !authHeader.startsWith("Bearer ")) {
			return new Response("Unauthorized: Missing Bearer Token", { 
				status: 401,
				headers: {
					"WWW-Authenticate": "Bearer realm=\"mcp-server\""
				}
			});
		}

		const token = authHeader.split(" ")[1];

		// 3. Ping your T430 Authentik instance to validate the token
		const authCheck = await fetch("https://auth.iamrp.dev/application/o/userinfo/", {
			headers: {
				"Authorization": `Bearer ${token}`
			}
		});

		// 4. Reject the request if Authentik says the token is invalid or expired
		if (!authCheck.ok) {
			return new Response("Unauthorized: OAuth Token rejected by Authentik", { 
				status: 401, 
				headers: {
					"WWW-Authenticate": "Bearer error=\"invalid_token\""
				}
			});
		}

		// 5. If authorized, pass the request to the underlying MCP Engine
		return super.fetch(request);
	}

	async init() {
		this.server.registerTool(
			"add",
			{ inputSchema: { a: z.number(), b: z.number() } },
			async ({ a, b }) => ({
				content: [{ type: "text", text: String(a + b) }],
			})
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

// 🚀 ES MODULE ENTRYPOINT
export default {
	async fetch(request: Request, env: any, ctx: any) {
		const id = env.MCP_OBJECT.idFromName("default-agent");
		const stub = env.MCP_OBJECT.get(id);
		return stub.fetch(request);
	}
};
