import type { ConceptDto, DocumentDto, FactDto, InstitutionDto, PersonDto } from "@finshark/shared";
import { factEvidenceHref } from "./accountChart.ts";
import { hrefFact } from "./route.ts";

/** Which column a person-level concept belongs to; null = not a pay concept. */
export type PayColumn = "wages" | "withheld";

const COLUMN_OF: Record<string, PayColumn> = {
  "income.wages": "wages",
  "tax.withheld.us_federal": "withheld",
};

/** wages / withheld for a concept id, following the generic parent (us.w2.box1_wages -> income.wages). */
export function payColumn(conceptId: string, concepts: readonly Pick<ConceptDto, "id" | "genericConceptId">[]): PayColumn | null {
  const generic = concepts.find((c) => c.id === conceptId)?.genericConceptId ?? conceptId;
  return COLUMN_OF[generic] ?? COLUMN_OF[conceptId] ?? null;
}

export interface PayValue {
  factId: number;
  formatted: string;
  /** The box it came from; a conflict goes to the fact page, where it is resolved. */
  href: string;
  conflict: boolean;
  /** Document name, or null for an attested value. */
  sourceName: string | null;
  pageNo: number | null;
}

export type PayRowKind = "annual" | "payslip" | "period";

/**
 * Annual or payslip, from the kind of number (us.w2.*) or else the source document's type, so wages
 * saved as plain "Wages" from a W-2 still count as annual. Neither known: "period", never guessed.
 */
function rowKind(f: FactDto, docs: ReadonlyMap<number, DocumentDto>): PayRowKind {
  if (f.conceptId.startsWith("us.w2.")) return "annual";
  const types = new Set(f.sources.map((s) => docs.get(s.documentId)?.docType));
  if (types.has("doc_type/tax_form")) return "annual";
  if (types.has("doc_type/pay_stub")) return "payslip";
  return "period";
}

export interface PayRow {
  key: string;
  /** See rowKind: "annual" = a tax form (W-2), "payslip" = a pay stub, "period" = neither is known. */
  kind: PayRowKind;
  periodStart: string | null;
  periodEnd: string | null;
  taxYear: number | null;
  wages: PayValue[];
  withheld: PayValue[];
}

export interface PayEmployer {
  key: string;
  /** null = "Employer not set": the fact's document has no employer institution. */
  employer: InstitutionDto | null;
  /** Two or more employers: the fact's sources point at documents of different employers, so none is picked. employer is null. */
  unclear: InstitutionDto[];
  rows: PayRow[];
}

export interface PayYear {
  year: number;
  employers: PayEmployer[];
}

export interface PayPerson {
  personId: number;
  personName: string;
  years: PayYear[];
}

export interface PayNotShown {
  factId: number;
  conceptLabel: string;
  personName: string | null;
  formatted: string;
  reason: string;
  href: string;
}

export interface PayView {
  people: PayPerson[];
  notShown: PayNotShown[];
}

function yearOf(f: FactDto): number | null {
  const iso = f.periodEnd ?? f.periodStart ?? f.instantDate;
  if (iso !== null && /^\d{4}-/.test(iso)) return Number(iso.slice(0, 4));
  return f.taxYear;
}

/**
 * The employer of a fact: the employer institution of its source documents. If the sources point at
 * different employers, all of them are returned in `unclear` and none is picked. Never guessed.
 */
function employerOf(
  f: FactDto,
  docs: ReadonlyMap<number, DocumentDto>,
  institutions: readonly InstitutionDto[],
): { employer: InstitutionDto | null; unclear: InstitutionDto[] } {
  const found = new Map<number, InstitutionDto>();
  for (const s of f.sources) {
    const inst = institutions.find((i) => i.id === docs.get(s.documentId)?.institutionId);
    if (inst && inst.kind === "employer") found.set(inst.id, inst);
  }
  const all = [...found.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
  return all.length > 1 ? { employer: null, unclear: all } : { employer: all[0] ?? null, unclear: [] };
}

function toValue(f: FactDto): PayValue {
  const conflict = f.status === "proposed";
  const s = f.sources[0];
  return {
    factId: f.id,
    formatted: f.formatted,
    href: conflict ? hrefFact(f.id) : factEvidenceHref(f),
    conflict,
    sourceName: s ? s.documentName : null,
    pageNo: s ? s.pageNo : null,
  };
}

/**
 * Person-level pay numbers, grouped by person, then calendar year, then employer, then period.
 * Nothing is summed or converted. Only current facts (verified, proposed) are used. Values without an
 * exact amount (or year, or person) are returned in `notShown`, never dropped.
 */
export function payView(
  facts: readonly FactDto[],
  concepts: readonly ConceptDto[],
  documents: readonly DocumentDto[],
  institutions: readonly InstitutionDto[],
  people: readonly Pick<PersonDto, "id" | "displayName">[],
): PayView {
  const docs = new Map(documents.map((d) => [d.id, d]));
  const subjectOf = new Map(concepts.map((c) => [c.id, c.subject]));
  const notShown: PayNotShown[] = [];
  const skip = (f: FactDto, reason: string) =>
    notShown.push({ factId: f.id, conceptLabel: f.conceptLabelEn, personName: f.personName, formatted: f.formatted, reason, href: hrefFact(f.id) });

  type Acc = { employer: InstitutionDto | null; unclear: InstitutionDto[]; rows: Map<string, PayRow> };
  const byPerson = new Map<number, Map<number, Map<string, Acc>>>();

  const current = facts.filter((f) => (f.status === "verified" || f.status === "proposed") && subjectOf.get(f.conceptId) === "person");
  for (const f of [...current].sort((a, b) => a.id - b.id)) {
    const column = payColumn(f.conceptId, concepts);
    if (column === null) {
      skip(f, "Not wages or tax withheld");
      continue;
    }
    if (f.personId === null) {
      skip(f, "No person");
      continue;
    }
    if (f.valueMinor === null || f.currency === null) {
      skip(f, "No exact amount");
      continue;
    }
    const year = yearOf(f);
    if (year === null) {
      skip(f, "No year");
      continue;
    }
    const { employer, unclear } = employerOf(f, docs, institutions);
    const kind = rowKind(f, docs);
    const rowKey = `${kind}|${f.periodStart ?? ""}|${f.periodEnd ?? ""}|${f.taxYear ?? ""}`;
    const years = byPerson.get(f.personId) ?? new Map<number, Map<string, Acc>>();
    byPerson.set(f.personId, years);
    const employers = years.get(year) ?? new Map<string, Acc>();
    years.set(year, employers);
    const ekey = unclear.length > 0 ? `unclear${unclear.map((i) => i.id).join("-")}` : employer ? `e${employer.id}` : "none";
    const acc = employers.get(ekey) ?? { employer, unclear, rows: new Map<string, PayRow>() };
    employers.set(ekey, acc);
    const row =
      acc.rows.get(rowKey) ??
      ({ key: `${ekey}|${rowKey}`, kind, periodStart: f.periodStart, periodEnd: f.periodEnd, taxYear: f.taxYear, wages: [], withheld: [] } satisfies PayRow);
    acc.rows.set(rowKey, row);
    row[column].push(toValue(f));
  }

  const name = (id: number) => people.find((p) => p.id === id)?.displayName ?? `Person ${id}`;
  const rank = (r: PayRow) => (r.kind === "annual" ? 0 : 1);
  const result: PayPerson[] = [...byPerson]
    .map(([personId, years]) => ({
      personId,
      personName: name(personId),
      years: [...years]
        .sort(([a], [b]) => b - a)
        .map(([year, employers]) => ({
          year,
          employers: [...employers]
            .map(([key, acc]) => ({
              key: `${year}|${key}`,
              employer: acc.employer,
              unclear: acc.unclear,
              rows: [...acc.rows.values()].sort(
                (a, b) => rank(a) - rank(b) || (a.periodStart ?? "").localeCompare(b.periodStart ?? "") || (a.periodEnd ?? "").localeCompare(b.periodEnd ?? ""),
              ),
            }))
            .sort((a, b) => {
              const rank = (e: PayEmployer) => (e.employer ? 0 : e.unclear.length > 0 ? 1 : 2);
              return rank(a) - rank(b) || (a.employer?.name ?? a.key).localeCompare(b.employer?.name ?? b.key);
            }),
        })),
    }))
    .sort((a, b) => a.personName.localeCompare(b.personName));
  return { people: result, notShown };
}
