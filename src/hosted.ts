import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { AuthError, assertRuntimeMode, createAuthenticator, createCredentialProvider } from "./auth.js";
import { createFinanceTrackerServer } from "./index.js";
import { runWithRequestContext } from "./request-context.js";
function baseUrl(): string { return (process.env.MCP_PUBLIC_URL || "http://localhost:3000").replace(/\/+$/, ""); }
export function mcpResourceUrl(): string { return baseUrl() + "/mcp"; }
export function assertHostedResourceConfiguration(): void {
  if (process.env.OAUTH_AUDIENCE?.trim() !== mcpResourceUrl()) throw new Error("OAUTH_AUDIENCE must equal " + mcpResourceUrl());
}
function challenge(): string { return `Bearer resource_metadata="${baseUrl()}/.well-known/oauth-protected-resource"`; }
export async function handleMcpNodeRequest(request: IncomingMessage & { body?: unknown }, response: ServerResponse): Promise<void> {
  try {
    assertRuntimeMode("streamable_http", "oauth_bearer");
    assertHostedResourceConfiguration();
    const auth = await createAuthenticator("oauth_bearer").authenticate({ authorization: request.headers.authorization });
    const context = { auth, credentials: createCredentialProvider("oauth_bearer") };
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    const server = createFinanceTrackerServer();
    await runWithRequestContext(context, async () => {
      await server.connect(transport);
      await transport.handleRequest(request, response, request.body);
    });
  } catch (error) {
    const status = error instanceof AuthError ? error.status : 401;
    response.statusCode = status;
    response.setHeader("Content-Type", "application/json");
    if (status === 401) response.setHeader("WWW-Authenticate", challenge());
    response.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: status === 401 ? "Unauthorized" : "Forbidden" }, id: null }));
  }
}
export function writeProtectedResourceMetadata(response: ServerResponse): void {
  if (!process.env.OAUTH_ISSUER) {
    response.statusCode = 500;
    response.end(JSON.stringify({ error: "OAUTH_ISSUER is not configured" }));
    return;
  }
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify({ resource: mcpResourceUrl(), authorization_servers: [process.env.OAUTH_ISSUER], scopes_supported: ["finance:read", "finance:write", "finance:destructive"] }));
}

