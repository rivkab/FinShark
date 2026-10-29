// FBAR (FinCEN 114) report for one calendar year (DESIGN D18): each foreign account's maximum
// value during the year, converted to USD at the Treasury rate for 31 December, and compared
// with the $10,000 filing threshold. The sources word the threshold two ways, so both tests are
// run and shown (DESIGN D18): the sum of each account's own maximum, and the accounts' combined
// balance on one single date. Pure: the loader below supplies the data.
import type { DatabaseSync } from "node:sqlite";
import { Decimal } from "decimal.js";
import { currencyExponent } from "@finshark/shared";
import { findRate, TREASURY_SOURCE } from "../currency/index.ts";
import { listFacts } from "../facts/index.ts";
import type { Fact } from "../facts/types.ts";
import { maxInPeriod, type MaxInPeriodAccount, type MaxInPeriodResult } from "./max-in-period.ts";

/** $10,000 in cents. The aggregate must *exceed* this. */
export const FBAR_THRESHOLD_USD_MINOR = 1_000_000n;

/** Decimal with room for any cent amount divided by a rate; rounding is half-up, recorded below. */
const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export interface FbarAccount extends MaxInPeriodAccount {
  displayName: string;
  country: string;
}

export interface FbarRate {
  id: number;
  /** Units of the account currency per 1 USD. */
  rate: string;
  rateDate: string;
}

export interface FbarInput {
  year: number;
  accounts: readonly FbarAccount[];
  facts: readonly Fact[];
  concepts: readonly { id: string; genericConceptId: string | null }[];
  /** The Treasury rate for 31 December of `year`, for a non-USD currency; null if none is stored. */
  rateFor(currency: string): FbarRate | null;
}

export type FbarConversion =
  | { kind: "none" } // already USD
  | { kind: "rate"; rate: string; rateDate: string; rateId: number; rounding: "half_up_to_cent" }
  | { kind: "missing_rate"; currency: string };

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

export type TestVerdict = "EXCEEDED" | "NOT_EXCEEDED" | "UNDETERMINED";

/**
 * REQUIRED: the combined balance on one date exceeds the threshold, which satisfies both readings.
 * NOT_REQUIRED: even the sum of each account's maximum does not, so neither reading can.
 * DEPENDS_ON_RULE: the sum of maxima exceeds it but no single date is shown to; which reading
 *   applies decides it. Check the FBAR instructions or ask a preparer.
 */
export type FbarVerdict = "REQUIRED" | "NOT_REQUIRED" | "DEPENDS_ON_RULE" | "UNDETERMINED" | "NO_FOREIGN_ACCOUNTS";

/** The accounts' combined USD balance on a date on which at least one account has a balance. */
export interface CombinedDate {
  date: string;
  /** Sum over the accounts that have a balance on this date. A lower bound when `missingAccountIds` is not empty. */
  usdMinor: bigint;
  /** In-scope accounts with no usable balance on this date: their balance that day is unknown. */
  missingAccountIds: number[];
}

export interface SingleDateTest {
  verdict: TestVerdict;
  dates: CombinedDate[];
  /** The earliest date whose known balances alone already exceed the threshold. */
  exceededOn: string | null;
}

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

/** Convert cents of `currency` to USD cents: minor / rate, rounded half up to the cent. */
export function toUsdMinor(minor: bigint, currency: string, rate: string): bigint {
  if (currencyExponent(currency) !== currencyExponent("USD")) throw new RangeError(`${currency} and USD have different minor units`);
  return BigInt(new D(minor.toString()).div(rate).toDecimalPlaces(0).toFixed(0));
}

export function fbarReport(input: FbarInput): FbarReport {
  const { year } = input;
  const period = { start: `${year}-01-01`, end: `${year}-12-31` };
  const rows: FbarRow[] = [];
  const notInScope: FbarReport["notInScope"] = [];

  for (const account of input.accounts) {
    if (account.country === "US") continue; // domestic: not reportable here
    if (account.openedOn !== null && account.openedOn > period.end) {
      notInScope.push({ accountId: account.id, displayName: account.displayName, reason: "opened_after_year" });
      continue;
    }
    if (account.closedOn !== null && account.closedOn < period.start) {
      notInScope.push({ accountId: account.id, displayName: account.displayName, reason: "closed_before_year" });
      continue;
    }
    const measure = maxInPeriod({ account, facts: input.facts, concepts: input.concepts, period });
    const currency = account.nativeCurrency;
    let conversion: FbarConversion | null = null;
    let usdMinor: bigint | null = null;
    if (measure.max !== null) {
      if (currency === "USD") {
        conversion = { kind: "none" };
        usdMinor = measure.max.minor;
      } else {
        const r = input.rateFor(currency);
        if (r === null) conversion = { kind: "missing_rate", currency };
        else {
          conversion = { kind: "rate", rate: r.rate, rateDate: r.rateDate, rateId: r.id, rounding: "half_up_to_cent" };
          usdMinor = toUsdMinor(measure.max.minor, currency, r.rate);
        }
      }
    }
    rows.push({ accountId: account.id, displayName: account.displayName, country: account.country, currency, measure, conversion, usdMinor });
  }

  const known = rows.reduce((sum, r) => sum + (r.usdMinor ?? 0n), 0n);
  const allComplete = rows.every((r) => r.measure.status === "COMPLETE" && r.usdMinor !== null);

  // More data can only raise a known total (balances are assumed not to be negative), so
  // "exceeded" holds from what is known; "not exceeded" needs every row complete.
  const sumOfMaxima: TestVerdict = known > FBAR_THRESHOLD_USD_MINOR ? "EXCEEDED" : allComplete ? "NOT_EXCEEDED" : "UNDETERMINED";
  const singleDate = singleDateTest(rows, allComplete);

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

function singleDateTest(rows: readonly FbarRow[], allComplete: boolean): SingleDateTest {
  // Every balance in the year is converted at the 31 December rate, like the maximum.
  const usdByRow = rows.map((r) => {
    const m = new Map<string, bigint>();
    if (r.conversion?.kind === "none") for (const p of r.measure.points) m.set(p.date, p.minor);
    else if (r.conversion?.kind === "rate") for (const p of r.measure.points) m.set(p.date, toUsdMinor(p.minor, r.currency, r.conversion.rate));
    return m;
  });
  const dates = [...new Set(usdByRow.flatMap((m) => [...m.keys()]))].sort();
  const combined: CombinedDate[] = dates.map((date) => {
    let usdMinor = 0n;
    const missingAccountIds: number[] = [];
    rows.forEach((r, i) => {
      const v = usdByRow[i]!.get(date);
      if (v === undefined) missingAccountIds.push(r.accountId);
      else usdMinor += v;
    });
    return { date, usdMinor, missingAccountIds };
  });
  const exceeded = combined.find((c) => c.usdMinor > FBAR_THRESHOLD_USD_MINOR);
  // Not exceeded is only known if every account's balance is known on every date tested.
  const fullyKnown = allComplete && combined.every((c) => c.missingAccountIds.length === 0);
  return {
    verdict: exceeded ? "EXCEEDED" : fullyKnown ? "NOT_EXCEEDED" : "UNDETERMINED",
    dates: combined,
    exceededOn: exceeded?.date ?? null,
  };
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
