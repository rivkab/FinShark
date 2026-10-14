// Form state for "Add a number" / "Correct", and the API requests built from it. Pure, unit-tested.
// Money stays a string end to end: the server parses it. Nothing here converts it to Number.
import {
  parseAmount,
  toDecimalString,
  type AccountDto,
  type AttestationRequest,
  type ConceptDto,
  type CorrectFactRequest,
  type FactDto,
  type PdfRect,
  type ProposeFactRequest,
} from "@finshark/shared";
import { ISO_DATE, prefillDates, type PeriodSource } from "./dates.ts";

export interface FactFormState {
  conceptId: string;
  /** "" = none. */
  accountId: string;
  value: string;
  currency: string;
  instantDate: string;
  periodStart: string;
  periodEnd: string;
  note: string;
}

export function emptyFactForm(): FactFormState {
  return { conceptId: "", accountId: "", value: "", currency: "", instantDate: "", periodStart: "", periodEnd: "", note: "" };
}

export function isMoney(c: Pick<ConceptDto, "valueType"> | undefined): boolean {
  return c?.valueType === "money";
}

/** Currency to start with: the account's, else the fallback (e.g. from the document's language). */
export function defaultCurrency(account: Pick<AccountDto, "nativeCurrency"> | undefined, fallback = "USD"): string {
  return account?.nativeCurrency ?? fallback;
}

/** Choosing a concept: fill dates from the document period unless the user typed their own. */
export function applyConceptChange(
  form: FactFormState,
  next: ConceptDto | undefined,
  previous: ConceptDto | undefined,
  doc: PeriodSource,
): FactFormState {
  const before = prefillDates(previous?.periodType, doc);
  const after = prefillDates(next?.periodType, doc);
  const keep = (cur: string, was: string, now: string) => (cur !== "" && cur !== was ? cur : now);
  return {
    ...form,
    conceptId: next?.id ?? "",
    instantDate: next?.periodType === "instant" ? keep(form.instantDate, before.instantDate, after.instantDate) : "",
    periodStart: next?.periodType === "duration" ? keep(form.periodStart, before.periodStart, after.periodStart) : "",
    periodEnd: next?.periodType === "duration" ? keep(form.periodEnd, before.periodEnd, after.periodEnd) : "",
  };
}

/** Value text to start from for an existing fact (money as a plain re-parsable decimal). */
export function valueForForm(f: Pick<FactDto, "valueMinor" | "currency" | "formatted">): string {
  if (f.valueMinor !== null && f.currency !== null) return toDecimalString({ minor: BigInt(f.valueMinor), currency: f.currency });
  return f.formatted;
}

export function formFromFact(f: FactDto): FactFormState {
  return {
    conceptId: f.conceptId,
    accountId: f.accountId === null ? "" : String(f.accountId),
    value: valueForForm(f),
    currency: f.currency ?? "",
    instantDate: f.instantDate ?? "",
    periodStart: f.periodStart ?? "",
    periodEnd: f.periodEnd ?? "",
    note: f.note ?? "",
  };
}

export function validateFactForm(form: FactFormState, concept: ConceptDto | undefined): string[] {
  const errors: string[] = [];
  if (!concept) errors.push("Choose what kind of number this is.");
  if (form.value.trim() === "") errors.push("Enter the value.");
  if (concept && isMoney(concept)) {
    if (form.currency === "") errors.push("Choose a currency.");
    else if (form.value.trim() !== "") {
      try {
        parseAmount(form.value, form.currency);
      } catch (e) {
        errors.push(e instanceof Error ? e.message : "The amount cannot be read.");
      }
    }
  }
  const checkDate = (label: string, v: string) => {
    if (!ISO_DATE.test(v)) errors.push(`${label} must be a date.`);
  };
  if (concept?.periodType === "instant") checkDate("Date", form.instantDate);
  if (concept?.periodType === "duration") {
    checkDate("Start date", form.periodStart);
    checkDate("End date", form.periodEnd);
    if (ISO_DATE.test(form.periodStart) && ISO_DATE.test(form.periodEnd) && form.periodEnd < form.periodStart) {
      errors.push("The end date is before the start date.");
    }
  }
  return errors;
}

/** Fields shared by propose/correct/attest that depend on the concept's kind. */
function conceptFields(form: FactFormState, concept: ConceptDto) {
  const out: { currency?: string; instantDate?: string; periodStart?: string; periodEnd?: string } = {};
  if (isMoney(concept)) out.currency = form.currency;
  if (concept.periodType === "instant") out.instantDate = form.instantDate;
  if (concept.periodType === "duration") {
    out.periodStart = form.periodStart;
    out.periodEnd = form.periodEnd;
  }
  return out;
}

export function buildProposeRequest(
  form: FactFormState,
  concept: ConceptDto,
  where: { documentId: number; pageNo: number; bbox: PdfRect },
): ProposeFactRequest {
  const note = form.note.trim();
  return {
    documentId: where.documentId,
    pageNo: where.pageNo,
    bbox: where.bbox,
    conceptId: concept.id,
    value: form.value.trim(),
    ...conceptFields(form, concept),
    ...(form.accountId !== "" ? { accountId: Number(form.accountId) } : {}),
    ...(note !== "" ? { note } : {}),
  };
}

export function buildCorrectRequest(form: FactFormState, concept: ConceptDto, verify: boolean): CorrectFactRequest {
  return {
    conceptId: concept.id,
    value: form.value.trim(),
    ...conceptFields(form, concept),
    accountId: form.accountId === "" ? null : Number(form.accountId),
    note: form.note.trim(),
    verify,
  };
}

export interface AttestationForm {
  conceptId: "status.account_closed" | "status.no_document_issued";
  date: string;
  periodStart: string;
  periodEnd: string;
  note: string;
}

export function buildAttestationRequest(accountId: number, form: AttestationForm): AttestationRequest {
  const base = { conceptId: form.conceptId, accountId, value: "true", note: form.note.trim() };
  return form.conceptId === "status.account_closed"
    ? { ...base, instantDate: form.date }
    : { ...base, periodStart: form.periodStart, periodEnd: form.periodEnd };
}

export function validateAttestation(form: AttestationForm): string[] {
  const errors: string[] = [];
  if (form.note.trim() === "") errors.push("Write who says so and why.");
  if (form.conceptId === "status.account_closed") {
    if (!ISO_DATE.test(form.date)) errors.push("Choose the date the account was closed.");
  } else {
    if (!ISO_DATE.test(form.periodStart) || !ISO_DATE.test(form.periodEnd)) errors.push("Choose the period.");
    else if (form.periodEnd < form.periodStart) errors.push("The end date is before the start date.");
  }
  return errors;
}

/** The sentence shown when the typed number does not equal the text in the box. */
export function mismatchWarning(valueMatchesSource: boolean | null, quotedText: string | null): string | null {
  if (valueMatchesSource !== false) return null;
  return `The number you typed differs from the text in the box (${quotedText && quotedText.trim() !== "" ? quotedText.trim() : "no text found"}).`;
}
