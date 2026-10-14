// Date prefill from a document's period (DESIGN §14 D2).
import type { PeriodType } from "@finshark/shared";

export interface PeriodSource {
  periodStart: string | null;
  periodEnd: string | null;
  issuedOn?: string | null;
  taxYear?: number | null;
}

export interface DatePrefill {
  instantDate: string;
  periodStart: string;
  periodEnd: string;
}

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Instant concepts: the period end (else the tax year's last day, else the issue date).
 * Duration concepts: period start..end (else the tax year). Concepts without a period: nothing.
 */
export function prefillDates(periodType: PeriodType | null | undefined, doc: PeriodSource): DatePrefill {
  const empty: DatePrefill = { instantDate: "", periodStart: "", periodEnd: "" };
  const yearStart = doc.taxYear ? `${doc.taxYear}-01-01` : "";
  const yearEnd = doc.taxYear ? `${doc.taxYear}-12-31` : "";
  if (periodType === "instant") {
    return { ...empty, instantDate: doc.periodEnd || yearEnd || doc.issuedOn || "" };
  }
  if (periodType === "duration") {
    if (doc.periodStart || doc.periodEnd) return { ...empty, periodStart: doc.periodStart ?? "", periodEnd: doc.periodEnd ?? "" };
    return { ...empty, periodStart: yearStart, periodEnd: yearEnd };
  }
  return empty;
}
