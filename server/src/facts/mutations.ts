import type { DatabaseSync } from "node:sqlite";
import { textInBox, toDecimalString, type PdfRect } from "@finshark/shared";
import { resolveInVault } from "../vault/layout.ts";
import { extractWithPdfjs, getTextLayer } from "../documents/text-layer.ts";
import {
  FactError,
  type AttestationInput,
  type CorrectResult,
  type Fact,
  type FactChanges,
  type FactConflict,
  type FactDeps,
  type FactFields,
  type FactOrigin,
  type FactView,
  type ManualFactInput,
  type ProposeDeps,
  type VerifyResult,
} from "./types.ts";
import { canonicalJson, checkBbox, getConcept, prepareFact, sameValue, type PreparedFact } from "./validate.ts";
import { findVerifiedInSlot, requireFactView } from "./queries.ts";

// Facts are append-only except status / verified_at / verified_by (CLAUDE.md, migration 001).
// The only UPDATE statements on `facts` in this codebase are in setStatus() below.

function requireActor(actorId: number | null | undefined): number {
  if (typeof actorId !== "number" || !Number.isInteger(actorId)) {
    throw new FactError("actor_required", "Choose who is using FinShark before changing facts.");
  }
  return actorId;
}

/** Thrown inside a transaction to roll it back and report a verification conflict. */
class ConflictSignal extends Error {
  readonly conflict: FactConflict;
  constructor(conflict: FactConflict) {
    super("verification conflict");
    this.conflict = conflict;
  }
}

function inTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (e) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw e;
  }
}

function addEvent(
  db: DatabaseSync,
  factId: number,
  at: string,
  actor: number,
  event: "proposed" | "verified" | "corrected" | "rejected" | "superseded" | "reopened",
  payload: Record<string, unknown> = {},
): void {
  db.prepare("INSERT INTO fact_events (fact_id, at, actor, event, payload) VALUES (?, ?, ?, ?, ?)").run(
    factId,
    at,
    actor,
    event,
    JSON.stringify(payload),
  );
}

function insertFact(
  db: DatabaseSync,
  p: PreparedFact,
  m: { origin: FactOrigin; at: string; actor: number; extractionRunId: number | null; supersedesFactId: number | null },
): number {
  const r = db
    .prepare(
      `INSERT INTO facts (concept_id, account_id, person_id, value_minor, value_decimal, value_text, currency,
         instant_date, period_start, period_end, tax_year, dimensions, status, origin, extraction_run_id,
         supersedes_fact_id, note, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'proposed', ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      p.concept.id,
      p.accountId,
      p.personId,
      p.valueMinor,
      p.valueDecimal,
      p.valueText,
      p.currency,
      p.instantDate,
      p.periodStart,
      p.periodEnd,
      p.taxYear,
      p.dimensionsJson,
      m.origin,
      m.extractionRunId,
      m.supersedesFactId,
      p.note,
      m.at,
      m.actor,
    );
  return Number(r.lastInsertRowid);
}

/** The only place a fact row is ever updated. */
function setStatus(
  db: DatabaseSync,
  id: number,
  status: "proposed" | "verified" | "rejected" | "superseded",
  verified?: { at: string; by: number } | "clear",
): void {
  if (verified === undefined) {
    db.prepare("UPDATE facts SET status = ? WHERE id = ?").run(status, id);
  } else if (verified === "clear") {
    db.prepare("UPDATE facts SET status = ?, verified_at = NULL, verified_by = NULL WHERE id = ?").run(status, id);
  } else {
    db.prepare("UPDATE facts SET status = ?, verified_at = ?, verified_by = ? WHERE id = ?").run(
      status,
      verified.at,
      verified.by,
      id,
    );
  }
}

// ---------------------------------------------------------------- propose

export async function proposeManualFact(deps: ProposeDeps, actorId: number | null | undefined, input: ManualFactInput): Promise<FactView> {
  const actor = requireActor(actorId);
  const { db } = deps;

  const doc = db
    .prepare("SELECT id, sha256, stored_path, page_count, status FROM documents WHERE id = ?")
    .get(input.documentId) as
    | { id: number; sha256: string; stored_path: string; page_count: number | null; status: string }
    | undefined;
  if (!doc || doc.status === "removed") throw new FactError("not_found", `No such document: ${input.documentId}`);
  if (!Number.isInteger(input.pageNo) || input.pageNo < 1 || (doc.page_count !== null && input.pageNo > doc.page_count)) {
    throw new FactError("bad_input", `Page ${input.pageNo} is not in this document (${doc.page_count ?? "?"} pages).`);
  }
  const page = db
    .prepare("SELECT width_pt, height_pt, text_source FROM document_pages WHERE document_id = ? AND page_no = ?")
    .get(doc.id, input.pageNo) as { width_pt: number; height_pt: number; text_source: string } | undefined;
  if (!page) throw new FactError("bad_input", `Page ${input.pageNo} is not in this document.`);

  const prepared = prepareFact(db, input);
  const bbox = checkBbox(input.bbox, { widthPt: page.width_pt, heightPt: page.height_pt });

  // quoted_text is always computed here from the cached text layer; client text is never trusted.
  let quotedText: string | null = null;
  let inputTextSha: string | null = null;
  if (page.text_source !== "none") {
    const layer = await getTextLayer(deps.layout, doc.sha256, resolveInVault(deps.layout, doc.stored_path), deps.extractText ?? extractWithPdfjs);
    const lp = layer.pages.find((p) => p.pageNo === input.pageNo);
    if (lp && lp.textSource !== "none") {
      quotedText = textInBox(
        lp.items.map((i) => ({ str: i.str, rect: [i.x0, i.y0, i.x1, i.y1] as PdfRect })),
        bbox,
      );
      inputTextSha = lp.textSha256;
    }
  }

  const now = deps.now().toISOString();
  const id = inTransaction(db, () => {
    const run = db
      .prepare(
        `INSERT INTO extraction_runs (document_id, extractor_id, extractor_version, input_text_sha256, started_at, finished_at, status)
         VALUES (?, 'manual', '1', ?, ?, ?, 'succeeded')`,
      )
      .run(doc.id, inputTextSha, now, now);
    const factId = insertFact(db, prepared, {
      origin: "manual",
      at: now,
      actor,
      extractionRunId: Number(run.lastInsertRowid),
      supersedesFactId: null,
    });
    db.prepare("INSERT INTO fact_sources (fact_id, document_id, page_no, bbox, quoted_text) VALUES (?, ?, ?, ?, ?)").run(
      factId,
      doc.id,
      input.pageNo,
      JSON.stringify(bbox),
      quotedText,
    );
    addEvent(db, factId, now, actor, "proposed", { origin: "manual", documentId: doc.id, pageNo: input.pageNo });
    if (prepared.accountId !== null) {
      db.prepare("INSERT OR IGNORE INTO document_accounts (document_id, account_id) VALUES (?, ?)").run(doc.id, prepared.accountId);
    }
    return factId;
  });
  return requireFactView(db, id);
}

export function createAttestation(deps: FactDeps, actorId: number | null | undefined, input: AttestationInput): FactView {
  const actor = requireActor(actorId);
  const note = typeof input.note === "string" ? input.note.trim() : "";
  if (note === "") throw new FactError("note_required", "An attestation needs a note saying who says so and why.");
  const prepared = prepareFact(deps.db, { ...input, note });
  const now = deps.now().toISOString();
  const id = inTransaction(deps.db, () => {
    const factId = insertFact(deps.db, prepared, { origin: "attestation", at: now, actor, extractionRunId: null, supersedesFactId: null });
    addEvent(deps.db, factId, now, actor, "proposed", { origin: "attestation" });
    return factId;
  });
  return requireFactView(deps.db, id);
}

// ---------------------------------------------------------------- verify

/** Must run inside a transaction. Throws ConflictSignal when a verified fact disagrees. */
function verifyInTransaction(db: DatabaseSync, factId: number, at: string, actor: number): number[] {
  const view = requireFactView(db, factId);
  if (view.fact.status !== "proposed") {
    throw new FactError("bad_state", `Only a proposed fact can be verified (fact ${factId} is ${view.fact.status}).`);
  }
  const inSlot = findVerifiedInSlot(db, view.fact);
  const conflicting = inSlot.filter((v) => !sameValue(v.fact, view.fact));
  if (conflicting.length > 0) throw new ConflictSignal({ factId, conflictingWith: conflicting });
  const corroboratedBy = inSlot.map((v) => v.fact.id);
  setStatus(db, factId, "verified", { at, by: actor });
  addEvent(db, factId, at, actor, "verified", { corroboratedBy });
  return corroboratedBy;
}

/**
 * proposed -> verified. If another verified fact occupies the same slot (concept, account, person,
 * date/period, dimensions) with a different value, nothing changes and the conflict is returned
 * (DESIGN §4.5: no silent choice). The same value is corroboration and allowed.
 */
export function verifyFact(deps: FactDeps, actorId: number | null | undefined, factId: number): VerifyResult {
  const actor = requireActor(actorId);
  const at = deps.now().toISOString();
  try {
    const corroboratedBy = inTransaction(deps.db, () => verifyInTransaction(deps.db, factId, at, actor));
    return { ok: true, view: requireFactView(deps.db, factId), corroboratedBy };
  } catch (e) {
    if (e instanceof ConflictSignal) return { ok: false, conflict: e.conflict };
    throw e;
  }
}

// ---------------------------------------------------------------- correct

function serializeValue(f: Fact): string {
  if (f.valueMinor !== null && f.currency !== null) return toDecimalString({ minor: f.valueMinor, currency: f.currency });
  return f.valueDecimal ?? f.valueText ?? "";
}

function changedFields(old: Fact, p: PreparedFact): string[] {
  const out: string[] = [];
  if (old.conceptId !== p.concept.id) out.push("conceptId");
  if (old.accountId !== p.accountId) out.push("accountId");
  if (old.personId !== p.personId) out.push("personId");
  if (!sameValue(old, p)) out.push("value");
  if (old.instantDate !== p.instantDate) out.push("instantDate");
  if (old.periodStart !== p.periodStart) out.push("periodStart");
  if (old.periodEnd !== p.periodEnd) out.push("periodEnd");
  if (old.taxYear !== p.taxYear) out.push("taxYear");
  if (canonicalJson(old.dimensions) !== p.dimensionsJson) out.push("dimensions");
  if (old.note !== p.note) out.push("note");
  return out;
}

/**
 * Creates a NEW fact (origin user_correction, supersedes_fact_id = old) with the old fact's sources
 * copied as new rows, and marks the old one superseded. The new fact starts proposed unless
 * `changes.verify` is true (then the verifyFact conflict rule applies and a conflict rolls
 * everything back, leaving the old fact untouched).
 */
export function correctFact(deps: FactDeps, actorId: number | null | undefined, factId: number, changes: FactChanges): CorrectResult {
  const actor = requireActor(actorId);
  const { db } = deps;
  const old = requireFactView(db, factId).fact;
  if (old.status !== "proposed" && old.status !== "verified") {
    throw new FactError("bad_state", `Only a proposed or verified fact can be corrected (fact ${factId} is ${old.status}).`);
  }

  // Merge the changes onto the old fact, then validate the result like any new fact.
  const conceptId = changes.conceptId ?? old.conceptId;
  const newConcept = getConcept(db, conceptId);
  const keepCurrency = newConcept?.valueType === "money";
  const periodChanged = changes.periodStart !== undefined || changes.periodEnd !== undefined;
  const instantChanged = changes.instantDate !== undefined;
  const merged: FactFields = {
    conceptId,
    accountId: changes.accountId !== undefined ? changes.accountId : old.accountId,
    personId: changes.personId !== undefined ? changes.personId : old.personId,
    value: changes.value ?? serializeValue(old),
    currency: changes.currency !== undefined ? changes.currency : keepCurrency ? old.currency : null,
    instantDate: instantChanged ? changes.instantDate : periodChanged ? null : old.instantDate,
    periodStart: periodChanged ? changes.periodStart : instantChanged ? null : old.periodStart,
    periodEnd: periodChanged ? changes.periodEnd : instantChanged ? null : old.periodEnd,
    taxYear: changes.taxYear !== undefined ? changes.taxYear : old.taxYear,
    dimensions: changes.dimensions !== undefined ? changes.dimensions : old.dimensions,
    note: changes.note !== undefined ? changes.note : old.note,
  };
  const prepared = prepareFact(db, merged);
  const changed = changedFields(old, prepared);
  if (changed.length === 0) throw new FactError("bad_input", "The correction changes nothing.");

  const at = deps.now().toISOString();
  try {
    const { newId, corroboratedBy } = inTransaction(db, () => {
      const newId = insertFact(db, prepared, {
        // A corrected attestation is still an attestation (no document behind it);
        // supersedes_fact_id is what marks it as a correction.
        origin: old.origin === "attestation" ? "attestation" : "user_correction",
        at,
        actor,
        extractionRunId: old.extractionRunId,
        supersedesFactId: old.id,
      });
      db.prepare(
        `INSERT INTO fact_sources (fact_id, document_id, page_no, bbox, quoted_text, locator)
         SELECT ?, document_id, page_no, bbox, quoted_text, locator FROM fact_sources WHERE fact_id = ? ORDER BY id`,
      ).run(newId, old.id);
      setStatus(db, old.id, "superseded");
      addEvent(db, old.id, at, actor, "superseded", { supersededBy: newId, previousStatus: old.status });
      addEvent(db, newId, at, actor, "corrected", { supersedes: old.id, changed });
      const corroboratedBy = changes.verify === true ? verifyInTransaction(db, newId, at, actor) : [];
      return { newId, corroboratedBy };
    });
    return { ok: true, view: requireFactView(db, newId), superseded: requireFactView(db, old.id), corroboratedBy };
  } catch (e) {
    if (e instanceof ConflictSignal) return { ok: false, conflict: e.conflict };
    throw e;
  }
}

// ---------------------------------------------------------------- reject / reopen

/** proposed or verified -> rejected. A reason is mandatory; it is kept in the audit log. */
export function rejectFact(deps: FactDeps, actorId: number | null | undefined, factId: number, reason: string): FactView {
  const actor = requireActor(actorId);
  const why = typeof reason === "string" ? reason.trim() : "";
  if (why === "") throw new FactError("bad_input", "A reason is required to reject a fact.");
  const at = deps.now().toISOString();
  inTransaction(deps.db, () => {
    const f = requireFactView(deps.db, factId).fact;
    if (f.status !== "proposed" && f.status !== "verified") {
      throw new FactError("bad_state", `Only a proposed or verified fact can be rejected (fact ${factId} is ${f.status}).`);
    }
    setStatus(deps.db, factId, "rejected");
    addEvent(deps.db, factId, at, actor, "rejected", { reason: why, previousStatus: f.status });
  });
  return requireFactView(deps.db, factId);
}

/** rejected -> proposed (verification fields are cleared; the audit log keeps the history). */
export function reopenFact(deps: FactDeps, actorId: number | null | undefined, factId: number): FactView {
  const actor = requireActor(actorId);
  const at = deps.now().toISOString();
  inTransaction(deps.db, () => {
    const f = requireFactView(deps.db, factId).fact;
    if (f.status !== "rejected") {
      throw new FactError("bad_state", `Only a rejected fact can be reopened (fact ${factId} is ${f.status}).`);
    }
    setStatus(deps.db, factId, "proposed", "clear");
    addEvent(deps.db, factId, at, actor, "reopened", {});
  });
  return requireFactView(deps.db, factId);
}
