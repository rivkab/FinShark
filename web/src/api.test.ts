import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "./api.ts";

type Call = { url: string; init: RequestInit };
let calls: Call[];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function stub(respond: (url: string, init: RequestInit) => Response): void {
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    return url === "/api/session" ? json({ csrfToken: "tok", personId: null }) : respond(url, init);
  });
}

const headers = (c: Call) => c.init.headers as Record<string, string>;

beforeEach(() => {
  calls = [];
});
afterEach(() => vi.unstubAllGlobals());

describe("api client", () => {
  it("GET sends no CSRF header or body, and unwraps the list", async () => {
    stub(() => json({ facts: [{ id: 1 }] }));
    const facts = await api.facts.list({ status: "proposed", document: 7 });
    expect(facts).toEqual([{ id: 1 }]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("/api/facts?status=proposed&document=7");
    expect(calls[0]!.init.method).toBe("GET");
    expect(headers(calls[0]!)["X-FinShark-CSRF"]).toBeUndefined();
    expect(calls[0]!.init.body).toBeUndefined();
  });

  it("mutations fetch the session first and send the CSRF header and JSON body", async () => {
    stub(() => json({ fact: { id: 5 } }));
    const fact = await api.facts.verify(5, [2, 3]);
    expect(fact).toEqual({ id: 5 });
    const post = calls.at(-1)!;
    expect(post.url).toBe("/api/facts/5/verify");
    expect(post.init.method).toBe("POST");
    expect(headers(post)["X-FinShark-CSRF"]).toBe("tok");
    expect(headers(post)["Content-Type"]).toBe("application/json");
    expect(post.init.body).toBe(JSON.stringify({ replace: [2, 3] }));
  });

  it("uses the right verb and path for PATCH and PUT", async () => {
    stub(() => json({}));
    await api.documents.update(3, { status: "reviewed" });
    await api.accounts.setName(4, { displayName: "X", altName: null });
    const [patch, put] = calls.slice(-2);
    expect([patch!.init.method, patch!.url, patch!.init.body]).toEqual(["PATCH", "/api/documents/3", '{"status":"reviewed"}']);
    expect([put!.init.method, put!.url]).toEqual(["PUT", "/api/accounts/4/name"]);
  });

  it("encodes path segments and query values", async () => {
    stub(() => json({}));
    await api.backups.verify("a b/c.age");
    expect(calls.at(-1)!.url).toBe("/api/backups/a%20b%2Fc.age/verify");
    await api.fbar.report(2024);
    expect(calls.at(-1)!.url).toBe("/api/fbar?year=2024");
    await api.fbar.report(null);
    expect(calls.at(-1)!.url).toBe("/api/fbar");
  });

  it("throws ApiError with status, code and conflicts on a non-OK response", async () => {
    stub(() => json({ error: "conflict", message: "Resolve it first.", details: { conflicts: [{ id: 9 }] } }, 409));
    const err = await api.facts.verify(1).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    const e = err as ApiError;
    expect([e.status, e.code, e.message]).toEqual([409, "conflict", "Resolve it first."]);
    expect(e.conflicts).toEqual([{ id: 9 }]);
  });
});
