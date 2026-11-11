import type { DatabaseSync } from "node:sqlite";
import type { FilingStatus, Us8938TermId } from "@finshark/shared";

// Per-year tax settings and the Form 8938 classification of accounts (DESIGN D21).

export interface TaxYearRow {
  year: number;
  filingStatus: FilingStatus | null;
  abroad8938: boolean | null;
  updatedAt: string;
}

export function getTaxYear(db: DatabaseSync, year: number): TaxYearRow | null {
  const r = db.prepare("SELECT year, filing_status, abroad_8938, updated_at FROM tax_years WHERE year = ?").get(year) as
    | { year: number; filing_status: string | null; abroad_8938: number | null; updated_at: string }
    | undefined;
  if (!r) return null;
  return {
    year: r.year,
    filingStatus: r.filing_status as FilingStatus | null,
    abroad8938: r.abroad_8938 === null ? null : r.abroad_8938 === 1,
    updatedAt: r.updated_at,
  };
}

/** Insert or replace the settings of a year. `now` is the timestamp to record. */
export function setTaxYear(db: DatabaseSync, now: Date, year: number, v: { filingStatus: FilingStatus | null; abroad8938: boolean | null }): TaxYearRow {
  db.prepare(
    `INSERT INTO tax_years (year, filing_status, abroad_8938, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(year) DO UPDATE SET filing_status = excluded.filing_status, abroad_8938 = excluded.abroad_8938, updated_at = excluded.updated_at`,
  ).run(year, v.filingStatus, v.abroad8938 === null ? null : v.abroad8938 ? 1 : 0, now.toISOString());
  return getTaxYear(db, year)!;
}

export interface Us8938Term {
  termId: Us8938TermId;
  reason: string | null;
  validFrom: string | null;
  validTo: string | null;
}

interface TermRow {
  account_id: number;
  term_id: string;
  reason: string | null;
  valid_from: string | null;
  valid_to: string | null;
}

const dto = (r: TermRow): Us8938Term => ({ termId: r.term_id as Us8938TermId, reason: r.reason, validFrom: r.valid_from, validTo: r.valid_to });

// us_8938 rows in effect on a date (inclusive bounds, NULL = unbounded). Normally at most
// one per account; if data ever overlaps, the latest start (then latest id) wins.
const IN_EFFECT = `
  SELECT at.account_id, at.term_id, at.reason, at.valid_from, at.valid_to
  FROM account_terms at JOIN terms t ON t.id = at.term_id
  WHERE t.taxonomy_id = 'us_8938'
    AND (at.valid_from IS NULL OR at.valid_from <= ?)
    AND (at.valid_to IS NULL OR at.valid_to >= ?)`;
const ORDER = "ORDER BY COALESCE(at.valid_from, '') DESC, at.id DESC";

/** The Form 8938 classification in effect for tax year `year`: the row containing Y-12-31. */
export function us8938TermFor(db: DatabaseSync, accountId: number, year: number): Us8938Term | null {
  const d = `${year}-12-31`;
  const r = db.prepare(`${IN_EFFECT} AND at.account_id = ? ${ORDER} LIMIT 1`).get(d, d, accountId) as TermRow | undefined;
  return r ? dto(r) : null;
}

/** Classifications in effect for tax year `year`, for every account that has one. */
export function us8938TermsForYear(db: DatabaseSync, year: number): Map<number, Us8938Term> {
  const d = `${year}-12-31`;
  const rows = db.prepare(`${IN_EFFECT} ${ORDER}`).all(d, d) as unknown as TermRow[];
  const out = new Map<number, Us8938Term>();
  for (const r of rows) if (!out.has(r.account_id)) out.set(r.account_id, dto(r)); // first = winner
  return out;
}

/**
 * Set (or, with termId null, clear) an account's Form 8938 classification "for tax year
 * `year` onward", in one transaction. For the account's us_8938 rows:
 *   - a row that starts before Y-01-01 and contains it is cut off: valid_to = (Y-1)-12-31;
 *   - a row starting on or after Y-01-01 is deleted (superseded);
 *   - rows ending before Y-01-01 are left alone (earlier years keep their classification).
 * Then, unless clearing, one new row is inserted: valid_from = Y-01-01, valid_to = NULL.
 * The caller validates termId and reason.
 */
export function setUs8938Term(db: DatabaseSync, accountId: number, year: number, termId: Us8938TermId | null, reason: string | null): void {
  const start = `${year}-01-01`;
  const prevEnd = `${year - 1}-12-31`;
  db.exec("BEGIN");
  try {
    db.prepare(
      `UPDATE account_terms SET valid_to = ?
       WHERE account_id = ? AND term_id IN (SELECT id FROM terms WHERE taxonomy_id = 'us_8938')
         AND (valid_from IS NULL OR valid_from < ?) AND (valid_to IS NULL OR valid_to >= ?)`,
    ).run(prevEnd, accountId, start, start);
    db.prepare(
      `DELETE FROM account_terms
       WHERE account_id = ? AND term_id IN (SELECT id FROM terms WHERE taxonomy_id = 'us_8938') AND valid_from >= ?`,
    ).run(accountId, start);
    if (termId !== null) {
      db.prepare("INSERT INTO account_terms (account_id, term_id, valid_from, valid_to, reason) VALUES (?, ?, ?, NULL, ?)").run(accountId, termId, start, reason);
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
