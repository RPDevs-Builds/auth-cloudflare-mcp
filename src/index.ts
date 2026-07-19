import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";

// 1. Define the Durable Object Agent
export class MyMCP extends McpAgent {
	server = new McpServer({
		name: "Secure Edge Calculator",
		version: "1.0.0",
	});

	// 🛡️ OAUTH RESOURCE SERVER: Intercept and Validate the JWT
	async fetch(request: Request) {
		const authHeader = request.headers.get("Authorization");

		// 1. Ensure the request has a Bearer token
		if (!authHeader || !authHeader.startsWith("Bearer ")) {
			return new Response("Unauthorized: Missing Bearer Token", { status: 401 });
		}

		const token = authHeader.split(" ")[1];

		// 2. Ping your T430 Authentik instance to validate the token
		// NOTE: Change 'auth.iamrp.dev' if your external Authentik URL differs
		const authCheck = await fetch("https://auth.iamrp.dev/application/o/userinfo/", {
			headers: {
				"Authorization": `Bearer ${token}`
			}
		});

		// 3. Reject the request if Authentik says the token is invalid or expired
		if (!authCheck.ok) {
			return new Response("Unauthorized: OAuth Token rejected by Authentik", { status: 403 });
		}

		// 4. If authorized, pass the request to the underlying MCP Engine
		return super.fetch(request);
	}

	async init() {
		this.server.registerTool(
			"add",
			{ inputSchema: { a: z.number(), b: z.number() } },
			async ({ a, b }) => ({\n\t\t\t\tcontent: [{ type: "text", text: String(a + b) }],\n\t\t\t}),
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

// 2. 🚀 ES MODULE ENTRYPOINT 🚀
export default {
	async fetch(request: Request, env: any, ctx: any) {
		// Route the incoming HTTP request from the Edge directly to the Durable Object
		const id = env.MCP_OBJECT.idFromName("default-agent");
		const stub = env.MCP_OBJECT.get(id);
		return stub.fetch(request);
	}
};
