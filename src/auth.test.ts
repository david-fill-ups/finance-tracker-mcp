import { describe, expect, it } from "vitest";
import { PolicyAuthorizer, AuthError } from "./auth.js";
import { requireToolPolicy } from "./policies.js";
import { getRequestContext, runWithRequestContext } from "./request-context.js";

describe("hosted authorization", () => {
  it("classifies reads and disables destructive tools", () => {
    expect(requireToolPolicy("get_profile")).toMatchObject({ impact: "read", requiredScopes: ["finance:read"], hostedEnabled: true });
    expect(requireToolPolicy("delete_account")).toMatchObject({ impact: "destructive", hostedEnabled: false });
    expect(requireToolPolicy("invite_guest").hostedEnabled).toBe(false);
  });
  it("fails closed for unregistered tools", () => {
    expect(() => requireToolPolicy("new_unreviewed_tool")).toThrow(/no explicit authorization policy/);
  });
  it("requires the domain scope", () => {
    expect(() => new PolicyAuthorizer().authorize(
      { method: "oauth_bearer", principal: "subject", scopes: new Set() },
      requireToolPolicy("get_profile"),
    )).toThrowError(AuthError);
  });
  it("isolates concurrent request state", async () => {
    const credentials = { getAuthorization: async () => "Bearer test" };
    const values = await Promise.all(["one", "two"].map((activeProfileId) =>
      runWithRequestContext({ auth: { method: "oauth_bearer", principal: activeProfileId, scopes: new Set(["finance:read"]), activeProfileId }, credentials },
        async () => { await Promise.resolve(); return getRequestContext().auth.activeProfileId; }),
    ));
    expect(values).toEqual(["one", "two"]);
  });
});
