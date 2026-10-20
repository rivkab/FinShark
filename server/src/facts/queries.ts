import type { DatabaseSync, SQLOutputValue } from "node:sqlite";
import { parseAmount, type PdfRect } from "@finshark/shared";
import {
  FactError,
  type Fact,
  type FactEvent,
  type FactFilters,
  type FactHistory,
  type FactSource,
  type FactView,
  type Language,
  type PeriodType,
  type ValueType,
} from "./types.ts";

type Row = Record<string, SQLOutputValue>;

/** Prepared statement whose INTEGER columns come back as bigint (money must never pass through Number). */
function query(db: DatabaseSync, sql: string) {
  const st = db.prepare(sql);
  st.setReadBigInts(true);
  return st;
}

const num = (v: SQLOutputValue): number => Number(v);
const numOrNull = (v: SQLOutputValue): number | null => (v === null ? null : Number(v));
const strOrNull = (v: SQLOutputValue): string | null => (v === null ? null : String(v));

function mapFact(r: Row): Fact {
  return {
    id: num(r["id"]!),
    conceptId: String(r["concept_id"]),
    accountId: numOrNull(r["account_id"]!),
    personId: numOrNull(r["person_id"]!),
    valueMinor: r["value_minor"] === null ? null : BigInt(r["value_minor"] as bigint),
    valueDecimal: strOrNull(r["value_decimal"]!),
    valueText: strOrNull(r["value_text"]!),
    currency: strOrNull(r["currency"]!),
    instantDate: strOrNull(r["instant_date"]!),
    periodStart: strOrNull(r["period_start"]!),
    periodEnd: strOrNull(r["period_end"]!),
    taxYear: numOrNull(r["tax_year"]!),
    dimensions: JSON.parse(String(r["dimensions"])) as Record<string, unknown>,
    status: String(r["status"]) as Fact["status"],
    origin: String(r["origin"]) as Fact["origin"],
    extractionRunId: numOrNull(r["extraction_run_id"]!),
    supersedesFactId: numOrNull(r["supersedes_fact_id"]!),
    derivation: r["derivation"] === null ? null : JSON.parse(String(r["derivation"])),
    note: strOrNull(r["note"]!),
    createdAt: String(r["created_at"]),
    createdBy: numOrNull(r["created_by"]!),
    verifiedAt: strOrNull(r["verified_at"]!),
    verifiedBy: numOrNull(r["verified_by"]!),
  };
}

function mapSource(r: Row): FactSource {
  return {
    id: num(r["id"]!),
    factId: num(r["fact_id"]!),
    documentId: num(r["document_id"]!),
    documentName: String(r["original_filename"]),
    pageNo: numOrNull(r["page_no"]!),
    bbox: r["bbox"] === null ? null : (JSON.parse(String(r["bbox"])) as PdfRect),
    quotedText: strOrNull(r["quoted_text"]!),
    locator: r["locator"] === null ? null : JSON.parse(String(r["locator"])),
  };
}

/**
 * Does the value read from the source equal the stored value? Compares the first source that has
 * a text layer. null = nothing to compare (no source, or the page has no text layer).
 * An unreadable or ambiguous box (several numbers, no number) counts as a mismatch.
 */
export function valueMatchesSource(fact: Fact, sources: readonly FactSource[]): boolean | null {
  const quoted = sources.find((s) => s.quotedText !== null)?.quotedText;
  if (quoted === undefined || quoted === null) return null;
  const text = quoted.replace(/[‎‏‪-‮]/g, "").trim();
  if (fact.valueMinor !== null && fact.currency !== null) {
    try {
      return parseAmount(text, fact.currency).minor === fact.valueMinor;
    } catch {
      return false;
    }
  }
  if (fact.valueDecimal !== null) {
    const plain = text.replace(/,/g, "");
    return /^-?\d+(\.\d+)?$/.test(plain) && plain === fact.valueDecimal;
  }
  if (fact.valueText !== null) {
    if (fact.valueText === "true" || fact.valueText === "false") return null;
    return text.replace(/\s+/g, " ") === fact.valueText.replace(/\s+/g, " ");
  }
  return null;
}

const FACT_SELECT = `
  SELECT f.*, c.label_en AS concept_label_en, c.label_he AS concept_label_he,
         c.value_type AS concept_value_type, c.period_type AS concept_period_type,
         a.display_name AS account_name, a.language AS account_language, p.display_name AS person_name
  FROM facts f
  JOIN concepts c ON c.id = f.concept_id
  LEFT JOIN accounts a ON a.id = f.account_id
  LEFT JOIN people p ON p.id = f.person_id`;

function toView(db: DatabaseSync, r: Row): FactView {
  const fact = mapFact(r);
  const sources = query(
    db,
    `SELECT s.*, d.original_filename FROM fact_sources s JOIN documents d ON d.id = s.document_id
     WHERE s.fact_id = ? ORDER BY s.id`,
  )
    .all(fact.id)
    .map((x) => mapSource(x as Row));
  return {
    fact,
    concept: {
      id: fact.conceptId,
      labelEn: String(r["concept_label_en"]),
      labelHe: strOrNull(r["concept_label_he"]!),
      valueType: String(r["concept_value_type"]) as ValueType,
      periodType: String(r["concept_period_type"]) as PeriodType,
    },
    account:
      fact.accountId === null
        ? null
        : { id: fact.accountId, displayName: String(r["account_name"]), language: String(r["account_language"]) as Language },
    person: fact.personId === null ? null : { id: fact.personId, displayName: String(r["person_name"]) },
    sources,
    valueMatchesSource: valueMatchesSource(fact, sources),
  };
}

export function getFactView(db: DatabaseSync, id: number): FactView | undefined {
  const r = query(db, `${FACT_SELECT} WHERE f.id = ?`).get(id);
  return r ? toView(db, r as Row) : undefined;
}

export function requireFactView(db: DatabaseSync, id: number): FactView {
  const v = getFactView(db, id);
  if (!v) throw new FactError("not_found", `No such fact: ${id}`);
  return v;
}

/** Proposed facts, oldest first, with everything the review screen shows. */
export function listReviewQueue(db: DatabaseSync): FactView[] {
  return listFacts(db, { status: "proposed" });
}

export function listFacts(db: DatabaseSync, filters: FactFilters = {}): FactView[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (filters.status !== undefined) {
    where.push("f.status = ?");
    params.push(filters.status);
  }
  if (filters.conceptId !== undefined) {
    where.push("f.concept_id = ?");
    params.push(filters.conceptId);
  }
  if (filters.accountId !== undefined) {
    where.push("f.account_id = ?");
    params.push(filters.accountId);
  }
  if (filters.documentId !== undefined) {
    where.push("EXISTS (SELECT 1 FROM fact_sources s WHERE s.fact_id = f.id AND s.document_id = ?)");
    params.push(filters.documentId);
  }
  const sql = `${FACT_SELECT}${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY f.created_at DESC, f.id DESC`;
  return query(db, sql)
    .all(...params)
    .map((r) => toView(db, r as Row));
}

export function listFactEvents(db: DatabaseSync, factId: number): FactEvent[] {
  return query(
    db,
    `SELECT e.*, p.display_name AS actor_name FROM fact_events e LEFT JOIN people p ON p.id = e.actor
     WHERE e.fact_id = ? ORDER BY e.id`,
  )
    .all(factId)
    .map((x) => {
      const r = x as Row;
      return {
        id: num(r["id"]!),
        factId: num(r["fact_id"]!),
        at: String(r["at"]),
        actor: numOrNull(r["actor"]!),
        actorName: strOrNull(r["actor_name"]!),
        event: String(r["event"]) as FactEvent["event"],
        payload: JSON.parse(String(r["payload"])) as Record<string, unknown>,
      };
    });
}

/** The fact, its audit log, and the supersession chain in both directions. */
export function getFactWithHistory(db: DatabaseSync, id: number): FactHistory {
  const view = requireFactView(db, id);
  const seen = new Set<number>([id]);

  const supersedes: FactView[] = [];
  for (let cur = view.fact.supersedesFactId; cur !== null && !seen.has(cur); ) {
    seen.add(cur);
    const v = requireFactView(db, cur);
    supersedes.push(v);
    cur = v.fact.supersedesFactId;
  }

  const supersededBy: FactView[] = [];
  let frontier = [id];
  while (frontier.length > 0) {
    const next: number[] = [];
    for (const f of frontier) {
      const rows = query(db, "SELECT id FROM facts WHERE supersedes_fact_id = ? ORDER BY id").all(f) as Row[];
      for (const r of rows) {
        const nid = num(r["id"]!);
        if (seen.has(nid)) continue;
        seen.add(nid);
        supersededBy.push(requireFactView(db, nid));
        next.push(nid);
      }
    }
    frontier = next;
  }

  return { view, events: listFactEvents(db, id), supersedes, supersededBy };
}

/** Verified facts occupying the same slot (concept, account, person, date/period, dimensions) as `fact`. */
export function findVerifiedInSlot(db: DatabaseSync, fact: Fact): FactView[] {
  const dims = JSON.stringify(sortKeys(fact.dimensions));
  const rows = query(
    db,
    `${FACT_SELECT} WHERE f.status = 'verified' AND f.id <> ? AND f.concept_id = ?
       AND f.account_id IS ? AND f.person_id IS ? AND f.instant_date IS ?
       AND f.period_start IS ? AND f.period_end IS ? ORDER BY f.id`,
  ).all(fact.id, fact.conceptId, fact.accountId, fact.personId, fact.instantDate, fact.periodStart, fact.periodEnd);
  return rows
    .map((r) => toView(db, r as Row))
    .filter((v) => JSON.stringify(sortKeys(v.fact.dimensions)) === dims);
}

function sortKeys(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}
