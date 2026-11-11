// FBAR (FinCEN 114) report for one calendar year (DESIGN D18): each foreign account's maximum
// value during the year, converted to USD at the Treasury rate for 31 December, and compared
// with the $10,000 filing threshold. The sources word the threshold two ways, so both tests are
// run and shown (DESIGN D18): the sum of each account's own maximum, and the accounts' combined
// balance on one single date. Pure: the loader below supplies the data.
import type { DatabaseSync } from "node:sqlite";
import { findRate, TREASURY_SOURCE } from "../currency/index.ts";
import { listFacts } from "../facts/index.ts";
import type { Fact } from "../facts/types.ts";
import {
  applyConversion,
  combinedByDate,
  conversionFor,
  selectForeignAccounts,
  singleDateTest,
  toUsdMinor,
  type CombinedDate,
  type DatedBalances,
  type SingleDateTest,
  type TestVerdict,
  type UsdConversion,
  type UsdRate,
} from "./foreign-accounts.ts";
import { maxInPeriod, type MaxInPeriodAccount, type MaxInPeriodResult } from "./max-in-period.ts";

/** $10,000 in cents. The aggregate must *exceed* this. */
export const FBAR_THRESHOLD_USD_MINOR = 1_000_000n;

// Conversion and single-date pieces live in foreign-accounts.ts (shared with Form 8938).
export { toUsdMinor };
export type { CombinedDate, SingleDateTest, TestVerdict };

export interface FbarAccount extends MaxInPeriodAccount {
  displayName: string;
  country: string;
}

export type FbarRate = UsdRate;

export interface FbarInput {
  year: number;
  accounts: readonly FbarAccount[];
  facts: readonly Fact[];
  concepts: readonly { id: string; genericConceptId: string | null }[];
  /** The Treasury rate for 31 December of `year`, for a non-USD currency; null if none is stored. */
  rateFor(currency: string): FbarRate | null;
}

export type FbarConversion = UsdConversion;

export interface FbarRow {
  accountId: number;
  displayName: string;
  country: string;
  currency: string;
  measure: MaxInPeriodResult;
  conversion: FbarConversion | null; // null: no maximum to convert
  /** The maximum in USD cents; null when there is no maximum or no rate. */
  usdMinor: bigint | null;
}

/**
 * REQUIRED: the combined balance on one date exceeds the threshold, which satisfies both readings.
 * NOT_REQUIRED: even the sum of each account's maximum does not, so neither reading can.
 * DEPENDS_ON_RULE: the sum of maxima exceeds it but no single date is shown to; which reading
 *   applies decides it. Check the FBAR instructions or ask a preparer.
 */
export type FbarVerdict = "REQUIRED" | "NOT_REQUIRED" | "DEPENDS_ON_RULE" | "UNDETERMINED" | "NO_FOREIGN_ACCOUNTS";

export interface FbarReport {
  year: number;
  rows: FbarRow[];
  /** Foreign accounts that were not open at any time in the year. */
  notInScope: { accountId: number; displayName: string; reason: "opened_after_year" | "closed_before_year" }[];
  /** Sum of the USD maxima that are known. A lower bound when the report is not COMPLETE. */
  knownAggregateUsdMinor: bigint;
  thresholdUsdMinor: bigint;
  tests: {
    /** The sum of each account's own maximum, whenever it occurred. */
    sumOfMaxima: TestVerdict;
    /** The accounts' combined balance on a single date. */
    singleDate: SingleDateTest;
  };
  verdict: FbarVerdict;
  status: "COMPLETE" | "INCOMPLETE" | "CONFLICT";
}

export function fbarReport(input: FbarInput): FbarReport {
  const { year } = input;
  const period = { start: `${year}-01-01`, end: `${year}-12-31` };
  const rows: FbarRow[] = [];
  const { inScope, notInScope } = selectForeignAccounts(input.accounts, year);

  for (const account of inScope) {
    const measure = maxInPeriod({ account, facts: input.facts, concepts: input.concepts, period });
    const currency = account.nativeCurrency;
    const conversion: FbarConversion | null = measure.max === null ? null : conversionFor(currency, input.rateFor);
    const usdMinor = measure.max === null || conversion === null ? null : applyConversion(measure.max.minor, currency, conversion);
    rows.push({ accountId: account.id, displayName: account.displayName, country: account.country, currency, measure, conversion, usdMinor });
  }

  const known = rows.reduce((sum, r) => sum + (r.usdMinor ?? 0n), 0n);
  const allComplete = rows.every((r) => r.measure.status === "COMPLETE" && r.usdMinor !== null);

  // More data can only raise a known total (balances are assumed not to be negative), so
  // "exceeded" holds from what is known; "not exceeded" needs every row complete.
  const sumOfMaxima: TestVerdict = known > FBAR_THRESHOLD_USD_MINOR ? "EXCEEDED" : allComplete ? "NOT_EXCEEDED" : "UNDETERMINED";
  const singleDate = fbarSingleDate(rows, allComplete);

  const verdict: FbarVerdict =
    rows.length === 0 && notInScope.length === 0
      ? "NO_FOREIGN_ACCOUNTS"
      : sumOfMaxima === "NOT_EXCEEDED"
        ? "NOT_REQUIRED"
        : singleDate.verdict === "EXCEEDED"
          ? "REQUIRED"
          : sumOfMaxima === "EXCEEDED"
            ? "DEPENDS_ON_RULE"
            : "UNDETERMINED";
  const status = rows.some((r) => r.measure.status === "CONFLICT") ? "CONFLICT" : allComplete ? "COMPLETE" : "INCOMPLETE";

  return { year, rows, notInScope, knownAggregateUsdMinor: known, thresholdUsdMinor: FBAR_THRESHOLD_USD_MINOR, tests: { sumOfMaxima, singleDate }, verdict, status };
}

function fbarSingleDate(rows: readonly FbarRow[], allComplete: boolean): SingleDateTest {
  // Every balance in the year is converted at the 31 December rate, like the maximum.
  const items: DatedBalances[] = rows.map((r) => {
    const usdByDate = new Map<string, bigint>();
    if (r.conversion !== null) {
      for (const p of r.measure.points) {
        const v = applyConversion(p.minor, r.currency, r.conversion);
        if (v !== null) usdByDate.set(p.date, v);
      }
    }
    return { accountId: r.accountId, usdByDate };
  });
  return singleDateTest(combinedByDate(items), FBAR_THRESHOLD_USD_MINOR, allComplete);
}

// ---------------------------------------------------------------- loading from the vault

export function loadFbarInput(db: DatabaseSync, year: number): FbarInput {
  const accounts = (db.prepare("SELECT * FROM accounts ORDER BY id").all() as Record<string, unknown>[]).map(
    (r): FbarAccount => ({
      id: Number(r["id"]),
      displayName: String(r["display_name"]),
      country: String(r["country"]),
      nativeCurrency: String(r["native_currency"]),
      openedOn: (r["opened_on"] as string | null) ?? null,
      closedOn: (r["closed_on"] as string | null) ?? null,
      statementCadence: (r["statement_cadence"] as string | null) ?? null,
    }),
  );
  const concepts = (db.prepare("SELECT id, generic_concept_id FROM concepts").all() as Record<string, unknown>[]).map((r) => ({
    id: String(r["id"]),
    genericConceptId: (r["generic_concept_id"] as string | null) ?? null,
  }));
  const facts = accounts.filter((a) => a.country !== "US").flatMap((a) => listFacts(db, { accountId: a.id }).map((v) => v.fact));
  const rateFor = (currency: string): FbarRate | null => {
    const r = findRate(db, TREASURY_SOURCE, "USD", currency, `${year}-12-31`);
    return r && { id: r.id, rate: r.rate, rateDate: r.rateDate };
  };
  return { year, accounts, facts, concepts, rateFor };
}
