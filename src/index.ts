import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";

// 🌐 Standardized CORS headers for Gemini Spark's web UI
const CORS_HEADERS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// 1. Define the Durable Object Agent
export class MyMCP extends McpAgent {
	server = new McpServer({
		name: "Secure Edge Calculator",
		version: "1.0.0",
	});

	// 🛡️ OAUTH RESOURCE SERVER: Intercept and Validate the JWT
	async fetch(request: Request) {
		// 1. Handle CORS Preflight (Crucial for Gemini's Web UI)
		if (request.method === "OPTIONS") {
			return new Response(null, {
				status: 204,
				headers: {
					...CORS_HEADERS,
					"Access-Control-Max-Age": "86400",
				},
			});
		}

		const authHeader = request.headers.get("Authorization");

		// 2. Enforce Bearer Token with Google-Compliant Headers
		if (!authHeader || !authHeader.startsWith("Bearer ")) {
			return new Response("Unauthorized", {
				status: 401,
				headers: {
					...CORS_HEADERS,
					"WWW-Authenticate": "Bearer",
				},
			});
		}

		const token = authHeader.split(" ")[1];

		// 3. Validate Token via Authentik
		try {
			const authCheck = await fetch("https://auth.iamrp.dev/application/o/userinfo/", {
				headers: {
					"Authorization": `Bearer ${token}`
				}
			});

			if (!authCheck.ok) {
				return new Response("Unauthorized: Invalid Token", {
					status: 401,
					headers: {
						...CORS_HEADERS,
						"WWW-Authenticate": "Bearer error=\"invalid_token\"",
					},
				});
			}
		} catch (err) {
			return new Response("Auth Gateway Error", {
				status: 502,
				headers: CORS_HEADERS,
			});
		}

		// 4. Pass to MCP SDK and wrap the final response with CORS
		const response = await super.fetch(request);
		const corsResponse = new Response(response.body, response);
		
		for (const [key, value] of Object.entries(CORS_HEADERS)) {
			corsResponse.headers.set(key, value);
		}

		return corsResponse;
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

// 2. 🚀 ES MODULE ENTRYPOINT 🚀
export default {
	async fetch(request: Request, env: any, ctx: any) {
		// Route the incoming HTTP request from the Edge directly to the Durable Object
		const id = env.MCP_OBJECT.idFromName("default-agent");
		const stub = env.MCP_OBJECT.get(id);
		return stub.fetch(request);
	}
};
