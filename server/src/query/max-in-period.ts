// The `maxInPeriod` measure (DESIGN D18, C8): the highest balance of one account during a period,
// as the maximum of its verified period-end balances. That is an approximation of the true
// maximum (a balance can peak between statements), so every result says so and carries its
// derivation. Pure: facts in, answer out. No I/O, no clock.
import type { Fact } from "../facts/types.ts";

export interface MaxInPeriodAccount {
  id: number;
  nativeCurrency: string;
  openedOn: string | null;
  closedOn: string | null;
  statementCadence: string | null;
}

export interface MaxInPeriodInput {
  account: MaxInPeriodAccount;
  /** The account's facts, any concept and status; the measure picks what it needs. */
  facts: readonly Fact[];
  /** For matching concepts whose generic concept is `balance.ending`. */
  concepts: readonly { id: string; genericConceptId: string | null }[];
  /** Inclusive calendar dates. */
  period: { start: string; end: string };
}

export interface BalancePoint {
  date: string;
  minor: bigint;
  /** Verified facts reporting this value on this date (several = corroborated). */
  factIds: number[];
}

export interface ConflictingPoint {
  date: string;
  values: { minor: bigint; factIds: number[] }[];
}

export interface ExcludedFact {
  factId: number;
  date: string;
  reason: "unverified" | "other_currency" | "no_amount";
}

export type MaxInPeriodStatus = "COMPLETE" | "INCOMPLETE" | "CONFLICT";

export interface MaxInPeriodResult {
  status: MaxInPeriodStatus;
  /** The highest undisputed verified balance; null when there is none. */
  max: { minor: bigint; currency: string; date: string; factIds: number[] } | null;
  /** Always true: the maximum of period-end balances can understate the true peak. */
  approximation: true;
  /** Verified balances inside the period, undisputed, by date. */
  points: BalancePoint[];
  /** Dates a statement should have given a balance for, but none is recorded. */
  missing: string[];
  /** False when the cadence is unset or irregular: we cannot say which dates to expect. */
  coverageKnown: boolean;
  /** Two verified facts disagree on the same date. No value is chosen. */
  conflicts: ConflictingPoint[];
  /** Balance facts in the period that were not used, with why. */
  excluded: ExcludedFact[];
  derivation: {
    rule: "max_of_period_end_balances";
    period: { start: string; end: string };
    currency: string;
    factIds: number[];
  };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function checkDate(d: string, what: string): void {
  const ok = ISO_DATE.test(d) && new Date(`${d}T00:00:00Z`).toISOString().startsWith(d);
  if (!ok) throw new RangeError(`${what} must be a real YYYY-MM-DD date, got "${d}"`);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function monthEnd(year: number, month: number): string {
  return `${year}-${pad(month)}-${pad(new Date(Date.UTC(year, month, 0)).getUTCDate())}`;
}

/** Month ends in [from, to] whose month number is in `months` (calendar-aligned statements). */
function expectedDates(from: string, to: string, months: ReadonlySet<number>): string[] {
  const out: string[] = [];
  const [y0, m0] = from.split("-").map(Number) as [number, number];
  const [y1] = to.split("-").map(Number) as [number];
  for (let y = y0; y <= y1; y++) {
    for (let m = y === y0 ? m0 : 1; m <= 12; m++) {
      if (!months.has(m)) continue;
      const d = monthEnd(y, m);
      if (d > to) return out;
      if (d >= from) out.push(d);
    }
  }
  return out;
}

const ALL_MONTHS = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
const CADENCE_MONTHS: Readonly<Record<string, ReadonlySet<number>>> = {
  monthly: ALL_MONTHS,
  quarterly: new Set([3, 6, 9, 12]),
  semiannual: new Set([6, 12]),
  annual: new Set([12]),
};

function isBalanceConcept(id: string, concepts: MaxInPeriodInput["concepts"]): boolean {
  return id === "balance.ending" || concepts.some((c) => c.id === id && c.genericConceptId === "balance.ending");
}

export function maxInPeriod(input: MaxInPeriodInput): MaxInPeriodResult {
  const { account, period } = input;
  checkDate(period.start, "period.start");
  checkDate(period.end, "period.end");
  if (period.start > period.end) throw new RangeError("period.start must not be after period.end");
  const currency = account.nativeCurrency;

  const excluded: ExcludedFact[] = [];
  const byDate = new Map<string, Map<bigint, number[]>>();
  for (const f of input.facts) {
    if (f.accountId !== account.id || f.instantDate === null) continue;
    if (f.instantDate < period.start || f.instantDate > period.end) continue;
    if (!isBalanceConcept(f.conceptId, input.concepts)) continue;
    if (f.status === "rejected" || f.status === "superseded") continue;
    if (f.status === "proposed") {
      excluded.push({ factId: f.id, date: f.instantDate, reason: "unverified" });
      continue;
    }
    if (f.valueMinor === null) {
      excluded.push({ factId: f.id, date: f.instantDate, reason: "no_amount" });
      continue;
    }
    if (f.currency !== currency) {
      excluded.push({ factId: f.id, date: f.instantDate, reason: "other_currency" });
      continue;
    }
    const values = byDate.get(f.instantDate) ?? new Map<bigint, number[]>();
    values.set(f.valueMinor, [...(values.get(f.valueMinor) ?? []), f.id]);
    byDate.set(f.instantDate, values);
  }

  const points: BalancePoint[] = [];
  const conflicts: ConflictingPoint[] = [];
  for (const date of [...byDate.keys()].sort()) {
    const values = [...byDate.get(date)!].map(([minor, ids]) => ({ minor, factIds: ids.toSorted((a, b) => a - b) }));
    if (values.length === 1) points.push({ date, minor: values[0]!.minor, factIds: values[0]!.factIds });
    else conflicts.push({ date, values: values.toSorted((a, b) => (a.minor < b.minor ? -1 : 1)) });
  }
  excluded.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.factId - b.factId));

  // Dates a statement should cover: month ends of the cadence while the account was open.
  const months = account.statementCadence === null ? undefined : CADENCE_MONTHS[account.statementCadence];
  const from = account.openedOn !== null && account.openedOn > period.start ? account.openedOn : period.start;
  const to = account.closedOn !== null && account.closedOn < period.end ? account.closedOn : period.end;
  const have = new Set([...points.map((p) => p.date), ...conflicts.map((c) => c.date)]);
  const missing = months && from <= to ? expectedDates(from, to, months).filter((d) => !have.has(d)) : [];
  const coverageKnown = months !== undefined;

  let best: BalancePoint | null = null;
  for (const p of points) if (best === null || p.minor > best.minor) best = p;

  const status: MaxInPeriodStatus =
    conflicts.length > 0 ? "CONFLICT" : coverageKnown && missing.length === 0 && best !== null ? "COMPLETE" : "INCOMPLETE";

  return {
    status,
    max: best && { minor: best.minor, currency, date: best.date, factIds: best.factIds },
    approximation: true,
    points,
    missing,
    coverageKnown,
    conflicts,
    excluded,
    derivation: {
      rule: "max_of_period_end_balances",
      period: { start: period.start, end: period.end },
      currency,
      factIds: points.flatMap((p) => p.factIds),
    },
  };
}
