import type { FactDto } from "@finshark/shared";

/**
 * The newest ending balance per account, by the date it is reported for (ties go to the later fact).
 * Rejected and superseded facts are skipped; a proposed one still counts, and the caller shows it as unverified.
 */
export function latestBalances(facts: FactDto[]): Map<number, FactDto> {
  const latest = new Map<number, FactDto>();
  for (const f of facts) {
    if (f.conceptId !== "balance.ending" || f.accountId === null || f.instantDate === null) continue;
    if (f.status !== "verified" && f.status !== "proposed") continue;
    const best = latest.get(f.accountId);
    if (!best || f.instantDate > best.instantDate! || (f.instantDate === best.instantDate && f.id > best.id)) {
      latest.set(f.accountId, f);
    }
  }
  return latest;
}
