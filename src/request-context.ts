import { AsyncLocalStorage } from "node:async_hooks";
import type { ApiCredentialProvider, AuthContext } from "./auth.js";
export type RequestContext = { auth: AuthContext; credentials: ApiCredentialProvider };
const storage = new AsyncLocalStorage<RequestContext>();
const testContext: RequestContext = {
  auth: { method: "local_api_key", principal: "test", scopes: new Set(["*"]) },
  credentials: { async getAuthorization() { return "Bearer " + (process.env.FINANCE_TRACKER_API_KEY || ""); } },
};
export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T { return storage.run(context, fn); }
export function getRequestContext(): RequestContext {
  const context = storage.getStore();
  if (!context && process.env.NODE_ENV === "test") return testContext;
  if (!context) throw new Error("No authenticated request context");
  return context;
}
export function runInvocationWithContext<T>(context: RequestContext | undefined, fn: () => T): T { return context ? runWithRequestContext(context, fn) : fn(); }
