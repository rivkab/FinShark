import type { ConceptDto, FactDto } from "@finshark/shared";
import type { BalanceRowSource } from "./accountChart.ts";
import { isBalanceConcept } from "./balanceSeries.ts";
import { formatDay } from "./displayDate.ts";
import { hrefDocument, hrefFact } from "./route.ts";

export interface OtherNumberRow {
  fact: FactDto;
  /** "30 Sep 2026", "1 Jan 2025 to 31 Dec 2025", or "" when the fact has no date. */
  period: string;
  /** A proposed fact: another value is waiting to be verified or resolved. */
  conflict: boolean;
  sources: BalanceRowSource[];
}

function endKey(f: FactDto): string {
  return f.instantDate ?? f.periodEnd ?? "";
}

function periodText(f: FactDto): string {
  if (f.instantDate) return formatDay(f.instantDate);
  if (f.periodStart && f.periodEnd) return `${formatDay(f.periodStart)} to ${formatDay(f.periodEnd)}`;
  return "";
}

/**
 * The account's current (verified or proposed) facts that are not balances, newest first
 * (by instant or period end, then period start, then id descending). Balances are shown in
 * the chart, the Balances table and "Not plotted".
 */
export function otherNumbers(
  accountId: number,
  facts: readonly FactDto[],
  concepts: readonly Pick<ConceptDto, "id" | "genericConceptId">[],
): OtherNumberRow[] {
  return facts
    .filter(
      (f) =>
        f.accountId === accountId &&
        (f.status === "verified" || f.status === "proposed") &&
        !isBalanceConcept(f.conceptId, concepts),
    )
    .sort((a, b) => {
      const ea = endKey(a);
      const eb = endKey(b);
      if (ea !== eb) return ea < eb ? 1 : -1;
      const sa = a.periodStart ?? "";
      const sb = b.periodStart ?? "";
      if (sa !== sb) return sa < sb ? 1 : -1;
      return b.id - a.id;
    })
    .map((f) => ({
      fact: f,
      period: periodText(f),
      conflict: f.status === "proposed",
      sources:
        f.sources.length === 0
          ? [{ factId: f.id, documentId: null, documentName: null, pageNo: null, href: hrefFact(f.id) }]
          : f.sources.map((s) => ({
              factId: f.id,
              documentId: s.documentId,
              documentName: s.documentName,
              pageNo: s.pageNo,
              href: hrefDocument(s.documentId, f.id),
            })),
    }));
}
