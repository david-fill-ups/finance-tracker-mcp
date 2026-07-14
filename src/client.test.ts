import { beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "./client.js";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

function response(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: vi.fn().mockResolvedValue(body) };
}

describe("finance tracker HTTP client", () => {
  beforeEach(() => fetchMock.mockReset());

  it("calls representative read, create, update, delete, and guest routes", async () => {
    fetchMock.mockResolvedValue(response([]));
    await client.listPeople({ limit: 10, offset: 20 });
    expect(fetchMock.mock.calls[0][0]).toContain("/api/people?limit=10&offset=20");

    fetchMock.mockResolvedValue(response({ id: "p1" }, 201));
    await client.createPerson({ name: "Alex" });
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "POST", body: JSON.stringify({ name: "Alex" }) });

    fetchMock.mockResolvedValue(response({ id: "p1" }));
    await client.updatePerson("p1", { name: "Jordan" });
    expect(fetchMock.mock.calls[2][0]).toContain("/api/people/p1");

    fetchMock.mockResolvedValue(response({ ok: true }));
    await client.deletePerson("p1");
    expect(fetchMock.mock.calls[3][1]).toMatchObject({ method: "DELETE" });

    fetchMock.mockResolvedValue(response({ id: "g1" }, 201));
    await client.inviteGuest({ email: "guest@example.com", permission: "VIEW" });
    expect(fetchMock.mock.calls[4][0]).toContain("/api/profile/guests");
  });

  it("follows pagination until the final partial page", async () => {
    fetchMock
      .mockResolvedValueOnce(response(Array.from({ length: 250 }, (_, id) => ({ id }))))
      .mockResolvedValueOnce(response([{ id: 250 }]));
    await expect(client.listAllExpenses()).resolves.toHaveLength(251);
    expect(fetchMock.mock.calls[1][0]).toContain("offset=250");
  });

  it("surfaces API errors", async () => {
    fetchMock.mockResolvedValue(response({ error: "Read-only access" }, 403));
    await expect(client.deleteAccount("a1")).rejects.toThrow("403: Read-only access");
  });
});
