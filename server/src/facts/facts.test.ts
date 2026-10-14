import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makePdf, sampleStatementPdf } from "../testing/pdf-fixture.ts";
import { makeRealVault, seedBasics, type RealTestVault } from "../testing/test-vault.ts";
import {
  correctFact,
  createAttestation,
  FactError,
  getFactWithHistory,
  listFacts,
  listReviewQueue,
  proposeManualFact,
  rejectFact,
  reopenFact,
  verifyFact,
  type FactErrorCode,
  type ManualFactInput,
} from "./index.ts";

let v: RealTestVault;
let actor: number;
let accountId: number;
let documentId: number;
let deps: { db: RealTestVault["vault"]["db"]; layout: RealTestVault["vault"]["layout"]; now: () => Date };

// Around "$83,421.17" (x=400, y=600) and around "$1,204.33" (y=580) in sampleStatementPdf.
const BALANCE_BOX: [number, number, number, number] = [395, 595, 480, 615];
const INTEREST_BOX: [number, number, number, number] = [395, 575, 480, 595];

beforeEach(async () => {
  v = await makeRealVault();
  const b = seedBasics(v);
  actor = b.personId;
  accountId = b.accountId;
  documentId = (await v.importPdf(sampleStatementPdf())).documentId;
  deps = { db: v.vault.db, layout: v.vault.layout, now: v.now };
});
afterEach(async () => {
  await v.cleanup();
});

function balance(over: Partial<ManualFactInput> = {}): ManualFactInput {
  return {
    documentId,
    pageNo: 1,
    bbox: BALANCE_BOX,
    conceptId: "balance.ending",
    accountId,
    value: "$83,421.17",
    currency: "USD",
    instantDate: "2025-12-31",
    ...over,
  };
}

async function expectRefusal(p: Promise<unknown> | (() => unknown), code: FactErrorCode, message?: RegExp) {
  try {
    await (typeof p === "function" ? p() : p);
    expect.unreachable("expected a FactError");
  } catch (e) {
    expect(e).toBeInstanceOf(FactError);
    expect((e as FactError).code).toBe(code);
    if (message) expect((e as FactError).message).toMatch(message);
  }
}

const count = (table: string) => (v.vault.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

describe("proposeManualFact", () => {
  it("creates run, fact, source, event and account link; quoted_text comes from the text layer", async () => {
    const view = await proposeManualFact(deps, actor, balance());
    expect(view.fact).toMatchObject({
      conceptId: "balance.ending",
      status: "proposed",
      origin: "manual",
      valueMinor: 8342117n,
      currency: "USD",
      instantDate: "2025-12-31",
      accountId,
      createdBy: actor,
      createdAt: "2026-10-14T12:00:00.000Z",
      verifiedAt: null,
    });
    expect(view.sources).toHaveLength(1);
    expect(view.sources[0]).toMatchObject({ documentId, pageNo: 1, bbox: BALANCE_BOX, quotedText: "$83,421.17" });
    expect(view.valueMatchesSource).toBe(true);

    const run = v.vault.db.prepare("SELECT * FROM extraction_runs WHERE id = ?").get(view.fact.extractionRunId!) as Record<string, unknown>;
    expect(run).toMatchObject({ document_id: documentId, extractor_id: "manual", extractor_version: "1", status: "succeeded" });
    const events = getFactWithHistory(v.vault.db, view.fact.id).events;
    expect(events.map((e) => [e.event, e.actor])).toEqual([["proposed", actor]]);
    expect(v.vault.db.prepare("SELECT * FROM document_accounts").all()).toHaveLength(1);
  });

  it("ignores any client-supplied quoted text", async () => {
    const view = await proposeManualFact(deps, actor, { ...balance(), quotedText: "$999.00" } as ManualFactInput);
    expect(view.sources[0]!.quotedText).toBe("$83,421.17");
  });

  it("keeps amounts beyond Number's exact range exact", async () => {
    const view = await proposeManualFact(deps, actor, balance({ value: "$90,071,992,547,409.93" }));
    expect(view.fact.valueMinor).toBe(9007199254740993n);
    expect(view.valueMatchesSource).toBe(false);
  });

  it("flags a typed value that differs from the source, and an ambiguous box", async () => {
    expect((await proposeManualFact(deps, actor, balance({ value: "83,421.18" }))).valueMatchesSource).toBe(false);
    const wide = await proposeManualFact(deps, actor, balance({ bbox: [395, 570, 480, 615] }));
    expect(wide.sources[0]!.quotedText).toBe("$83,421.17 $1,204.33");
    expect(wide.valueMatchesSource).toBe(false);
    const interest = await proposeManualFact(
      deps,
      actor,
      balance({ bbox: INTEREST_BOX, conceptId: "statement.interest_paid", value: "1,204.33", instantDate: undefined, periodStart: "2025-01-01", periodEnd: "2025-12-31" }),
    );
    expect(interest.valueMatchesSource).toBe(true);
  });

  it("an empty box has empty (not null) quoted text and does not match", async () => {
    const view = await proposeManualFact(deps, actor, balance({ bbox: [10, 10, 50, 50] }));
    expect(view.sources[0]!.quotedText).toBe("");
    expect(view.valueMatchesSource).toBe(false);
  });

  it("stores NULL quoted_text and a null flag when the page has no text layer", async () => {
    const scan = await v.importPdf(makePdf([{ texts: [] }]), "scan.pdf");
    const view = await proposeManualFact(deps, actor, balance({ documentId: scan.documentId }));
    expect(view.sources[0]!.quotedText).toBeNull();
    expect(view.valueMatchesSource).toBeNull();
  });

  it("accepts boolean, text and date concepts and period-less facts", async () => {
    const closed = await proposeManualFact(
      deps,
      actor,
      balance({ conceptId: "status.account_closed", value: "TRUE", currency: undefined }),
    );
    expect(closed.fact.valueText).toBe("true");
    expect(closed.valueMatchesSource).toBeNull();
    v.vault.db.exec(`INSERT INTO concepts (id, label_en, period_type, value_type) VALUES
      ('t.text', 'T', 'none', 'text'), ('t.date', 'D', 'none', 'date'), ('t.int', 'I', 'none', 'integer')`);
    const none = { instantDate: undefined, currency: undefined };
    expect((await proposeManualFact(deps, actor, balance({ ...none, conceptId: "t.text", value: " hello " }))).fact.valueText).toBe("hello");
    expect((await proposeManualFact(deps, actor, balance({ ...none, conceptId: "t.date", value: "2025-02-28" }))).fact.valueText).toBe("2025-02-28");
    expect((await proposeManualFact(deps, actor, balance({ ...none, conceptId: "t.int", value: "42" }))).fact.valueDecimal).toBe("42");
    await expectRefusal(proposeManualFact(deps, actor, balance({ ...none, conceptId: "t.date", value: "2025-02-30" })), "bad_value");
    await expectRefusal(proposeManualFact(deps, actor, balance({ ...none, conceptId: "t.int", value: "4.2" })), "bad_value");
    await expectRefusal(proposeManualFact(deps, actor, balance({ ...none, conceptId: "t.text", value: "x", currency: "USD" })), "bad_value");
    await expectRefusal(proposeManualFact(deps, actor, balance({ conceptId: "status.account_closed", value: "maybe", currency: undefined })), "bad_value");
  });

  it("refuses bad periods", async () => {
    await expectRefusal(proposeManualFact(deps, actor, balance({ instantDate: undefined })), "bad_period", /instantDate is required/);
    await expectRefusal(proposeManualFact(deps, actor, balance({ periodStart: "2025-01-01", periodEnd: "2025-12-31" })), "bad_period");
    await expectRefusal(
      proposeManualFact(deps, actor, balance({ conceptId: "income.interest", instantDate: "2025-12-31" })),
      "bad_period",
      /periodStart and periodEnd are required/,
    );
    await expectRefusal(
      proposeManualFact(deps, actor, balance({ conceptId: "income.interest", instantDate: undefined, periodStart: "2025-12-31", periodEnd: "2025-01-01" })),
      "bad_period",
    );
    await expectRefusal(proposeManualFact(deps, actor, balance({ instantDate: "2025-13-01" })), "bad_period");
  });

  it("refuses missing or unknown currency and unparseable values", async () => {
    await expectRefusal(proposeManualFact(deps, actor, balance({ currency: undefined })), "bad_value", /currency is required/);
    await expectRefusal(proposeManualFact(deps, actor, balance({ currency: "XXX" })), "bad_value", /Unknown currency/);
    await expectRefusal(proposeManualFact(deps, actor, balance({ value: "1.234,56" })), "bad_value");
    await expectRefusal(proposeManualFact(deps, actor, balance({ value: "$83,421.17 $1,204.33" })), "bad_value");
    await expectRefusal(proposeManualFact(deps, actor, balance({ value: "₪5" })), "bad_value", /does not match/);
    await expectRefusal(proposeManualFact(deps, actor, balance({ value: "" })), "bad_value");
  });

  it("refuses a bbox outside the page, a degenerate one, and a bad page", async () => {
    await expectRefusal(proposeManualFact(deps, actor, balance({ bbox: [500, 700, 700, 800] })), "bad_bbox", /outside the page/);
    await expectRefusal(proposeManualFact(deps, actor, balance({ bbox: [-5, 0, 50, 50] })), "bad_bbox");
    await expectRefusal(proposeManualFact(deps, actor, balance({ bbox: [100, 100, 100, 200] })), "bad_bbox", /area/);
    await expectRefusal(proposeManualFact(deps, actor, balance({ bbox: [1, 2, 3] as never })), "bad_bbox");
    await expectRefusal(proposeManualFact(deps, actor, balance({ bbox: [1, 2, 3, NaN] })), "bad_bbox");
    await expectRefusal(proposeManualFact(deps, actor, balance({ pageNo: 2 })), "bad_input", /Page 2/);
    await expectRefusal(proposeManualFact(deps, actor, balance({ pageNo: 0 })), "bad_input");
    await expectRefusal(proposeManualFact(deps, actor, balance({ documentId: 999 })), "not_found");
  });

  it("accepts a corner-swapped bbox and normalizes it", async () => {
    const view = await proposeManualFact(deps, actor, balance({ bbox: [480, 615, 395, 595] }));
    expect(view.sources[0]!.bbox).toEqual(BALANCE_BOX);
  });

  it("refuses unknown or deprecated concepts and names the replacement", async () => {
    v.vault.db.exec(
      "INSERT INTO concepts (id, label_en, period_type, value_type, deprecated_by) VALUES ('old.balance', 'Old', 'instant', 'money', 'balance.ending')",
    );
    await expectRefusal(proposeManualFact(deps, actor, balance({ conceptId: "old.balance" })), "deprecated_concept", /balance\.ending/);
    await expectRefusal(proposeManualFact(deps, actor, balance({ conceptId: "nope" })), "bad_input", /Unknown concept/);
    expect(count("facts")).toBe(0);
  });

  it("refuses unknown account or person and writes nothing on failure", async () => {
    await expectRefusal(proposeManualFact(deps, actor, balance({ accountId: 999 })), "bad_input");
    await expectRefusal(proposeManualFact(deps, actor, balance({ personId: 999 })), "bad_input");
    expect([count("facts"), count("fact_sources"), count("fact_events"), count("extraction_runs")]).toEqual([0, 0, 0, 0]);
  });

  it("requires an actor", async () => {
    await expectRefusal(proposeManualFact(deps, null, balance()), "actor_required");
    await expectRefusal(proposeManualFact(deps, undefined, balance()), "actor_required");
    expect(count("facts")).toBe(0);
  });
});

describe("verifyFact", () => {
  it("moves proposed to verified with who and when, and logs it", async () => {
    const p = await proposeManualFact(deps, actor, balance());
    const r = verifyFact(deps, actor, p.fact.id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.view.fact).toMatchObject({ status: "verified", verifiedBy: actor, verifiedAt: "2026-10-14T12:00:00.000Z" });
    expect(getFactWithHistory(v.vault.db, p.fact.id).events.map((e) => e.event)).toEqual(["proposed", "verified"]);
    expect(listReviewQueue(v.vault.db)).toEqual([]);
  });

  it("refuses anything but proposed, unknown ids, and a missing actor", async () => {
    const p = await proposeManualFact(deps, actor, balance());
    expect(() => verifyFact(deps, null, p.fact.id)).toThrow(FactError);
    verifyFact(deps, actor, p.fact.id);
    await expectRefusal(() => verifyFact(deps, actor, p.fact.id), "bad_state");
    await expectRefusal(() => verifyFact(deps, actor, 12345), "not_found");
  });

  it("returns a structured conflict instead of silently choosing", async () => {
    const a = await proposeManualFact(deps, actor, balance());
    verifyFact(deps, actor, a.fact.id);
    const b = await proposeManualFact(deps, actor, balance({ value: "$83,000.00" }));
    const r = verifyFact(deps, actor, b.fact.id);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.conflict.factId).toBe(b.fact.id);
    expect(r.conflict.conflictingWith.map((c) => c.fact.id)).toEqual([a.fact.id]);
    // Nothing changed.
    expect(getFactWithHistory(v.vault.db, b.fact.id).view.fact.status).toBe("proposed");
    expect(getFactWithHistory(v.vault.db, b.fact.id).events.map((e) => e.event)).toEqual(["proposed"]);
    expect(getFactWithHistory(v.vault.db, a.fact.id).view.fact.status).toBe("verified");
  });

  it("allows corroboration (same value) and only conflicts within the same slot", async () => {
    const a = await proposeManualFact(deps, actor, balance());
    verifyFact(deps, actor, a.fact.id);
    const same = await proposeManualFact(deps, actor, balance());
    const r = verifyFact(deps, actor, same.fact.id);
    expect(r).toMatchObject({ ok: true, corroboratedBy: [a.fact.id] });

    for (const other of [
      balance({ value: "$1.00", instantDate: "2024-12-31" }),
      balance({ value: "$1.00", accountId: undefined }),
      balance({ value: "$1.00", dimensions: { copy: "B" } }),
      balance({ value: "$1.00", personId: actor }),
    ]) {
      const f = await proposeManualFact(deps, actor, other);
      expect(verifyFact(deps, actor, f.fact.id).ok).toBe(true);
    }
    // Same value, different currency counts as a different value in the same slot.
    const ils = await proposeManualFact(deps, actor, balance({ value: "83,421.17", currency: "ILS" }));
    expect(verifyFact(deps, actor, ils.fact.id).ok).toBe(false);
  });

  it("a rejected or superseded fact does not block", async () => {
    const a = await proposeManualFact(deps, actor, balance());
    verifyFact(deps, actor, a.fact.id);
    rejectFact(deps, actor, a.fact.id, "wrong box");
    const b = await proposeManualFact(deps, actor, balance({ value: "$83,000.00" }));
    expect(verifyFact(deps, actor, b.fact.id).ok).toBe(true);
  });
});

describe("correctFact", () => {
  it("creates a new fact, copies sources as new rows, supersedes the old, and logs both", async () => {
    const a = await proposeManualFact(deps, actor, balance({ value: "$83,421.18" }));
    const r = correctFact(deps, actor, a.fact.id, { value: "$83,421.17" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.view.fact).toMatchObject({
      status: "proposed",
      origin: "user_correction",
      supersedesFactId: a.fact.id,
      valueMinor: 8342117n,
      currency: "USD",
      instantDate: "2025-12-31",
      accountId,
      extractionRunId: a.fact.extractionRunId,
    });
    expect(r.superseded.fact.status).toBe("superseded");
    expect(r.view.sources).toHaveLength(1);
    expect(r.view.sources[0]!.id).not.toBe(a.sources[0]!.id);
    expect(r.view.sources[0]).toMatchObject({ bbox: BALANCE_BOX, quotedText: "$83,421.17", documentId, pageNo: 1 });
    expect(r.view.valueMatchesSource).toBe(true);
    expect(count("fact_sources")).toBe(2);

    const oldH = getFactWithHistory(v.vault.db, a.fact.id);
    expect(oldH.events.map((e) => e.event)).toEqual(["proposed", "superseded"]);
    expect(oldH.supersededBy.map((x) => x.fact.id)).toEqual([r.view.fact.id]);
    const newH = getFactWithHistory(v.vault.db, r.view.fact.id);
    expect(newH.events.map((e) => e.event)).toEqual(["corrected"]);
    expect(newH.events[0]!.payload).toMatchObject({ supersedes: a.fact.id, changed: ["value"] });
    expect(newH.supersedes.map((x) => x.fact.id)).toEqual([a.fact.id]);
    expect(listReviewQueue(v.vault.db).map((x) => x.fact.id)).toEqual([r.view.fact.id]);
  });

  it("builds a chain that can be read in both directions", async () => {
    const a = await proposeManualFact(deps, actor, balance({ value: "$1.00" }));
    const b = correctFact(deps, actor, a.fact.id, { value: "$2.00" });
    if (!b.ok) throw new Error("conflict");
    const c = correctFact(deps, actor, b.view.fact.id, { value: "$3.00", verify: true });
    if (!c.ok) throw new Error("conflict");
    expect(c.view.fact.status).toBe("verified");
    const mid = getFactWithHistory(v.vault.db, b.view.fact.id);
    expect(mid.supersedes.map((x) => x.fact.id)).toEqual([a.fact.id]);
    expect(mid.supersededBy.map((x) => x.fact.id)).toEqual([c.view.fact.id]);
    const first = getFactWithHistory(v.vault.db, a.fact.id);
    expect(first.supersededBy.map((x) => x.fact.id)).toEqual([b.view.fact.id, c.view.fact.id]);
    const last = getFactWithHistory(v.vault.db, c.view.fact.id);
    expect(last.supersedes.map((x) => x.fact.id)).toEqual([b.view.fact.id, a.fact.id]);
    expect(last.events.map((e) => e.event)).toEqual(["corrected", "verified"]);
  });

  it("can change period, concept, account and dimensions; and refuses invalid results", async () => {
    const a = await proposeManualFact(deps, actor, balance());
    const r = correctFact(deps, actor, a.fact.id, { instantDate: "2025-11-30", dimensions: { copy: "B" }, accountId: null });
    if (!r.ok) throw new Error("conflict");
    expect(r.view.fact).toMatchObject({ instantDate: "2025-11-30", dimensions: { copy: "B" }, accountId: null });

    const toDuration = correctFact(deps, actor, r.view.fact.id, { conceptId: "income.interest", periodStart: "2025-01-01", periodEnd: "2025-12-31" });
    if (!toDuration.ok) throw new Error("conflict");
    expect(toDuration.view.fact).toMatchObject({ instantDate: null, periodStart: "2025-01-01", periodEnd: "2025-12-31" });

    expect(() => correctFact(deps, actor, toDuration.view.fact.id, { value: "garbage" })).toThrow(FactError);
    await expectRefusal(() => correctFact(deps, actor, toDuration.view.fact.id, { instantDate: "2025-01-01", periodStart: "2025-01-01", periodEnd: "2025-01-02" }), "bad_period");
    await expectRefusal(() => correctFact(deps, actor, toDuration.view.fact.id, {}), "bad_input", /changes nothing/);
    await expectRefusal(() => correctFact(deps, actor, toDuration.view.fact.id, { value: "$83,421.17" }), "bad_input", /changes nothing/);
  });

  it("refuses to correct superseded or rejected facts, and needs an actor", async () => {
    const a = await proposeManualFact(deps, actor, balance());
    await expectRefusal(() => correctFact(deps, null, a.fact.id, { value: "$1.00" }), "actor_required");
    correctFact(deps, actor, a.fact.id, { value: "$1.00" });
    await expectRefusal(() => correctFact(deps, actor, a.fact.id, { value: "$2.00" }), "bad_state");
    const b = await proposeManualFact(deps, actor, balance());
    rejectFact(deps, actor, b.fact.id, "no");
    await expectRefusal(() => correctFact(deps, actor, b.fact.id, { value: "$2.00" }), "bad_state");
  });

  it("verify:true applies the conflict rule and then rolls everything back", async () => {
    const a = await proposeManualFact(deps, actor, balance());
    verifyFact(deps, actor, a.fact.id);
    const b = await proposeManualFact(deps, actor, balance({ value: "$5.00" }));
    const before = [count("facts"), count("fact_sources"), count("fact_events")];
    const r = correctFact(deps, actor, b.fact.id, { value: "$6.00", verify: true });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.conflict.conflictingWith.map((c) => c.fact.id)).toEqual([a.fact.id]);
    expect([count("facts"), count("fact_sources"), count("fact_events")]).toEqual(before);
    expect(getFactWithHistory(v.vault.db, b.fact.id).view.fact.status).toBe("proposed");
    // Same value as the verified one is corroboration.
    const ok = correctFact(deps, actor, b.fact.id, { value: "$83,421.17", verify: true });
    expect(ok).toMatchObject({ ok: true, corroboratedBy: [a.fact.id] });
  });

  it("correcting a verified fact supersedes it, leaving the slot without a verified fact until the new one is verified", async () => {
    const a = await proposeManualFact(deps, actor, balance({ value: "$5.00" }));
    verifyFact(deps, actor, a.fact.id);
    const r = correctFact(deps, actor, a.fact.id, { value: "$6.00" });
    if (!r.ok) throw new Error("conflict");
    expect(listFacts(v.vault.db, { status: "verified" })).toEqual([]);
    expect(verifyFact(deps, actor, r.view.fact.id).ok).toBe(true);
  });
});

describe("rejectFact and reopenFact", () => {
  it("rejects with a mandatory reason and reopens to proposed", async () => {
    const a = await proposeManualFact(deps, actor, balance());
    await expectRefusal(() => rejectFact(deps, actor, a.fact.id, "  "), "bad_input");
    await expectRefusal(() => rejectFact(deps, null, a.fact.id, "x"), "actor_required");
    const r = rejectFact(deps, actor, a.fact.id, "Wrong box");
    expect(r.fact.status).toBe("rejected");
    await expectRefusal(() => rejectFact(deps, actor, a.fact.id, "again"), "bad_state");
    await expectRefusal(() => verifyFact(deps, actor, a.fact.id), "bad_state" as FactErrorCode);
    await expectRefusal(() => reopenFact(deps, null, a.fact.id), "actor_required");
    const back = reopenFact(deps, actor, a.fact.id);
    expect(back.fact).toMatchObject({ status: "proposed", verifiedAt: null, verifiedBy: null });
    await expectRefusal(() => reopenFact(deps, actor, a.fact.id), "bad_state");
    const events = getFactWithHistory(v.vault.db, a.fact.id).events;
    expect(events.map((e) => e.event)).toEqual(["proposed", "rejected", "reopened"]);
    expect(events[1]!.payload).toMatchObject({ reason: "Wrong box", previousStatus: "proposed" });
  });

  it("can retract a verified fact; reopening clears the verification", async () => {
    const a = await proposeManualFact(deps, actor, balance());
    verifyFact(deps, actor, a.fact.id);
    expect(rejectFact(deps, actor, a.fact.id, "found an error").fact.status).toBe("rejected");
    expect(reopenFact(deps, actor, a.fact.id).fact).toMatchObject({ status: "proposed", verifiedAt: null });
  });

  it("cannot reject a superseded fact", async () => {
    const a = await proposeManualFact(deps, actor, balance());
    correctFact(deps, actor, a.fact.id, { value: "$1.00" });
    await expectRefusal(() => rejectFact(deps, actor, a.fact.id, "x"), "bad_state");
  });
});

describe("createAttestation", () => {
  const att = (over = {}) => ({
    conceptId: "status.account_closed",
    accountId,
    value: "true",
    instantDate: "2025-06-30",
    note: "Sarah says the account was closed in June.",
    ...over,
  });

  it("creates a proposed attestation without sources, then it can be verified", () => {
    const view = createAttestation(deps, actor, att());
    expect(view.fact).toMatchObject({ origin: "attestation", status: "proposed", valueText: "true", note: "Sarah says the account was closed in June." });
    expect(view.sources).toEqual([]);
    expect(view.valueMatchesSource).toBeNull();
    expect(getFactWithHistory(v.vault.db, view.fact.id).events.map((e) => e.event)).toEqual(["proposed"]);
    expect(verifyFact(deps, actor, view.fact.id).ok).toBe(true);
  });

  it("stays an attestation when corrected", () => {
    const original = createAttestation(deps, actor, att());
    const r = correctFact(deps, actor, original.fact.id, { instantDate: "2025-07-31" });
    if (!r.ok) throw new Error("unexpected conflict");
    expect(r.view.fact).toMatchObject({ origin: "attestation", supersedesFactId: original.fact.id, instantDate: "2025-07-31" });
    expect(r.view.sources).toEqual([]);
    expect(r.superseded.fact.status).toBe("superseded");
  });

  it("refuses a missing or blank note, an invalid period, and a missing actor", async () => {
    await expectRefusal(() => createAttestation(deps, actor, att({ note: "" })), "note_required");
    await expectRefusal(() => createAttestation(deps, actor, att({ note: "   " })), "note_required");
    await expectRefusal(() => createAttestation(deps, actor, { ...att(), note: undefined } as never), "note_required");
    await expectRefusal(() => createAttestation(deps, actor, att({ instantDate: undefined })), "bad_period");
    await expectRefusal(() => createAttestation(deps, null, att()), "actor_required");
    expect(count("facts")).toBe(0);
  });
});

describe("queries", () => {
  it("review queue lists proposed facts with labels, account, document, page, box and quoted text", async () => {
    const a = await proposeManualFact(deps, actor, balance());
    const b = await proposeManualFact(deps, actor, balance({ bbox: INTEREST_BOX, value: "$1.00", instantDate: "2025-11-30" }));
    verifyFact(deps, actor, a.fact.id);
    const q = listReviewQueue(v.vault.db);
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({
      concept: { id: "balance.ending", labelEn: "Ending balance", labelHe: "יתרה לסוף תקופה", valueType: "money" },
      account: { id: accountId, displayName: "Brokerage ...4821", language: "en" },
      valueMatchesSource: false,
    });
    expect(q[0]!.fact.id).toBe(b.fact.id);
    expect(q[0]!.sources[0]).toMatchObject({ documentId, documentName: "statement.pdf", pageNo: 1, bbox: INTEREST_BOX, quotedText: "$1,204.33" });
  });

  it("filters facts by status, concept, account and document", async () => {
    const a = await proposeManualFact(deps, actor, balance());
    await proposeManualFact(deps, actor, balance({ conceptId: "income.interest", instantDate: undefined, periodStart: "2025-01-01", periodEnd: "2025-12-31", accountId: undefined }));
    verifyFact(deps, actor, a.fact.id);
    const ids = (f: Parameters<typeof listFacts>[1]) => listFacts(v.vault.db, f).map((x) => x.fact.id);
    expect(ids({})).toHaveLength(2);
    expect(ids({ status: "verified" })).toEqual([a.fact.id]);
    expect(ids({ conceptId: "income.interest" })).toHaveLength(1);
    expect(ids({ accountId })).toEqual([a.fact.id]);
    expect(ids({ documentId })).toHaveLength(2);
    expect(ids({ documentId: 99 })).toEqual([]);
  });

  it("getFactWithHistory refuses unknown ids", () => {
    expect(() => getFactWithHistory(v.vault.db, 404)).toThrow(FactError);
  });
});

describe("append-only", () => {
  type Row = Record<string, unknown>;
  const snapshot = (table: string): Map<unknown, Row> =>
    new Map((v.vault.db.prepare(`SELECT * FROM ${table}`).all() as Row[]).map((r) => [r["id"], { ...r }]));

  it("no operation changes any column other than status / verified_at / verified_by", async () => {
    const tables = ["facts", "fact_sources", "fact_events", "extraction_runs"];
    let before = Object.fromEntries(tables.map((t) => [t, snapshot(t)]));
    const checkStep = () => {
      for (const t of tables) {
        const after = snapshot(t);
        for (const [id, old] of before[t]!) {
          const now = after.get(id);
          expect(now, `${t} row ${String(id)} must still exist`).toBeDefined();
          const changed = Object.keys(old).filter((k) => old[k] !== now![k]);
          if (t === "facts") expect(changed.filter((k) => !["status", "verified_at", "verified_by"].includes(k))).toEqual([]);
          else expect(changed).toEqual([]);
        }
        before[t] = after;
      }
    };

    const a = await proposeManualFact(deps, actor, balance());
    checkStep();
    verifyFact(deps, actor, a.fact.id);
    checkStep();
    const c = correctFact(deps, actor, a.fact.id, { value: "$1.00", verify: true });
    checkStep();
    if (!c.ok) throw new Error("conflict");
    rejectFact(deps, actor, c.view.fact.id, "no");
    checkStep();
    reopenFact(deps, actor, c.view.fact.id);
    checkStep();
    createAttestation(deps, actor, { conceptId: "status.account_closed", accountId, value: "true", instantDate: "2025-06-30", note: "n" });
    checkStep();
    const b = await proposeManualFact(deps, actor, balance({ value: "$9.00" }));
    verifyFact(deps, actor, b.fact.id); // conflict, no change
    checkStep();
    expect(count("facts")).toBeGreaterThanOrEqual(4);
    before = {};
  });
});
