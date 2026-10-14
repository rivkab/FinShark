import { formatAmount, type FactDto, type FactEventDto } from "@finshark/shared";
import type { FactEvent, FactView } from "../../facts/index.ts";

/** Money (bigint) is serialized as a decimal string plus a formatted display string. */
export function factToDto(v: FactView): FactDto {
  const f = v.fact;
  const formatted =
    f.valueMinor !== null && f.currency !== null
      ? formatAmount({ minor: f.valueMinor, currency: f.currency })
      : (f.valueDecimal ?? f.valueText ?? "");
  return {
    id: f.id,
    conceptId: f.conceptId,
    conceptLabelEn: v.concept.labelEn,
    conceptLabelHe: v.concept.labelHe,
    valueType: v.concept.valueType,
    accountId: f.accountId,
    accountName: v.account?.displayName ?? null,
    accountLanguage: v.account?.language ?? null,
    personId: f.personId,
    personName: v.person?.displayName ?? null,
    valueMinor: f.valueMinor === null ? null : f.valueMinor.toString(),
    valueDecimal: f.valueDecimal,
    valueText: f.valueText,
    currency: f.currency,
    formatted,
    instantDate: f.instantDate,
    periodStart: f.periodStart,
    periodEnd: f.periodEnd,
    taxYear: f.taxYear,
    dimensions: f.dimensions,
    status: f.status,
    origin: f.origin,
    extractionRunId: f.extractionRunId,
    supersedesFactId: f.supersedesFactId,
    note: f.note,
    createdAt: f.createdAt,
    createdBy: f.createdBy,
    verifiedAt: f.verifiedAt,
    verifiedBy: f.verifiedBy,
    sources: v.sources.map((s) => ({
      id: s.id,
      documentId: s.documentId,
      documentName: s.documentName,
      pageNo: s.pageNo,
      bbox: s.bbox,
      quotedText: s.quotedText,
    })),
    valueMatchesSource: v.valueMatchesSource,
  };
}

export function eventToDto(e: FactEvent): FactEventDto {
  return { id: e.id, factId: e.factId, at: e.at, actor: e.actor, actorName: e.actorName, event: e.event, payload: e.payload };
}
