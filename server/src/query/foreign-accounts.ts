// Pieces shared by the FBAR (D18) and Form 8938 (D21) reports: selecting the foreign accounts that
// were open during a year, converting cents to USD at the Treasury rate, and the single-date
// combined-balance computation. Pure.
import { Decimal } from "decimal.js";
import { currencyExponent } from "@finshark/shared";

/** Decimal with room for any cent amount divided by a rate; rounding is half-up, recorded below. */
const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export interface UsdRate {
  id: number;
  /** Units of the account currency per 1 USD. */
  rate: string;
  rateDate: string;
}

export type UsdConversion =
  | { kind: "none" } // already USD
  | { kind: "rate"; rate: string; rateDate: string; rateId: number; rounding: "half_up_to_cent" }
  | { kind: "missing_rate"; currency: string };

/** Convert cents of `currency` to USD cents: minor / rate, rounded half up to the cent. */
export function toUsdMinor(minor: bigint, currency: string, rate: string): bigint {
  if (currencyExponent(currency) !== currencyExponent("USD")) throw new RangeError(`${currency} and USD have different minor units`);
  return BigInt(new D(minor.toString()).div(rate).toDecimalPlaces(0).toFixed(0));
}

/** How `currency` converts to USD with the given rate lookup. Never falls back to another rate. */
export function conversionFor(currency: string, rateFor: (currency: string) => UsdRate | null): UsdConversion {
  if (currency === "USD") return { kind: "none" };
  const r = rateFor(currency);
  if (r === null) return { kind: "missing_rate", currency };
  return { kind: "rate", rate: r.rate, rateDate: r.rateDate, rateId: r.id, rounding: "half_up_to_cent" };
}

/** `minor` in USD cents under `conversion`; null when there is no rate. */
export function applyConversion(minor: bigint, currency: string, conversion: UsdConversion): bigint | null {
  if (conversion.kind === "none") return minor;
  if (conversion.kind === "rate") return toUsdMinor(minor, currency, conversion.rate);
  return null;
}

export interface ForeignScopeAccount {
  id: number;
  displayName: string;
  country: string;
  openedOn: string | null;
  closedOn: string | null;
}

export type NotInScopeReason = "opened_after_year" | "closed_before_year";

/** Foreign (country not US) accounts open at any time in `year`; the rest of the foreign ones are listed with why. */
export function selectForeignAccounts<A extends ForeignScopeAccount>(
  accounts: readonly A[],
  year: number,
): { inScope: A[]; notInScope: { accountId: number; displayName: string; reason: NotInScopeReason }[] } {
  const start = `${year}-01-01`;
  const end = `${year}-12-31`;
  const inScope: A[] = [];
  const notInScope: { accountId: number; displayName: string; reason: NotInScopeReason }[] = [];
  for (const account of accounts) {
    if (account.country === "US") continue; // domestic: not reportable here
    if (account.openedOn !== null && account.openedOn > end) notInScope.push({ accountId: account.id, displayName: account.displayName, reason: "opened_after_year" });
    else if (account.closedOn !== null && account.closedOn < start) notInScope.push({ accountId: account.id, displayName: account.displayName, reason: "closed_before_year" });
    else inScope.push(account);
  }
  return { inScope, notInScope };
}

export type TestVerdict = "EXCEEDED" | "NOT_EXCEEDED" | "UNDETERMINED";

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

/** One account's USD balances by date, for the single-date totals. */
export interface DatedBalances {
  accountId: number;
  usdByDate: ReadonlyMap<string, bigint>;
  /** The account is worth nothing before this date (opened later) ... */
  activeFrom?: string | null;
  /** ... and after this date (closed). Such dates count as zero, not as unknown. */
  activeTo?: string | null;
  /**
   * The account has a value on this one date only (a pension plan, D21). On any other date it
   * neither contributes nor counts as missing; nothing is carried to or from that date.
   */
  onlyDate?: string | null;
}

/** The combined balance on every date on which at least one account has a balance. */
export function combinedByDate(items: readonly DatedBalances[]): CombinedDate[] {
  const dates = [...new Set(items.flatMap((i) => [...i.usdByDate.keys()]))].sort();
  return dates.map((date) => {
    let usdMinor = 0n;
    const missingAccountIds: number[] = [];
    for (const i of items) {
      const v = i.usdByDate.get(date);
      if (v !== undefined) usdMinor += v;
      else if ((i.activeFrom != null && date < i.activeFrom) || (i.activeTo != null && date > i.activeTo)) continue;
      else if (i.onlyDate != null && date !== i.onlyDate) continue;
      else missingAccountIds.push(i.accountId);
    }
    return { date, usdMinor, missingAccountIds };
  });
}

/**
 * Single-date test against `threshold`. EXCEEDED from what is known (known balances are assumed
 * not negative, so a partial total is a lower bound); NOT_EXCEEDED only when `allKnown` and no
 * tested date has a missing balance. Balances are never carried forward from another date.
 */
export function singleDateTest(dates: readonly CombinedDate[], threshold: bigint, allKnown: boolean): SingleDateTest {
  const exceeded = dates.find((c) => c.usdMinor > threshold);
  const fullyKnown = allKnown && dates.every((c) => c.missingAccountIds.length === 0);
  return {
    verdict: exceeded ? "EXCEEDED" : fullyKnown ? "NOT_EXCEEDED" : "UNDETERMINED",
    dates: [...dates],
    exceededOn: exceeded?.date ?? null,
  };
}
