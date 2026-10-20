import type { DatabaseSync } from "node:sqlite";
import { resolveInVault, type VaultLayout } from "../vault/layout.ts";
import { extractWithPdfjs, getTextLayer, type ExtractFn, type PageTextLayer, type TextItem, type TextLayer } from "./text-layer.ts";

/** Where a period was read from, kept in documents.metadata so it can be checked against the PDF. */
export interface PeriodSource {
  rule: "statement_period" | "hebrew_period" | "hebrew_annual_report";
  pageNo: number;
  /** Box around the text the dates were read from: x0, y0, x1, y1 in PDF points. */
  bbox: { x0: number; y0: number; x1: number; y1: number };
  quotedText: string;
}

export interface ExtractedPeriod {
  periodStart: string;
  periodEnd: string;
  /** The calendar year both dates fall in; null when the period spans two years. */
  taxYear: number | null;
  source: PeriodSource;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function monthNo(name: string): number | null {
  const i = MONTHS.indexOf(name.slice(0, 3).toLowerCase());
  return i < 0 ? null : i + 1;
}

function iso(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (y < 1990 || y > 2100 || dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const DASH = String.raw`\s*[-–—]\s*`;

/** "September 1-30, 2026", "Sep 1 - Sep 30, 2026", "Dec 15, 2025 - Jan 14, 2026", "09/01/2026 - 09/30/2026" (US order). */
export function parseEnglishRange(text: string): [string, string] | null {
  const t = text.trim().replace(/\s+/g, " ");
  let m = new RegExp(String.raw`^([A-Za-z]{3,9})\.? (\d{1,2})${DASH}(\d{1,2}),? (\d{4})$`).exec(t);
  if (m) {
    const mo = monthNo(m[1]!);
    const s = mo && iso(+m[4]!, mo, +m[2]!);
    const e = mo && iso(+m[4]!, mo, +m[3]!);
    return s && e && s <= e ? [s, e] : null;
  }
  m = new RegExp(String.raw`^([A-Za-z]{3,9})\.? (\d{1,2})(?:,? (\d{4}))?${DASH}([A-Za-z]{3,9})\.? (\d{1,2}),? (\d{4})$`).exec(t);
  if (m) {
    const m1 = monthNo(m[1]!);
    const m2 = monthNo(m[4]!);
    if (!m1 || !m2) return null;
    const endYear = +m[6]!;
    const startYear = m[3] ? +m[3] : m1 > m2 ? endYear - 1 : endYear;
    const s = iso(startYear, m1, +m[2]!);
    const e = iso(endYear, m2, +m[5]!);
    return s && e && s <= e ? [s, e] : null;
  }
  m = new RegExp(String.raw`^(\d{1,2})/(\d{1,2})/(\d{4})${DASH}(\d{1,2})/(\d{1,2})/(\d{4})$`).exec(t);
  if (m) {
    const s = iso(+m[3]!, +m[1]!, +m[2]!);
    const e = iso(+m[6]!, +m[4]!, +m[5]!);
    return s && e && s <= e ? [s, e] : null;
  }
  return null;
}

/** dd/mm/yyyy or dd.mm.yyyy as ISO, null when it is not a real date. */
export function parseDayFirstDate(text: string): string | null {
  const m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(text.trim());
  return m ? iso(+m[3]!, +m[2]!, +m[1]!) : null;
}

const cy = (i: TextItem) => (i.y0 + i.y1) / 2;
const cx = (i: TextItem) => (i.x0 + i.x1) / 2;

function box(items: TextItem[]) {
  return {
    x0: Math.min(...items.map((i) => i.x0)),
    y0: Math.min(...items.map((i) => i.y0)),
    x1: Math.max(...items.map((i) => i.x1)),
    y1: Math.max(...items.map((i) => i.y1)),
  };
}

function yearOf(a: string, b: string): number | null {
  return a.slice(0, 4) === b.slice(0, 4) ? Number(a.slice(0, 4)) : null;
}

/** "Statement Period" (any case) with the dates in the item right of it or just below it. */
function englishStatementPeriod(page: PageTextLayer): ExtractedPeriod | null {
  for (const label of page.items) {
    if (!/^statement period:?$/i.test(label.str.trim())) continue;
    const candidates = page.items
      .filter((b) => b !== label && b.str.trim() !== "")
      .map((b) => {
        const right = Math.abs(cy(b) - cy(label)) < 3 && b.x0 >= label.x1 - 1;
        const below = cy(b) < cy(label) && cy(label) - cy(b) < 25 && b.x0 < label.x1 && b.x1 > label.x0;
        return { b, d: right ? b.x0 - label.x1 : below ? cy(label) - cy(b) : null };
      })
      .filter((c): c is { b: TextItem; d: number } => c.d !== null)
      .sort((p, q) => p.d - q.d);
    for (const { b } of candidates) {
      const range = parseEnglishRange(b.str);
      if (range) {
        const [periodStart, periodEnd] = range;
        return {
          periodStart,
          periodEnd,
          taxYear: yearOf(periodStart, periodEnd),
          source: { rule: "statement_period", pageNo: page.pageNo, bbox: box([label, b]), quotedText: b.str.trim() },
        };
      }
    }
  }
  return null;
}

/** Hebrew "תקופה" with "dd/mm/yyyy - dd/mm/yyyy" on the line below it. RTL order is ignored: earlier is the start. */
function hebrewPeriod(page: PageTextLayer): ExtractedPeriod | null {
  for (const label of page.items) {
    if (label.str.trim() !== "תקופה") continue;
    const below = page.items.filter((b) => cy(b) < cy(label) && cy(label) - cy(b) < 30 && b.str.trim() !== "");
    if (below.length === 0) continue;
    const lineY = Math.max(...below.map(cy));
    const line = below.filter((b) => Math.abs(cy(b) - lineY) < 3);
    const dates = line.filter((b) => parseDayFirstDate(b.str) !== null);
    const others = line.filter((b) => parseDayFirstDate(b.str) === null);
    if (dates.length !== 2 || others.length !== 1 || !/^[-–—]$/.test(others[0]!.str.trim())) continue;
    const [periodStart, periodEnd] = dates.map((d) => parseDayFirstDate(d.str)!).sort() as [string, string];
    return {
      periodStart,
      periodEnd,
      taxYear: yearOf(periodStart, periodEnd),
      source: { rule: "hebrew_period", pageNo: page.pageNo, bbox: box([label, ...line]), quotedText: dates.map((d) => d.str.trim()).join(" - ") },
    };
  }
  return null;
}

/**
 * Annual report: "לשנת YYYY" on one line, confirmed by a report date of 31/12/YYYY on the same
 * page. Then the period is that calendar year. Without the confirmation nothing is returned.
 */
function hebrewAnnualReport(page: PageTextLayer): ExtractedPeriod | null {
  for (const label of page.items) {
    if (label.str.trim() !== "לשנת") continue;
    const lineYears = page.items.filter(
      (b) => b !== label && /^\d{4}$/.test(b.str.trim()) && Math.abs(cy(b) - cy(label)) < 6 && Math.abs(cx(b) - cx(label)) < 150,
    );
    if (lineYears.length === 0) continue;
    const year = lineYears.sort((p, q) => Math.abs(cx(p) - cx(label)) - Math.abs(cx(q) - cx(label)))[0]!;
    const y = Number(year.str.trim());
    const periodStart = iso(y, 1, 1);
    const periodEnd = iso(y, 12, 31);
    if (!periodStart || !periodEnd) continue;
    const confirm = page.items.find((b) => parseDayFirstDate(b.str) === periodEnd);
    if (!confirm) continue;
    return {
      periodStart,
      periodEnd,
      taxYear: y,
      source: { rule: "hebrew_annual_report", pageNo: page.pageNo, bbox: box([label, year]), quotedText: `לשנת ${y}` },
    };
  }
  return null;
}

/**
 * The statement period of a document, read from its text layer by fixed rules on the first page that
 * matches one. Null when no rule matches: nothing is guessed from stray dates.
 */
export function extractPeriod(layer: Pick<TextLayer, "pages">): ExtractedPeriod | null {
  for (const page of layer.pages) {
    const found = englishStatementPeriod(page) ?? hebrewPeriod(page) ?? hebrewAnnualReport(page);
    if (found) return found;
  }
  return null;
}

/** What to write for the fields a document has no value for; null when there is nothing to add. */
export function periodFill(
  doc: { period_start: string | null; period_end: string | null; tax_year: number | null },
  p: ExtractedPeriod,
): { period_start?: string; period_end?: string; tax_year?: number } | null {
  const fill: { period_start?: string; period_end?: string; tax_year?: number } = {};
  if (doc.period_start === null && doc.period_end === null) {
    fill.period_start = p.periodStart;
    fill.period_end = p.periodEnd;
  }
  if (doc.tax_year === null && p.taxYear !== null) fill.tax_year = p.taxYear;
  return Object.keys(fill).length > 0 ? fill : null;
}

/**
 * Fills the period and tax year of documents that have none, from their text. A value that is
 * set is never changed; the source is recorded in metadata.periodSource. Returns how many
 * documents were changed.
 */
export async function fillMissingPeriods(deps: { db: DatabaseSync; layout: VaultLayout; extractText?: ExtractFn }): Promise<number> {
  const rows = deps.db
    .prepare(
      `SELECT id, sha256, stored_path, period_start, period_end, tax_year, metadata FROM documents
       WHERE (period_start IS NULL AND period_end IS NULL OR tax_year IS NULL) AND status <> 'removed' ORDER BY id`,
    )
    .all() as { id: number; sha256: string; stored_path: string; period_start: string | null; period_end: string | null; tax_year: number | null; metadata: string }[];
  let changed = 0;
  for (const r of rows) {
    const layer = await getTextLayer(deps.layout, r.sha256, resolveInVault(deps.layout, r.stored_path), deps.extractText ?? extractWithPdfjs);
    const found = extractPeriod(layer);
    const fill = found && periodFill(r, found);
    if (!found || !fill) continue;
    const metadata = { ...(JSON.parse(r.metadata) as object), periodSource: found.source };
    deps.db
      .prepare(
        `UPDATE documents SET period_start = COALESCE(?, period_start), period_end = COALESCE(?, period_end),
           tax_year = COALESCE(?, tax_year), metadata = ? WHERE id = ?`,
      )
      .run(fill.period_start ?? null, fill.period_end ?? null, fill.tax_year ?? null, JSON.stringify(metadata), r.id);
    changed++;
  }
  return changed;
}
