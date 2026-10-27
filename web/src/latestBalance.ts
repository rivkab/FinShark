import type { ConceptDto, FactDto } from "@finshark/shared";
import { isBalanceConcept } from "./balanceSeries.ts";

/**
 * The newest ending balance per account, by the date it is reported for (ties go to the later fact).
 * A balance concept is balance.ending or one generalising to it (see isBalanceConcept).
 * Rejected and superseded facts are skipped; a proposed one (a conflict with a verified value) still counts, and the caller flags it.
 */
export function latestBalances(
  facts: readonly FactDto[],
  concepts: readonly Pick<ConceptDto, "id" | "genericConceptId">[],
): Map<number, FactDto> {
  const latest = new Map<number, FactDto>();
  for (const f of facts) {
    if (!isBalanceConcept(f.conceptId, concepts) || f.accountId === null || f.instantDate === null) continue;
    if (f.status !== "verified" && f.status !== "proposed") continue;
    const best = latest.get(f.accountId);
    if (!best || f.instantDate > best.instantDate! || (f.instantDate === best.instantDate && f.id > best.id)) {
      latest.set(f.accountId, f);
    }
  }
  return latest;
}
