import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { FactDetailDto, FactDto, ProposeFactResponse } from "@finshark/shared";
import { makePdf, sampleStatementPdf } from "../../testing/pdf-fixture.ts";
import { makeRealVault, type RealTestVault } from "../../testing/test-vault.ts";
import { buildServer } from "../server.ts";

const PORT = 4555;
const TOKEN = "route-test-token";
const HOST = `127.0.0.1:${PORT}`;

let v: RealTestVault;
let app: FastifyInstance;
let cookie: string;
let csrf: string;
let n = 0;

beforeEach(async () => {
  v = await makeRealVault();
  app = buildServer({
    vault: v.vault,
    port: PORT,
    token: TOKEN,
    now: v.now,
    newId: () => `id${++n}`,
    randomId: () => `sess${++n}`,
    maxUploadBytes: 200_000,
  });
  const auth = await app.inject({ method: "GET", url: `/auth?token=${TOKEN}`, headers: { host: HOST } });
  cookie = String(auth.headers["set-cookie"]).split(";")[0]!;
  const sess = await app.inject({ method: "GET", url: "/api/session", headers: { host: HOST, cookie } });
  csrf = sess.json().csrfToken;
});
afterEach(async () => {
  await app.close();
  await v.cleanup();
});

async function call(method: "GET" | "POST" | "PATCH", url: string, body?: unknown, extra: Record<string, string> = {}) {
  const isRaw = Buffer.isBuffer(body) || body instanceof Uint8Array;
  const res = await app.inject({
    method,
    url,
    headers: { host: HOST, cookie, "x-finshark-csrf": csrf, ...extra },
    ...(body === undefined ? {} : { payload: isRaw ? Buffer.from(body as Uint8Array) : JSON.stringify(body) }),
    ...(body !== undefined && !isRaw ? { headers: { host: HOST, cookie, "x-finshark-csrf": csrf, "content-type": "application/json", ...extra } } : {}),
  });
  return res;
}

const upload = (bytes: Uint8Array, name = "stmt.pdf", query = "") =>
  call("POST", `/api/documents${query}`, bytes, { "content-type": "application/pdf", "x-filename": encodeURIComponent(name) });

async function choosePerson() {
  const p = await call("POST", "/api/people", { displayName: "Dana" });
  expect(p.statusCode).toBe(201);
  const id = p.json().id as number;
  const r = await call("POST", "/api/session/person", { personId: String(id) });
  expect(r.statusCode).toBe(200);
  return id;
}

describe("person handling", () => {
  it("rejects mutations until a person is chosen (409 choose_person), but allows creating people", async () => {
    for (const [m, u, b] of [
      ["POST", "/api/institutions", { name: "X", country: "US" }],
      ["POST", "/api/facts", {}],
      ["POST", "/api/attestations", {}],
      ["POST", "/api/facts/1/verify", undefined],
      ["POST", "/api/documents", sampleStatementPdf()],
    ] as const) {
      const res = await call(m, u, b, b instanceof Uint8Array ? { "content-type": "application/pdf" } : {});
      expect(res.statusCode, u).toBe(409);
      expect(res.json()).toMatchObject({ error: "choose_person" });
    }
    expect((await call("POST", "/api/people", { displayName: "Dana" })).statusCode).toBe(201);
    expect((await call("GET", "/api/people")).json().people).toEqual([{ id: 1, displayName: "Dana" }]);
    // reads are fine
    expect((await call("GET", "/api/review-queue")).statusCode).toBe(200);
  });

  it("validates the person id against the people table", async () => {
    expect((await call("POST", "/api/session/person", { personId: "7" })).statusCode).toBe(400);
    expect((await call("POST", "/api/session/person", { personId: "abc" })).statusCode).toBe(400);
    await choosePerson();
    expect((await call("GET", "/api/session")).json().personId).toBe("1");
  });

  it("still enforces auth and CSRF", async () => {
    const noCookie = await app.inject({ method: "GET", url: "/api/people", headers: { host: HOST } });
    expect(noCookie.statusCode).toBe(401);
    const noCsrf = await app.inject({ method: "POST", url: "/api/people", headers: { host: HOST, cookie, "content-type": "application/json" }, payload: "{}" });
    expect(noCsrf.statusCode).toBe(403);
  });
});

describe("full flow", () => {
  it("upload -> institution/account -> propose by box -> review queue -> verify -> history", async () => {
    const person = await choosePerson();

    const pdf = sampleStatementPdf();
    const up = await upload(pdf, "Statement 2025 é.pdf", "?language=en&taxYear=2025");
    expect(up.statusCode).toBe(201);
    const imported = up.json();
    expect(imported).toMatchObject({ status: "imported", pageCount: 1, possibleDuplicateOf: [], possibleRevisionOf: [] });
    const documentId = imported.documentId as number;

    // File endpoint returns identical bytes.
    const file = await call("GET", `/api/documents/${documentId}/file`);
    expect(file.statusCode).toBe(200);
    expect(file.headers["content-type"]).toBe("application/pdf");
    expect(Buffer.compare(file.rawPayload, Buffer.from(pdf))).toBe(0);

    const doc = (await call("GET", `/api/documents/${documentId}`)).json();
    expect(doc).toMatchObject({ originalFilename: "Statement 2025 é.pdf", language: "en", taxYear: 2025, status: "inbox", factCount: 0 });
    expect(doc.pages).toEqual([{ pageNo: 1, widthPt: 612, heightPt: 792, rotation: 0, textSource: "native" }]);

    const layer = (await call("GET", `/api/documents/${documentId}/text-layer`)).json();
    expect(layer.pages[0].items.map((i: { str: string }) => i.str)).toContain("$83,421.17");

    // Institution (language defaults per D3) and account.
    const il = (await call("POST", "/api/institutions", { name: "בנק לדוגמה", country: "il" })).json();
    expect(il).toMatchObject({ country: "IL", language: "he" });
    const inst = (await call("POST", "/api/institutions", { name: "Example Brokerage", country: "US" })).json();
    expect(inst.language).toBe("en");
    const acct = await call("POST", "/api/accounts", { institutionId: inst.id, displayName: "Brokerage 4821", nativeCurrency: "USD" });
    expect(acct.statusCode).toBe(201);
    expect(acct.json()).toMatchObject({ language: "en", country: "US", institutionName: "Example Brokerage", identifiers: [] });
    const accountId = acct.json().id as number;
    const withIdent = (await call("POST", `/api/accounts/${accountId}/identifiers`, { kind: "last4", value: "4821" })).json();
    expect(withIdent.identifiers).toMatchObject([{ kind: "last4", value: "4821" }]);
    expect((await call("GET", "/api/accounts")).json().accounts).toHaveLength(1);

    const patched = await call("PATCH", `/api/documents/${documentId}`, { institutionId: inst.id, docType: "doc_type/bank_statement", periodStart: "2025-01-01", periodEnd: "2025-12-31", status: "reviewed" });
    // doc type slugs are seed data; accept either a valid term or a clean 400
    if (patched.statusCode === 200) expect(patched.json()).toMatchObject({ institutionId: inst.id, status: "reviewed", periodEnd: "2025-12-31" });
    else expect(patched.json().error).toBe("bad_request");
    const patch2 = await call("PATCH", `/api/documents/${documentId}`, { institutionId: inst.id, periodStart: "2025-01-01", periodEnd: "2025-12-31", status: "reviewed" });
    expect(patch2.statusCode).toBe(200);
    expect(patch2.json()).toMatchObject({ institutionId: inst.id, status: "reviewed", periodEnd: "2025-12-31" });
    const back = await call("PATCH", `/api/documents/${documentId}`, { status: "inbox" });
    expect(back.statusCode).toBe(200);
    expect(back.json().status).toBe("inbox");
    expect((await call("GET", `/api/documents/${documentId}`)).json().status).toBe("inbox");
    expect((await call("PATCH", `/api/documents/${documentId}`, { periodStart: "2025-02-30" })).statusCode).toBe(400);
    expect((await call("PATCH", `/api/documents/${documentId}`, { status: "removed" })).statusCode).toBe(400);
    expect((await call("POST", `/api/documents/${documentId}/accounts`, { accountId })).json().accountIds).toEqual([accountId]);

    // Concepts and terms.
    const concepts = (await call("GET", "/api/concepts")).json().concepts as { id: string }[];
    expect(concepts.map((c) => c.id)).toContain("balance.ending");
    expect((await call("GET", "/api/terms")).json().taxonomies.length).toBeGreaterThan(0);

    // Propose by box.
    const proposed = await call("POST", "/api/facts", {
      documentId,
      pageNo: 1,
      bbox: [395, 595, 480, 615],
      conceptId: "balance.ending",
      accountId,
      value: "$83,421.17",
      currency: "USD",
      instantDate: "2025-12-31",
      quotedText: "client lies",
    });
    expect(proposed.statusCode).toBe(201);
    const pr = proposed.json() as ProposeFactResponse;
    expect(pr.valueMatchesSource).toBe(true);
    expect(pr.fact).toMatchObject({
      status: "proposed",
      origin: "manual",
      valueMinor: "8342117",
      formatted: "$83,421.17",
      currency: "USD",
      createdBy: person,
      accountName: "Brokerage 4821",
    });
    expect(pr.fact.sources[0]).toMatchObject({ quotedText: "$83,421.17", pageNo: 1, documentId });

    const queue = (await call("GET", "/api/review-queue")).json().items as FactDto[];
    expect(queue.map((f) => f.id)).toEqual([pr.fact.id]);
    expect(queue[0]!.conceptLabelEn).toBe("Ending balance");

    const verify = await call("POST", `/api/facts/${pr.fact.id}/verify`);
    expect(verify.statusCode).toBe(200);
    expect(verify.json().fact).toMatchObject({ status: "verified", verifiedBy: person });
    expect((await call("GET", "/api/review-queue")).json().items).toEqual([]);

    const detail = (await call("GET", `/api/facts/${pr.fact.id}`)).json() as FactDetailDto;
    expect(detail.events.map((e) => [e.event, e.actorName])).toEqual([["proposed", "Dana"], ["verified", "Dana"]]);
    expect(detail.supersedes).toEqual([]);

    // Filters.
    const q = (s: string) => call("GET", `/api/facts?${s}`);
    expect((await q(`status=verified&concept=balance.ending&account=${accountId}&document=${documentId}`)).json().facts).toHaveLength(1);
    expect((await q("status=proposed")).json().facts).toHaveLength(0);
    expect((await q("status=bogus")).statusCode).toBe(400);

    // Conflict -> 409 with structured details; correct; reject; reopen.
    const other = (
      await call("POST", "/api/facts", { documentId, pageNo: 1, bbox: [395, 595, 480, 615], conceptId: "balance.ending", accountId, value: "$1.00", currency: "USD", instantDate: "2025-12-31" })
    ).json() as ProposeFactResponse;
    expect(other.valueMatchesSource).toBe(false);
    const conflict = await call("POST", `/api/facts/${other.fact.id}/verify`);
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ error: "conflict", details: { conflicts: [{ id: pr.fact.id }] } });

    const corrected = await call("POST", `/api/facts/${other.fact.id}/correct`, { value: "$83,421.17", verify: true });
    expect(corrected.statusCode).toBe(201);
    expect(corrected.json()).toMatchObject({ fact: { status: "verified", origin: "user_correction", supersedesFactId: other.fact.id }, superseded: { status: "superseded" }, corroboratedBy: [pr.fact.id] });

    const rej = await call("POST", `/api/facts/${pr.fact.id}/reject`, { reason: "oops" });
    expect(rej.json().fact.status).toBe("rejected");
    expect((await call("POST", `/api/facts/${pr.fact.id}/reject`, {})).statusCode).toBe(400);
    expect((await call("POST", `/api/facts/${pr.fact.id}/reopen`)).json().fact.status).toBe("proposed");
    expect((await call("POST", `/api/facts/${pr.fact.id}/reopen`)).statusCode).toBe(409);

    // Attestation.
    const noNote = await call("POST", "/api/attestations", { conceptId: "status.account_closed", accountId, value: "true", instantDate: "2025-06-30" });
    expect(noNote.statusCode).toBe(400);
    expect(noNote.json().error).toBe("note_required");
    const att = await call("POST", "/api/attestations", { conceptId: "status.account_closed", accountId, value: "true", instantDate: "2025-06-30", note: "Told us by phone" });
    expect(att.statusCode).toBe(201);
    expect(att.json().fact).toMatchObject({ origin: "attestation", sources: [], valueMatchesSource: null });
  });

  it("maps domain refusals to 400/404 with structured errors", async () => {
    await choosePerson();
    const documentId = (await upload(sampleStatementPdf())).json().documentId as number;
    const inst = (await call("POST", "/api/institutions", { name: "Example Brokerage", country: "US" })).json();
    const accountId = (await call("POST", "/api/accounts", { institutionId: inst.id, displayName: "Brokerage 4821", nativeCurrency: "USD" })).json().id as number;
    const base = { documentId, pageNo: 1, bbox: [395, 595, 480, 615], conceptId: "balance.ending", accountId, value: "$1.00", currency: "USD", instantDate: "2025-12-31" };
    const bad = async (over: Record<string, unknown>, status: number, error: string) => {
      const r = await call("POST", "/api/facts", { ...base, ...over });
      expect([r.statusCode, r.json().error], JSON.stringify(over)).toEqual([status, error]);
      expect(typeof r.json().message).toBe("string");
    };
    await bad({ accountId: undefined }, 400, "subject_required");
    await bad({ instantDate: undefined }, 400, "bad_period");
    await bad({ currency: undefined }, 400, "bad_value");
    await bad({ value: "1.234,56" }, 400, "bad_value");
    await bad({ bbox: [0, 0, 2000, 2000] }, 400, "bad_bbox");
    await bad({ bbox: "x" }, 400, "bad_request");
    await bad({ documentId: 99 }, 404, "not_found");
    await bad({ conceptId: "nope" }, 400, "bad_input");
    expect((await call("GET", "/api/facts/999")).statusCode).toBe(404);
    expect((await call("GET", "/api/facts/abc")).statusCode).toBe(404);
    expect((await call("GET", "/api/documents/999")).statusCode).toBe(404);
    expect((await call("GET", "/api/documents/999/file")).statusCode).toBe(404);
  });
});

describe("people", () => {
  it("adds more people at any time, with unique names", async () => {
    await choosePerson(); // Dana
    const second = await call("POST", "/api/people", { displayName: "Noa" });
    expect(second.statusCode).toBe(201);
    const dup = await call("POST", "/api/people", { displayName: "  dana " });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error).toBe("duplicate_name");
    const list = (await call("GET", "/api/people")).json().people.map((p: { displayName: string }) => p.displayName);
    expect(list).toEqual(["Dana", "Noa"]);
    // The new person can be chosen as the one using FinShark.
    expect((await call("POST", "/api/session/person", { personId: String(second.json().id) })).statusCode).toBe(200);
  });
});

describe("account numbers", () => {
  beforeEach(() => {
    chosen = false;
  });
  let chosen = false;
  async function account(body: Record<string, unknown> = {}) {
    if (!chosen) {
      await choosePerson();
      chosen = true;
    }
    const inst = (await call("POST", "/api/institutions", { name: "Example Bank", country: "US" })).json();
    return call("POST", "/api/accounts", { institutionId: inst.id, displayName: "Checking", nativeCurrency: "USD", ...body });
  }
  const put = (id: number, accountNumber: unknown) =>
    app.inject({
      method: "PUT",
      url: `/api/accounts/${id}/account-number`,
      headers: { host: HOST, cookie, "x-finshark-csrf": csrf, "content-type": "application/json" },
      payload: JSON.stringify({ accountNumber }),
    });

  it("is set at creation and normalized", async () => {
    const res = await account({ accountNumber: "  12-345  678 " });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      accountNumber: "12-345 678",
      identifiers: [{ kind: "account_number", value: "12-345 678", validFrom: null, validTo: null }],
    });
  });

  it("keeps the previous number as history when it changes", async () => {
    const id = (await account({ accountNumber: "111" })).json().id as number;
    const changed = await put(id, "222");
    expect(changed.statusCode).toBe(200);
    const today = v.now().toISOString().slice(0, 10);
    expect(changed.json().accountNumber).toBe("222");
    expect(changed.json().identifiers).toMatchObject([
      { kind: "account_number", value: "111", validFrom: null, validTo: today },
      { kind: "account_number", value: "222", validFrom: today, validTo: null },
    ]);
    // Same number again changes nothing; null clears the current number but keeps history.
    expect((await put(id, "222")).json().identifiers).toHaveLength(2);
    const cleared = (await put(id, null)).json();
    expect(cleared.accountNumber).toBeNull();
    expect(cleared.identifiers).toHaveLength(2);
  });

  it("rejects invalid numbers and unknown accounts", async () => {
    expect((await account({ accountNumber: "12;DROP" })).statusCode).toBe(400);
    const id = (await account()).json().id as number;
    expect((await put(id, "x".repeat(65))).statusCode).toBe(400);
    expect((await put(id, 12345)).statusCode).toBe(400);
    expect((await put(9999, "123")).statusCode).toBe(404);
  });

  it("requires a chosen person", async () => {
    const inst = (await call("POST", "/api/institutions", { name: "X", country: "US" })).statusCode;
    expect(inst).toBe(409);
  });
});

describe("uploads", () => {
  it("reports an exact duplicate, and possible duplicates/revisions", async () => {
    await choosePerson();
    const first = (await upload(sampleStatementPdf(), "a.pdf", "?identityKey=ex|4821|2025")).json();
    const dup = await upload(sampleStatementPdf(), "b.pdf");
    expect(dup.statusCode).toBe(200);
    expect(dup.json()).toEqual({ status: "duplicate", existingDocumentId: first.documentId, sha256: first.sha256 });

    // Same text, different bytes -> possible duplicate; same identity key -> possible revision.
    const bytes = Buffer.from(sampleStatementPdf()).toString("latin1").replace(/%%EOF\n$/, "%x\n%%EOF\n");
    const again = (await upload(new Uint8Array(Buffer.from(bytes, "latin1")), "c.pdf", "?identityKey=ex|4821|2025")).json();
    expect(again).toMatchObject({ status: "imported", possibleDuplicateOf: [first.documentId], possibleRevisionOf: [first.documentId] });
    expect((await call("GET", "/api/documents")).json().documents).toHaveLength(2);
    // Temp upload dirs are cleaned up.
    expect((await fs.readdir(v.vault.layout.inboxDir)).filter((f) => f.startsWith(".upload"))).toEqual([]);
  });

  it("refuses non-PDFs, wrong content types, oversize bodies, bad filenames", async () => {
    await choosePerson();
    const notPdf = await upload(new Uint8Array(Buffer.from("hello")), "x.pdf");
    expect(notPdf.statusCode).toBe(400);
    expect(notPdf.json().error).toBe("not_a_pdf");
    const json = await call("POST", "/api/documents", {});
    expect(json.statusCode).toBe(415);
    const big = await upload(new Uint8Array(300_000), "big.pdf");
    expect(big.statusCode).toBe(413);
    expect(big.json().error).toBe("payload_too_large");
    const badName = await call("POST", "/api/documents", sampleStatementPdf(), { "content-type": "application/pdf", "x-filename": "%E0%A4%A" });
    expect(badName.statusCode).toBe(400);
    // Path tricks in the filename only ever yield a base name.
    const sneaky = (await upload(sampleStatementPdf(), "../../etc/passwd")).json();
    expect((await call("GET", `/api/documents/${sneaky.documentId}`)).json().originalFilename).toBe("passwd");
    expect(await fs.readdir(path.dirname(v.vault.layout.root))).not.toContain("etc");
  });

  it("serves a document with no text layer and lets a typed value be proposed", async () => {
    await choosePerson();
    const documentId = (await upload(makePdf([{ texts: [] }]), "scan.pdf")).json().documentId as number;
    const inst = (await call("POST", "/api/institutions", { name: "Example Brokerage", country: "US" })).json();
    const accountId = (await call("POST", "/api/accounts", { institutionId: inst.id, displayName: "Brokerage 4821", nativeCurrency: "USD" })).json().id as number;
    const r = await call("POST", "/api/facts", { documentId, pageNo: 1, bbox: [100, 100, 200, 120], conceptId: "balance.ending", accountId, value: "5", currency: "USD", instantDate: "2025-12-31" });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ valueMatchesSource: null, fact: { sources: [{ quotedText: null }] } });
  });
});
