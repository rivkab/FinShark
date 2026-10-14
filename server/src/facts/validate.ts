import type { DatabaseSync } from "node:sqlite";
import { isKnownCurrency, MoneyParseError, parseAmount, type PdfRect } from "@finshark/shared";
import { FactError, type Fact, type FactFields, type PeriodType, type ValueType } from "./types.ts";

export interface ConceptRow {
  id: string;
  labelEn: string;
  labelHe: string | null;
  periodType: PeriodType;
  valueType: ValueType;
  /** What facts of this concept are about; the matching reference is then mandatory. */
  subject: "account" | "person";
  deprecatedBy: string | null;
}

export function getConcept(db: DatabaseSync, id: string): ConceptRow | undefined {
  const r = db
    .prepare("SELECT id, label_en, label_he, period_type, value_type, subject, deprecated_by FROM concepts WHERE id = ?")
    .get(id) as
    | {
        id: string;
        label_en: string;
        label_he: string | null;
        period_type: PeriodType;
        value_type: ValueType;
        subject: "account" | "person";
        deprecated_by: string | null;
      }
    | undefined;
  return r && {
    id: r.id,
    labelEn: r.label_en,
    labelHe: r.label_he,
    periodType: r.period_type,
    valueType: r.value_type,
    subject: r.subject,
    deprecatedBy: r.deprecated_by,
  };
}

/** Everything that goes into a `facts` row, validated and parsed. */
export interface PreparedFact {
  concept: ConceptRow;
  accountId: number | null;
  personId: number | null;
  valueMinor: bigint | null;
  valueDecimal: string | null;
  valueText: string | null;
  currency: string | null;
  instantDate: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  taxYear: number | null;
  dimensions: Record<string, unknown>;
  dimensionsJson: string;
  note: string | null;
}

export function isIsoDate(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** JSON with sorted keys, so equal dimension sets compare equal as strings. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v !== null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

function blankToNull(s: string | null | undefined): string | null {
  if (s === undefined || s === null) return null;
  const t = s.trim();
  return t === "" ? null : t;
}

function checkDimensions(d: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (d === undefined || d === null) return {};
  if (typeof d !== "object" || Array.isArray(d)) throw new FactError("bad_input", "dimensions must be an object");
  for (const [k, v] of Object.entries(d)) {
    if (!(v === null || ["string", "number", "boolean"].includes(typeof v))) {
      throw new FactError("bad_input", `dimension ${JSON.stringify(k)} must be a string, number, boolean or null`);
    }
  }
  return JSON.parse(canonicalJson(d)) as Record<string, unknown>;
}

function checkRef(db: DatabaseSync, table: "accounts" | "people", id: number | null | undefined, field: string): number | null {
  if (id === undefined || id === null) return null;
  if (!Number.isInteger(id)) throw new FactError("bad_input", `${field} must be an integer id`);
  if (!db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id)) {
    throw new FactError("bad_input", `No such ${table === "accounts" ? "account" : "person"}: ${id}`, { field });
  }
  return id;
}

/** Validate the concept, period, value, currency and references of a fact, and parse the value. */
export function prepareFact(db: DatabaseSync, f: FactFields): PreparedFact {
  if (typeof f.conceptId !== "string" || f.conceptId === "") throw new FactError("bad_input", "conceptId is required");
  const concept = getConcept(db, f.conceptId);
  if (!concept) throw new FactError("bad_input", `Unknown concept: ${f.conceptId}`, { conceptId: f.conceptId });
  if (concept.deprecatedBy !== null) {
    throw new FactError(
      "deprecated_concept",
      `Concept ${concept.id} is deprecated; use ${concept.deprecatedBy} instead.`,
      { conceptId: concept.id, replacement: concept.deprecatedBy },
    );
  }

  // Period must match the concept's period type.
  const instantDate = blankToNull(f.instantDate);
  const periodStart = blankToNull(f.periodStart);
  const periodEnd = blankToNull(f.periodEnd);
  for (const [name, v] of [["instantDate", instantDate], ["periodStart", periodStart], ["periodEnd", periodEnd]] as const) {
    if (v !== null && !isIsoDate(v)) throw new FactError("bad_period", `${name} must be a valid date (YYYY-MM-DD): ${v}`);
  }
  switch (concept.periodType) {
    case "instant":
      if (instantDate === null) throw new FactError("bad_period", `${concept.id} is an instant concept: instantDate is required`);
      if (periodStart !== null || periodEnd !== null) {
        throw new FactError("bad_period", `${concept.id} is an instant concept: do not give periodStart/periodEnd`);
      }
      break;
    case "duration":
      if (periodStart === null || periodEnd === null) {
        throw new FactError("bad_period", `${concept.id} is a duration concept: periodStart and periodEnd are required`);
      }
      if (instantDate !== null) throw new FactError("bad_period", `${concept.id} is a duration concept: do not give instantDate`);
      if (periodStart > periodEnd) throw new FactError("bad_period", "periodStart must not be after periodEnd");
      break;
    case "none":
      if (instantDate !== null || periodStart !== null || periodEnd !== null) {
        throw new FactError("bad_period", `${concept.id} has no period: do not give a date or period`);
      }
      break;
  }

  const taxYear = f.taxYear ?? null;
  if (taxYear !== null && (!Number.isInteger(taxYear) || taxYear < 1900 || taxYear > 2200)) {
    throw new FactError("bad_input", `taxYear must be a year between 1900 and 2200: ${taxYear}`);
  }

  // Value.
  const raw = typeof f.value === "string" ? f.value.trim() : "";
  if (raw === "") throw new FactError("bad_value", "value is required");
  const currencyIn = blankToNull(f.currency);
  let valueMinor: bigint | null = null;
  let valueDecimal: string | null = null;
  let valueText: string | null = null;
  let currency: string | null = null;
  switch (concept.valueType) {
    case "money": {
      if (currencyIn === null) throw new FactError("bad_value", `${concept.id} is a money concept: currency is required`);
      if (!isKnownCurrency(currencyIn)) throw new FactError("bad_value", `Unknown currency: ${currencyIn}`);
      try {
        valueMinor = parseAmount(raw, currencyIn).minor;
      } catch (e) {
        if (e instanceof MoneyParseError) throw new FactError("bad_value", e.message);
        throw e;
      }
      currency = currencyIn;
      break;
    }
    case "decimal":
      if (!/^-?\d+(\.\d+)?$/.test(raw)) throw new FactError("bad_value", `Not a plain decimal number: ${raw}`);
      valueDecimal = raw;
      break;
    case "integer":
      if (!/^-?\d+$/.test(raw)) throw new FactError("bad_value", `Not a whole number: ${raw}`);
      valueDecimal = raw;
      break;
    case "text":
      valueText = raw;
      break;
    case "date":
      if (!isIsoDate(raw)) throw new FactError("bad_value", `Not a valid date (YYYY-MM-DD): ${raw}`);
      valueText = raw;
      break;
    case "boolean": {
      const b = raw.toLowerCase();
      if (b !== "true" && b !== "false") throw new FactError("bad_value", `Not a boolean (true or false): ${raw}`);
      valueText = b;
      break;
    }
  }
  if (concept.valueType !== "money" && currencyIn !== null) {
    throw new FactError("bad_value", `${concept.id} is not a money concept: do not give a currency`);
  }

  const dimensions = checkDimensions(f.dimensions);
  const accountId = checkRef(db, "accounts", f.accountId, "accountId");
  const personId = checkRef(db, "people", f.personId, "personId");
  // A number is only meaningful with what it is about: an ending balance needs its account.
  if (concept.subject === "account" && accountId === null) {
    throw new FactError("subject_required", `${concept.labelEn} must be attached to an account.`, { field: "accountId", conceptId: concept.id });
  }
  if (concept.subject === "person" && personId === null) {
    throw new FactError("subject_required", `${concept.labelEn} must be attached to a person.`, { field: "personId", conceptId: concept.id });
  }
  return {
    concept,
    accountId,
    personId,
    valueMinor,
    valueDecimal,
    valueText,
    currency,
    instantDate,
    periodStart,
    periodEnd,
    taxYear,
    dimensions,
    dimensionsJson: canonicalJson(dimensions),
    note: blankToNull(f.note),
  };
}

type ValueFields = Pick<Fact, "valueMinor" | "valueDecimal" | "valueText" | "currency">;

export function sameValue(a: ValueFields, b: ValueFields): boolean {
  return (
    a.valueMinor === b.valueMinor && a.valueDecimal === b.valueDecimal && a.valueText === b.valueText && a.currency === b.currency
  );
}

/** Validate a box against the page: finite, positive area, inside (within float noise); returns it clamped. */
export function checkBbox(bbox: unknown, page: { widthPt: number; heightPt: number }): PdfRect {
  if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every((n) => typeof n === "number" && Number.isFinite(n))) {
    throw new FactError("bad_bbox", "bbox must be four finite numbers [x0, y0, x1, y1]");
  }
  const [a, b, c, d] = bbox as [number, number, number, number];
  const x0 = Math.min(a, c);
  const x1 = Math.max(a, c);
  const y0 = Math.min(b, d);
  const y1 = Math.max(b, d);
  const eps = 0.01;
  if (x0 < -eps || y0 < -eps || x1 > page.widthPt + eps || y1 > page.heightPt + eps) {
    throw new FactError("bad_bbox", `bbox is outside the page (${page.widthPt} x ${page.heightPt} pt)`, {
      page: [page.widthPt, page.heightPt],
    });
  }
  if (x1 - x0 <= 0 || y1 - y0 <= 0) throw new FactError("bad_bbox", "bbox must have a positive area");
  return [Math.max(x0, 0), Math.max(y0, 0), Math.min(x1, page.widthPt), Math.min(y1, page.heightPt)];
}
