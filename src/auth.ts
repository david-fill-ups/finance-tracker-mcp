import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { createHmac } from "node:crypto";

export type AuthMode = "local_api_key" | "oauth_bearer";
export type AuthContext = { method: AuthMode; principal: string; scopes: ReadonlySet<string>; activeProfileId?: string };
export type RequestAuthInput = { authorization?: string | null };
export type ToolImpact = "read" | "write" | "destructive";
export type OperationPolicy = { domain: "finance"; impact: ToolImpact; requiredScopes: string[]; hostedEnabled: boolean };
export interface ApiCredentialProvider { getAuthorization(context: AuthContext): Promise<string> }

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
function scopes(payload: JWTPayload): Set<string> {
  const result = new Set<string>();
  if (typeof payload.scope === "string") for (const value of payload.scope.split(/\s+/)) if (value) result.add(value);
  if (Array.isArray(payload.permissions)) for (const value of payload.permissions) if (typeof value === "string") result.add(value);
  return result;
}
export class AuthError extends Error { constructor(message: string, readonly status: number) { super(message); } }
export class LocalAuthenticator {
  async authenticate(): Promise<AuthContext> {
    return { method: "local_api_key", principal: "local", scopes: new Set(["*"]), activeProfileId: process.env.FINANCE_TRACKER_PROFILE_ID?.trim() || undefined };
  }
}
export class OAuthAuthenticator {
  private readonly issuer = required("OAUTH_ISSUER").replace(/\/?$/, "/");
  private readonly audience = required("OAUTH_AUDIENCE");
  private readonly allowedSubject = required("OAUTH_ALLOWED_SUB");
  private readonly jwks = createRemoteJWKSet(new URL(process.env.OAUTH_JWKS_URI || `${this.issuer}.well-known/jwks.json`));
  async authenticate(input: RequestAuthInput): Promise<AuthContext> {
    const token = input.authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    if (!token) throw new AuthError("Missing bearer access token", 401);
    const { payload } = await jwtVerify(token, this.jwks, { issuer: this.issuer, audience: this.audience, algorithms: ["RS256"], clockTolerance: Number(process.env.OAUTH_CLOCK_TOLERANCE_SECONDS || 60) });
    if (!payload.sub || payload.sub !== this.allowedSubject) throw new AuthError("Unknown OAuth subject", 403);
    return { method: "oauth_bearer", principal: `${this.issuer}|${payload.sub}`, scopes: scopes(payload), activeProfileId: process.env.DEFAULT_PROFILE_ID?.trim() || undefined };
  }
}
export class PolicyAuthorizer {
  authorize(context: AuthContext, policy: OperationPolicy): void {
    if (context.method === "local_api_key") return;
    if (!policy.hostedEnabled) throw new AuthError("Tool is disabled in hosted mode", 403);
    for (const scope of policy.requiredScopes) if (!context.scopes.has(scope)) throw new AuthError(`Missing required scope: ${scope}`, 403);
  }
}
export class SafeAuditLogger {
  record(event: { action: string; principal: string; decision: "allowed" | "denied"; reason?: string }): void {
    const principal = event.principal === "local" ? "local" : createHmac("sha256", required("AUTH_LOG_HMAC_KEY")).update(event.principal).digest("hex").slice(0, 24);
    console.error(JSON.stringify({ type: "auth_audit", ...event, principal }));
  }
}
export function assertRuntimeMode(transport: "stdio" | "streamable_http", auth: AuthMode): void {
  if ((process.env.MCP_TRANSPORT || "stdio") !== transport) throw new Error(`${transport} bootstrap requires MCP_TRANSPORT=${transport}`);
  if ((process.env.AUTH_MODE || "local_api_key") !== auth) throw new Error(`${transport} bootstrap requires AUTH_MODE=${auth}`);
}
export function createAuthenticator(mode: AuthMode) { return mode === "oauth_bearer" ? new OAuthAuthenticator() : new LocalAuthenticator(); }
export function createCredentialProvider(mode: AuthMode): ApiCredentialProvider {
  const variable = mode === "oauth_bearer" ? "FINANCE_TRACKER_HOSTED_API_KEY" : "FINANCE_TRACKER_API_KEY";
  return { async getAuthorization() { return `Bearer ${required(variable)}`; } };
}

