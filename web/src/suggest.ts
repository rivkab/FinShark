// "Same as last time" and small display helpers. Pure, unit-tested.
import type { DocumentDto, FactDto, UploadResponse } from "@finshark/shared";

/**
 * The most recent earlier document that shares an account with `current` and has facts.
 * "Earlier" = ends before this one starts/ends when both have periods, otherwise a lower id.
 */
export function findPreviousDocument(
  current: Pick<DocumentDto, "id" | "periodEnd" | "accountIds">,
  docs: readonly DocumentDto[],
  accountIds: readonly number[] = current.accountIds,
): DocumentDto | null {
  const cands = docs.filter((d) => {
    if (d.id === current.id || d.factCount === 0 || !d.accountIds.some((a) => accountIds.includes(a))) return false;
    if (current.periodEnd && d.periodEnd) return d.periodEnd < current.periodEnd;
    return d.id < current.id;
  });
  cands.sort((a, b) => {
    const pa = a.periodEnd ?? "";
    const pb = b.periodEnd ?? "";
    return pa === pb ? b.id - a.id : pa < pb ? 1 : -1;
  });
  return cands[0] ?? null;
}

export interface Suggestion {
  conceptId: string;
  labelEn: string;
  labelHe: string | null;
  language: FactDto["accountLanguage"];
  accountId: number | null;
  /** The earlier value, shown for reference only. */
  formatted: string;
  /** Where the earlier fact was read from (a hint for where to draw). */
  hint: { pageNo: number; bbox: [number, number, number, number] } | null;
}

/** One suggestion per concept (+account) from a previous document's live facts, in the order they were entered. */
export function suggestionsFromFacts(facts: readonly FactDto[], documentId: number, accountIds?: readonly number[]): Suggestion[] {
  const seen = new Set<string>();
  const out: Suggestion[] = [];
  for (const f of facts) {
    if (f.status !== "proposed" && f.status !== "verified") continue;
    if (f.origin === "attestation") continue;
    if (accountIds && f.accountId !== null && !accountIds.includes(f.accountId)) continue;
    const key = `${f.conceptId}|${f.accountId ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const src = f.sources.find((s) => s.documentId === documentId && s.bbox !== null && s.pageNo !== null);
    out.push({
      conceptId: f.conceptId,
      labelEn: f.conceptLabelEn,
      labelHe: f.conceptLabelHe,
      language: f.accountLanguage,
      accountId: f.accountId,
      formatted: f.formatted,
      hint: src ? { pageNo: src.pageNo!, bbox: [...src.bbox!] as [number, number, number, number] } : null,
    });
  }
  return out;
}

export interface UploadOutcome {
  kind: "imported" | "duplicate" | "possible_duplicate" | "possible_revision" | "error";
  documentId: number | null;
  /** Related document ids to link to. */
  related: number[];
  text: string;
}

export function describeUpload(r: UploadResponse): UploadOutcome {
  if (r.status === "duplicate") {
    return { kind: "duplicate", documentId: r.existingDocumentId, related: [r.existingDocumentId], text: "Already imported (identical file), see document" };
  }
  if (r.possibleRevisionOf.length > 0) {
    return { kind: "possible_revision", documentId: r.documentId, related: r.possibleRevisionOf, text: "Imported. This may be a corrected version of" };
  }
  if (r.possibleDuplicateOf.length > 0) {
    return { kind: "possible_duplicate", documentId: r.documentId, related: r.possibleDuplicateOf, text: "Imported. This may be a duplicate of" };
  }
  return { kind: "imported", documentId: r.documentId, related: [], text: "Imported" };
}

export function periodLabel(d: Pick<DocumentDto, "periodStart" | "periodEnd" | "taxYear">): string {
  if (d.periodStart && d.periodEnd) return `${d.periodStart} to ${d.periodEnd}`;
  if (d.periodEnd) return `until ${d.periodEnd}`;
  if (d.taxYear) return `tax year ${d.taxYear}`;
  return "";
}

/** Date text for a fact: an instant, a period, or nothing. */
export function factDateLabel(f: Pick<FactDto, "instantDate" | "periodStart" | "periodEnd">): string {
  if (f.instantDate) return f.instantDate;
  if (f.periodStart && f.periodEnd) return `${f.periodStart} to ${f.periodEnd}`;
  return "";
}
