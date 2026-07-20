import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";

export interface Env {
	AUTHENTIK_URL: string;
	INTERNAL_MCP_URL: string;
	CLIENT_ID: string;      // Injected via Secrets
	CLIENT_SECRET: string;  // Injected via Secrets
	MCP_OBJECT: DurableObjectNamespace;
}

// Universal CORS configuration
const CORS_HEADERS = {
	"Access-Control-Allow-Origin": "*", // Can be locked to spark.gemini.google.com in prod
	"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
	"Access-Control-Max-Age": "86400",
};

// 1. Define the Durable Object Agent incorporating the test calculator tools
export class MyMCP extends McpAgent {
	server = new McpServer({
		name: "Secure Edge Calculator",
		version: "1.0.0",
	});

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

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		// 1. Intercept Preflight (OPTIONS)
		if (request.method === "OPTIONS") {
			return new Response(null, { status: 204, headers: CORS_HEADERS });
		}

		// 2. Check for Authorization Header
		const authHeader = request.headers.get("Authorization");
		if (!authHeader || !authHeader.startsWith("Bearer ")) {
			return new Response(JSON.stringify({ error: "Missing Bearer Token" }), { 
				status: 401, 
				headers: { 
					...CORS_HEADERS, 
					"Content-Type": "application/json",
					"WWW-Authenticate": 'Bearer realm="iamrp.dev MCP Gateway"'
				} 
			});
		}

		const token = authHeader.split(" ")[1];

		// 3. Introspect the Token via Authentik
		const isValid = await validateToken(token, env);
		if (!isValid) {
			return new Response(JSON.stringify({ error: "Invalid or Expired Token" }), { 
				status: 403, 
				headers: { ...CORS_HEADERS, "Content-Type": "application/json" } 
			});
		}

		// 4. Decide whether to handle via Durable Object (MCP Agent) or Proxy to Internal LAN
		const url = new URL(request.url);
		
		// If the request targets an internal downstream server via environment mapping
		if (env.INTERNAL_MCP_URL && url.pathname.startsWith("/proxy")) {
			const targetUrl = `${env.INTERNAL_MCP_URL}${url.pathname.replace('/proxy', '')}${url.search}`;
			const proxyRequest = new Request(targetUrl, request);
			
			proxyRequest.headers.set("X-Forwarded-Host", url.hostname);
			proxyRequest.headers.delete("Authorization");

			try {
				const mcpResponse = await fetch(proxyRequest);
				const newResponse = new Response(mcpResponse.body, mcpResponse);
				Object.entries(CORS_HEADERS).forEach(([key, value]) => {
					newResponse.headers.set(key, value);
				});
				return newResponse;
			} catch (err) {
				return new Response(JSON.stringify({ error: "Internal Gateway Error" }), { 
					status: 502, 
					headers: { ...CORS_HEADERS, "Content-Type": "application/json" } 
				});
			}
		}

		// Otherwise, hand execution off to the Durable Object Agent (Calculator MCP)
		const id = env.MCP_OBJECT.idFromName("default-mcp-session");
		const stub = env.MCP_OBJECT.get(id);
		const agentResponse = await stub.fetch(request);

		// Wrap the agent response with CORS headers
		const corsResponse = new Response(agentResponse.body, agentResponse);
		Object.entries(CORS_HEADERS).forEach(([key, value]) => {
			corsResponse.headers.set(key, value);
		});

		return corsResponse;
	}
};

// Authentik Introspection Helper
async function validateToken(token: string, env: Env): Promise<boolean> {
	const credentials = btoa(`${env.CLIENT_ID}:${env.CLIENT_SECRET}`);
	
	try {
		const response = await fetch(`${env.AUTHENTIK_URL}/application/o/introspection/`, {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				"Authorization": `Basic ${credentials}`
			},
			body: new URLSearchParams({ token })
		});

		if (!response.ok) return false;
		const data: any = await response.json();
		return data.active === true;
	} catch (e) {
		console.error("Introspection failed:", e);
		return false;
	}
}
