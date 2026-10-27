import { formatAmount } from "@finshark/shared";
import type { AccountDto, ConceptDto, FactDto } from "@finshark/shared";

/** True when a fact's concept is balance.ending or has genericConceptId 'balance.ending'. */
export function isBalanceConcept(
  conceptId: string,
  concepts: readonly Pick<ConceptDto, "id" | "genericConceptId">[],
): boolean {
  if (conceptId === "balance.ending") return true;
  return concepts.some((c) => c.id === conceptId && c.genericConceptId === "balance.ending");
}

export interface SeriesPoint {
  /** YYYY-MM-DD (the fact's instantDate). */
  date: string;
  minor: bigint;
  /** formatAmount({ minor, currency }) */
  formatted: string;
  /** The facts reporting this exact value on this date (>= 1; several = corroborated by several sources). Sorted by id. */
  facts: FactDto[];
  /** Another, different value exists for the same date. */
  conflict: boolean;
}
export interface SeriesGap {
  from: string;
  to: string;
}
export interface SeriesSegment {
  from: string;
  to: string;
}

export interface BalanceSeries {
  currency: string;
  points: SeriesPoint[];
  segments: SeriesSegment[];
  gaps: SeriesGap[];
  /** Balance facts not plotted: other currency, or valueMinor null. Sorted by date then id. */
  notPlotted: FactDto[];
  start: string | null;
  end: string | null;
  closed: boolean;
}

/** Max days between statements before it counts as a gap; null = never a gap. */
export function cadenceMaxDays(cadence: string | null): number | null {
  switch (cadence) {
    case "monthly":
      return 45;
    case "quarterly":
      return 120;
    case "semiannual":
      return 200;
    case "annual":
      return 400;
    default:
      return null;
  }
}

function dayNumber(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Math.round(Date.UTC(y!, m! - 1, d!) / 86_400_000);
}

export function balanceSeries(
  account: Pick<AccountDto, "id" | "nativeCurrency" | "openedOn" | "closedOn" | "statementCadence">,
  facts: readonly FactDto[],
  concepts: readonly Pick<ConceptDto, "id" | "genericConceptId">[],
): BalanceSeries {
  const currency = account.nativeCurrency;
  const groups = new Map<string, SeriesPoint>(); // key: date|minor
  const notPlotted: FactDto[] = [];

  for (const f of facts) {
    if (f.accountId !== account.id || f.instantDate === null) continue;
    if (f.status !== "verified" && f.status !== "proposed") continue;
    if (!isBalanceConcept(f.conceptId, concepts)) continue;
    if (f.currency !== currency || f.valueMinor === null) {
      notPlotted.push(f);
      continue;
    }
    const minor = BigInt(f.valueMinor);
    const key = `${f.instantDate}|${minor}`;
    const existing = groups.get(key);
    if (existing) existing.facts.push(f);
    else
      groups.set(key, {
        date: f.instantDate,
        minor,
        formatted: formatAmount({ minor, currency }),
        facts: [f],
        conflict: false,
      });
  }

  const points = [...groups.values()].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : a.minor < b.minor ? -1 : a.minor > b.minor ? 1 : 0,
  );
  const perDate = new Map<string, number>();
  for (const p of points) {
    p.facts.sort((a, b) => a.id - b.id);
    perDate.set(p.date, (perDate.get(p.date) ?? 0) + 1);
  }
  for (const p of points) p.conflict = perDate.get(p.date)! > 1;
  notPlotted.sort((a, b) =>
    a.instantDate! < b.instantDate! ? -1 : a.instantDate! > b.instantDate! ? 1 : a.id - b.id,
  );

  const dates = [...perDate.keys()]; // already ascending (insertion follows sorted points)
  const limit = cadenceMaxDays(account.statementCadence);
  const segments: SeriesSegment[] = [];
  const gaps: SeriesGap[] = [];
  for (let i = 1; i < dates.length; i++) {
    const from = dates[i - 1]!;
    const to = dates[i]!;
    if (limit !== null && dayNumber(to) - dayNumber(from) > limit) gaps.push({ from, to });
    else if (perDate.get(from)! > 1 || perDate.get(to)! > 1) continue;
    else segments.push({ from, to });
  }

  return {
    currency,
    points,
    segments,
    gaps,
    notPlotted,
    start: account.openedOn ?? dates[0] ?? null,
    end: account.closedOn ?? dates[dates.length - 1] ?? null,
    closed: account.closedOn !== null,
  };
}
