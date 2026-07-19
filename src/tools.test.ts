import { beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "./index.js";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

type Registered = {
  handler: (params: Record<string, unknown>) => Promise<unknown>;
  inputSchema: { safeParse: (value: unknown) => { success: boolean } };
  annotations?: Record<string, unknown>;
  description?: string;
};
const tools = (server as unknown as { _registeredTools: Record<string, Registered> })._registeredTools;

describe("MCP tool registration", () => {
  beforeEach(() => fetchMock.mockReset());

  it("marks reads and permanent deletion correctly", () => {
    expect(tools.list_expenses.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(tools.delete_person.annotations).toMatchObject({ destructiveHint: true });
    expect(tools.delete_person.description).toContain("Permanently");
  });

  it("passes destructive tool IDs to the correct API route", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ ok: true }) });
    await tools.delete_account.handler({ id: "account-7" });
    expect(fetchMock.mock.calls[0][0]).toContain("/api/accounts/account-7");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "DELETE" });
  });

  it("returns MCP error content for API failures", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, json: vi.fn().mockResolvedValue({ error: "Read-only access" }) });
    await expect(tools.delete_account.handler({ id: "account-7" })).resolves.toMatchObject({ isError: true });
  });

  it("accepts numeric expense minimums without nullable-union schemas", () => {
    expect(tools.update_expense.inputSchema.safeParse({ id: "expense-1", spendingTier: "ESSENTIAL", minimumAmount: 50 }).success).toBe(true);
    expect(tools.update_expense.inputSchema.safeParse({ id: "expense-1", minimumAmount: "50" }).success).toBe(false);
  });

  it("maps explicit clear flags to API nulls", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ ok: true }) });
    await tools.update_expense.handler({ id: "expense-1", clearSpendingTier: true, clearMinimumAmount: true });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      spendingTier: null,
      minimumAmount: null,
    });
  });
});
