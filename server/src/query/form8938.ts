// Form 8938 (Statement of Specified Foreign Financial Assets) report for one tax year (DESIGN D21).
// Reuses the FBAR pieces (foreign-accounts.ts, maxInPeriod): each foreign account's maximum and
// year-end value in USD at the Treasury rate for 31 December, tested against the filing
// thresholds for married filing jointly, plus the Part V/VI details and Part III tax items. Pure:
// every input, including the classification of each account for the year, is supplied.
import type { DatabaseSync } from "node:sqlite";
import type { FilingStatus, Us8938TermId } from "@finshark/shared";
import { findRate, TREASURY_SOURCE } from "../currency/index.ts";
import { getTaxYear, us8938TermsForYear } from "../db/tax-years.ts";
import { listFacts } from "../facts/index.ts";
import type { Fact, PeriodType, ValueType } from "../facts/types.ts";
import {
  applyConversion,
  combinedByDate,
  conversionFor,
  selectForeignAccounts,
  singleDateTest,
  type CombinedDate,
  type DatedBalances,
  type NotInScopeReason,
  type TestVerdict,
  type UsdConversion,
  type UsdRate,
} from "./foreign-accounts.ts";
import { maxInPeriod, type MaxInPeriodAccount, type MaxInPeriodResult, type MaxInPeriodStatus } from "./max-in-period.ts";


/** Thresholds in USD cents, married filing jointly (D21). A total must *exceed* them. */
export const FORM_8938_THRESHOLDS_USD_MINOR = {
  us: { yearEnd: 10_000_000n, anyTime: 15_000_000n },
  abroad: { yearEnd: 40_000_000n, anyTime: 60_000_000n },
} as const;

export interface Form8938Classification {
  termId: Us8938TermId;
  /** Required for not_reportable; shown on the report. */
  reason: string | null;
}

export interface Form8938Account extends MaxInPeriodAccount {
  displayName: string;
  country: string;
  institutionName: string | null;
  /** Rows of account_identifiers. */
  identifiers: readonly { kind: string; value: string; validFrom: string | null; validTo: string | null }[];
  owners: readonly { personId: number; displayName: string }[];
}

export interface Form8938Concept {
  id: string;
  genericConceptId: string | null;
  periodType: PeriodType;
  valueType: ValueType;
}

export interface Form8938Input {
  year: number;
  taxYear: {
    /** Anything but "married_joint" (including null) makes the verdict UNDETERMINED. */
    filingStatus: FilingStatus | null;
    /** Meets a presence abroad test; null = not set, so both threshold rows are tested. */
    abroad: boolean | null;
  };
  accounts: readonly Form8938Account[];
  /** By account id; an account that is absent or null is not classified. */
  classifications: Readonly<Record<number, Form8938Classification | null | undefined>>;
  facts: readonly Fact[];
  concepts: readonly Form8938Concept[];
  /** The Treasury rate for 31 December of `year`, for a non-USD currency; null if none is stored. */
  rateFor(currency: string): UsdRate | null;
}

// ------------------------------------------------------------------------------------ report

/** How the form treats the account. Only the first two are counted in the "firm" totals. */
export type Form8938Treatment = "financial_account" | "pension_plan" | "ask_preparer" | "not_classified";

export type ValueSource =
  | "balances" // the maximum of the period-end balances (financial accounts)
  | "year_end_balance" // a balance dated exactly 31 December
  | "closing_date" // year-end value only: closed before 31 December, zero from the closing date, not a statement
  | "missing"
  | "conflict"; // two verified facts disagree on 31 December

export interface AccountValue {
  /** In the account's own currency; null when unknown. */
  minor: bigint | null;
  /** In USD cents at the 31 December Treasury rate; null when unknown or when there is no rate. */
  usdMinor: bigint | null;
  source: ValueSource;
  date: string | null;
  factIds: number[];
}

export interface MaximumValue extends AccountValue {
  status: MaxInPeriodStatus;
  /** True when it is the maximum of period-end balances; false for a pension plan's 31 December value (or its absence). */
  approximation: boolean;
  /** The maxInPeriod result it is based on (for a pension plan, over 31 December alone). */
  measure: MaxInPeriodResult;
}

export interface YearEndValue extends AccountValue {
  status: MaxInPeriodStatus;
}

export interface PartVDetails {
  /** Identifiers valid at some time in the year. */
  identifiers: { kind: string; value: string }[];
  institutionName: string | null;
  openedDuringYear: boolean;
  closedDuringYear: boolean;
  owners: { personId: number; displayName: string }[];
  currency: string;
  rate: { rate: string; rateDate: string; rateId: number } | null;
  /** The institution's mailing address and GIIN are not stored in the vault. */
  mailingAddress: "not_in_finshark";
  giin: "not_in_finshark";
}

export interface TaxItemPeriod {
  periodStart: string;
  periodEnd: string;
  /** Null when verified facts disagree on this exact period (then `disagreeing` is set). */
  valueMinor: bigint | null;
  conceptIds: string[];
  factIds: number[];
  disagreeing: { minor: bigint; factIds: number[] }[] | null;
}

export interface TaxItemGroup {
  genericConceptId: string;
  currency: string;
  periods: TaxItemPeriod[];
  /**
   * The sum of the periods, in the account's currency. Null when periods overlap or disagree
   * (summing would double count or choose a value). With gaps it is a lower bound.
   */
  totalMinor: bigint | null;
  /** True only if the periods cover the whole year without overlap, none disagree and no fact was excluded. */
  complete: boolean;
  gaps: { start: string; end: string }[];
  overlaps: { a: { start: string; end: string }; b: { start: string; end: string } }[];
  /** Fact ids behind the total, for the sources links. */
  factIds: number[];
}

export interface ExcludedTaxItemFact {
  factId: number;
  genericConceptId: string;
  reason: "unverified" | "no_amount" | "other_currency" | "straddles_year" | "bad_period";
}

export interface TaxItems {
  groups: TaxItemGroup[];
  excluded: ExcludedTaxItemFact[];
  /** No tax item was found for the year: Part V has a box for that, so it is flagged. */
  noTaxItems: boolean;
}

export interface Form8938Row {
  accountId: number;
  displayName: string;
  country: string;
  currency: string;
  treatment: Form8938Treatment;
  /** True for financial_account and pension_plan; the rest only enter the "withUnresolved" totals. */
  counted: boolean;
  conversion: UsdConversion;
  maximum: MaximumValue;
  yearEnd: YearEndValue;
  details: PartVDetails;
  /** Only for counted accounts. */
  taxItems: TaxItems | null;
}

export interface Form8938Excluded {
  accountId: number;
  displayName: string;
  reason: string | null;
}

/** Why the verdict is not firm. */
export type Form8938Reason =
  | { code: "unsupported_filing_status"; filingStatus: FilingStatus | null }
  | { code: "residence_not_set" }
  | { code: "missing_values"; accountIds: number[] }
  | { code: "missing_rate"; accountIds: number[]; currencies: string[] }
  | { code: "conflicting_values"; accountIds: number[] }
  | { code: "ask_preparer_accounts"; accountIds: number[] }
  | { code: "not_classified_accounts"; accountIds: number[] }
  /** Only the sum of each account's maximum is over the threshold; no single date or year-end is shown to be. */
  | { code: "sum_of_maxima_only" }
  /** Counting ask_preparer / not classified accounts, a total is over; without them it is not. */
  | { code: "unresolved_accounts_push_over" };

export type Form8938Verdict = "REQUIRED" | "NOT_REQUIRED" | "DEPENDS_ON_RULE" | "UNDETERMINED" | "NO_FOREIGN_ACCOUNTS";

export interface ThresholdPair {
  yearEndUsdMinor: bigint;
  anyTimeUsdMinor: bigint;
}

/** Each test twice: over the counted accounts only, and also counting ask_preparer / not classified ones. */
export interface Paired<T> {
  counted: T;
  withUnresolved: T;
}

export interface ScenarioResult {
  thresholds: ThresholdPair;
  yearEnd: Paired<TestVerdict>;
  sumOfMaxima: Paired<TestVerdict>;
  singleDate: Paired<{ verdict: TestVerdict; exceededOn: string | null }>;
  /** The verdict if this row of the threshold table applied (the filing status is not considered here). */
  verdict: "REQUIRED" | "NOT_REQUIRED" | "DEPENDS_ON_RULE" | "UNDETERMINED";
}

export interface Form8938Report {
  year: number;
  filingStatus: FilingStatus | null;
  abroad: boolean | null;
  /** Counted accounts first (in input order), then ask_preparer / not classified ones. */
  rows: Form8938Row[];
  /** Classified not_reportable: excluded from every total, listed with their reason. */
  notReportable: Form8938Excluded[];
  /** Foreign accounts that were not open at any time in the year. */
  notInScope: { accountId: number; displayName: string; reason: NotInScopeReason }[];
  /** Totals of the values that are known (lower bounds when the report is not COMPLETE), in USD cents. */
  totals: {
    yearEndUsdMinor: Paired<bigint>;
    sumOfMaximaUsdMinor: Paired<bigint>;
    /** The combined balance on each date any account has one; see the pension plan note in this file. */
    singleDate: Paired<CombinedDate[]>;
  };
  /** Which threshold row(s) the verdict used: both when residence is not set. */
  applied: "us" | "abroad" | "both";
  scenarios: { us: ScenarioResult; abroad: ScenarioResult };
  verdict: Form8938Verdict;
  /** Filled when the verdict is UNDETERMINED or DEPENDS_ON_RULE. */
  reasons: Form8938Reason[];
  /** About the values: CONFLICT if two verified facts disagree on one, INCOMPLETE if any is missing. */
  status: "COMPLETE" | "INCOMPLETE" | "CONFLICT";
  /** About Part III, kept apart so that an account with no interest facts does not look like a value problem. */
  taxItemsStatus: "COMPLETE" | "INCOMPLETE" | "CONFLICT";
  /** Part IV (assets on Forms 3520, 5471, 8621 or 8865) is not tracked; the preparer must check it. */
  partIV: { checkedByPreparer: true };
}

// ------------------------------------------------------------------------------------ values

function dayNumber(date: string): number {
  return Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / 86_400_000;
}
function isoOf(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

function treatmentOf(c: Form8938Classification | null | undefined): Form8938Treatment | "not_reportable" {
  if (c == null) return "not_classified";
  switch (c.termId) {
    case "us_8938/financial_account":
      return "financial_account";
    case "us_8938/pension_plan":
      return "pension_plan";
    case "us_8938/not_reportable":
      return "not_reportable";
    case "us_8938/ask_preparer":
      return "ask_preparer";
  }
}

function usdOf(minor: bigint, currency: string, conversion: UsdConversion): bigint | null {
  return applyConversion(minor, currency, conversion);
}

function valueRow(
  account: Form8938Account,
  treatment: Form8938Treatment,
  input: Form8938Input,
  conversion: UsdConversion,
): { maximum: MaximumValue; yearEnd: YearEndValue } {
  const { year } = input;
  const yearEnd = `${year}-12-31`;
  const currency = account.nativeCurrency;
  const closedEarly = account.closedOn !== null && account.closedOn < yearEnd;
  // A pension plan is valued on the last day of the year only; its other balances are not used.
  const period = treatment === "pension_plan" ? { start: yearEnd, end: yearEnd } : { start: `${year}-01-01`, end: yearEnd };
  const measure = maxInPeriod({ account, facts: input.facts, concepts: input.concepts, period });

  // Year-end value: a balance dated exactly 31 December, never carried forward.
  let ye: YearEndValue;
  const yePoint = measure.points.find((p) => p.date === yearEnd);
  const yeConflict = measure.conflicts.some((c) => c.date === yearEnd);
  if (closedEarly) ye = { minor: 0n, usdMinor: 0n, source: "closing_date", date: account.closedOn, factIds: [], status: "COMPLETE" };
  else if (yePoint) ye = { minor: yePoint.minor, usdMinor: usdOf(yePoint.minor, currency, conversion), source: "year_end_balance", date: yearEnd, factIds: yePoint.factIds, status: "COMPLETE" };
  else ye = { minor: null, usdMinor: null, source: yeConflict ? "conflict" : "missing", date: null, factIds: [], status: yeConflict ? "CONFLICT" : "INCOMPLETE" };
  if (ye.minor !== null && ye.usdMinor === null) ye = { ...ye, status: "INCOMPLETE" }; // no rate

  let maximum: MaximumValue;
  if (treatment === "pension_plan" && closedEarly) {
    // The maximum is the value on the last day of the year, which a plan closed earlier does not
    // have; the instructions' fallback is not built (D21), so it is missing, never zero.
    maximum = { minor: null, usdMinor: null, source: "missing", date: null, factIds: [], status: "INCOMPLETE", approximation: false, measure };
  } else if (treatment === "pension_plan") {
    // Fair market value of the interest on the last day of the year: the year-end value itself.
    maximum = { ...ye, status: ye.status, approximation: false, measure };
  } else if (measure.max === null) {
    maximum = { minor: null, usdMinor: null, source: "missing", date: null, factIds: [], status: measure.status, approximation: true, measure };
  } else {
    const usd = usdOf(measure.max.minor, currency, conversion);
    maximum = {
      minor: measure.max.minor,
      usdMinor: usd,
      source: "balances",
      date: measure.max.date,
      factIds: measure.max.factIds,
      status: usd === null && measure.status === "COMPLETE" ? "INCOMPLETE" : measure.status,
      approximation: true,
      measure,
    };
  }
  return { maximum, yearEnd: ye };
}

// ------------------------------------------------------------------------------------ tax items

function isTaxItemConcept(c: Form8938Concept): boolean {
  return c.periodType === "duration" && c.valueType === "money" && (c.genericConceptId ?? c.id).startsWith("income.");
}

function taxItems(account: Form8938Account, year: number, input: Form8938Input): TaxItems {
  const byId = new Map(input.concepts.filter(isTaxItemConcept).map((c) => [c.id, c]));
  const yStart = `${year}-01-01`;
  const yEnd = `${year}-12-31`;
  const excluded: ExcludedTaxItemFact[] = [];
  // generic concept id -> period key -> value -> facts
  const groups = new Map<string, Map<string, { start: string; end: string; values: Map<bigint, { factIds: number[] }>; conceptIds: Set<string> }>>();

  for (const f of input.facts) {
    if (f.accountId !== account.id || f.periodStart === null || f.periodEnd === null) continue;
    const concept = byId.get(f.conceptId);
    if (concept === undefined) continue;
    if (f.status === "rejected" || f.status === "superseded") continue;
    if (f.periodEnd < yStart || f.periodStart > yEnd) continue; // another year
    const generic = concept.genericConceptId ?? concept.id;
    const out = (reason: ExcludedTaxItemFact["reason"]) => excluded.push({ factId: f.id, genericConceptId: generic, reason });
    if (f.periodStart > f.periodEnd) out("bad_period");
    else if (f.periodStart < yStart || f.periodEnd > yEnd) out("straddles_year"); // cannot be apportioned
    else if (f.status === "proposed") out("unverified");
    else if (f.valueMinor === null) out("no_amount");
    else if (f.currency !== account.nativeCurrency) out("other_currency");
    else {
      const periods = groups.get(generic) ?? new Map();
      const key = `${f.periodStart}/${f.periodEnd}`;
      const p = periods.get(key) ?? { start: f.periodStart, end: f.periodEnd, values: new Map(), conceptIds: new Set<string>() };
      const v = p.values.get(f.valueMinor) ?? { factIds: [] };
      v.factIds.push(f.id);
      p.values.set(f.valueMinor, v);
      p.conceptIds.add(f.conceptId);
      periods.set(key, p);
      groups.set(generic, periods);
    }
  }

  const out: TaxItemGroup[] = [];
  for (const generic of [...groups.keys()].sort()) {
    const periods: TaxItemPeriod[] = [...groups.get(generic)!.values()]
      .toSorted((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.end < b.end ? -1 : a.end > b.end ? 1 : 0))
      .map((p) => {
        const values = [...p.values].map(([minor, v]) => ({ minor, factIds: v.factIds.toSorted((a, b) => a - b) }));
        return {
          periodStart: p.start,
          periodEnd: p.end,
          valueMinor: values.length === 1 ? values[0]!.minor : null,
          conceptIds: [...p.conceptIds].sort(),
          factIds: values.flatMap((v) => v.factIds),
          disagreeing: values.length === 1 ? null : values.toSorted((a, b) => (a.minor < b.minor ? -1 : 1)),
        };
      });
    // Coverage of the year, day by day on the sorted distinct periods.
    const gaps: TaxItemGroup["gaps"] = [];
    const overlaps: TaxItemGroup["overlaps"] = [];
    let coveredEnd = dayNumber(yStart) - 1;
    let holder: TaxItemPeriod | null = null;
    for (const p of periods) {
      const s = dayNumber(p.periodStart);
      const e = dayNumber(p.periodEnd);
      if (holder !== null && s <= coveredEnd) overlaps.push({ a: { start: holder.periodStart, end: holder.periodEnd }, b: { start: p.periodStart, end: p.periodEnd } });
      else if (s > coveredEnd + 1) gaps.push({ start: isoOf(coveredEnd + 1), end: isoOf(s - 1) });
      if (e > coveredEnd) {
        coveredEnd = e;
        holder = p;
      }
    }
    if (coveredEnd < dayNumber(yEnd)) gaps.push({ start: isoOf(coveredEnd + 1), end: yEnd });

    const disagree = periods.some((p) => p.disagreeing !== null);
    const hasExcluded = excluded.some((x) => x.genericConceptId === generic);
    const totalMinor = disagree || overlaps.length > 0 ? null : periods.reduce((s, p) => s + (p.valueMinor ?? 0n), 0n);
    out.push({
      genericConceptId: generic,
      currency: account.nativeCurrency,
      periods,
      totalMinor,
      complete: gaps.length === 0 && overlaps.length === 0 && !disagree && !hasExcluded,
      gaps,
      overlaps,
      factIds: periods.flatMap((p) => p.factIds).sort((a, b) => a - b),
    });
  }
  excluded.sort((a, b) => a.factId - b.factId);
  return { groups: out, excluded, noTaxItems: out.length === 0 };
}

// ------------------------------------------------------------------------------------ report

function sumKnown(rows: readonly Form8938Row[], pick: (r: Form8938Row) => bigint | null): bigint {
  return rows.reduce((s, r) => s + (pick(r) ?? 0n), 0n);
}

function test(known: bigint, threshold: bigint, allKnown: boolean): TestVerdict {
  return known > threshold ? "EXCEEDED" : allKnown ? "NOT_EXCEEDED" : "UNDETERMINED";
}

/**
 * Single-date inputs for the rows. A pension plan has a value on 31 December only (D21), so it
 * contributes there and nowhere else: its balances on other dates are not invented, and on those
 * dates it is "not applicable" rather than "missing". That choice cannot make a total look smaller
 * than it is for the verdict: NOT_REQUIRED needs the sum of maxima (which includes the pension plan's
 * 31 December value in full) to be under the threshold, and no single date can exceed the sum of
 * maxima. A missing 31 December pension value is still missing on that date and blocks "not exceeded".
 * Dates before opening or after closing count as zero, not missing.
 */
function datedBalances(rows: readonly Form8938Row[], year: number): DatedBalances[] {
  return rows.map((r) => {
    const usdByDate = new Map<string, bigint>();
    const pension = r.treatment === "pension_plan";
    if (pension) {
      if (r.yearEnd.source === "year_end_balance" && r.yearEnd.usdMinor !== null) usdByDate.set(`${year}-12-31`, r.yearEnd.usdMinor);
    } else {
      for (const p of r.maximum.measure.points) {
        const v = applyConversion(p.minor, r.currency, r.conversion);
        if (v !== null) usdByDate.set(p.date, v);
      }
    }
    return { accountId: r.accountId, usdByDate, onlyDate: pension ? `${year}-12-31` : null };
  });
}

export function form8938Report(input: Form8938Input): Form8938Report {
  const { year } = input;
  const yearEnd = `${year}-12-31`;
  const { inScope, notInScope } = selectForeignAccounts(input.accounts, year);

  const rows: Form8938Row[] = [];
  const notReportable: Form8938Excluded[] = [];
  const activity = new Map<number, { from: string | null; to: string | null }>();
  for (const account of inScope) {
    const classification = input.classifications[account.id] ?? null;
    const treatment = treatmentOf(classification);
    if (treatment === "not_reportable") {
      notReportable.push({ accountId: account.id, displayName: account.displayName, reason: classification?.reason ?? null });
      continue;
    }
    const currency = account.nativeCurrency;
    const conversion = conversionFor(currency, input.rateFor);
    const { maximum, yearEnd: ye } = valueRow(account, treatment, input, conversion);
    const counted = treatment === "financial_account" || treatment === "pension_plan";
    const rate = conversion.kind === "rate" ? { rate: conversion.rate, rateDate: conversion.rateDate, rateId: conversion.rateId } : null;
    rows.push({
      accountId: account.id,
      displayName: account.displayName,
      country: account.country,
      currency,
      treatment,
      counted,
      conversion,
      maximum,
      yearEnd: ye,
      details: {
        identifiers: account.identifiers
          .filter((i) => (i.validTo === null || i.validTo >= `${year}-01-01`) && (i.validFrom === null || i.validFrom <= yearEnd))
          .map((i) => ({ kind: i.kind, value: i.value })),
        institutionName: account.institutionName,
        openedDuringYear: account.openedOn !== null && account.openedOn >= `${year}-01-01` && account.openedOn <= yearEnd,
        closedDuringYear: account.closedOn !== null && account.closedOn >= `${year}-01-01` && account.closedOn <= yearEnd,
        owners: account.owners.map((o) => ({ personId: o.personId, displayName: o.displayName })),
        currency,
        rate,
        mailingAddress: "not_in_finshark",
        giin: "not_in_finshark",
      },
      taxItems: counted ? taxItems(account, year, input) : null,
    });
    activity.set(account.id, { from: account.openedOn, to: account.closedOn });
  }
  rows.sort((a, b) => Number(b.counted) - Number(a.counted)); // stable: input order within each group

  const counted = rows.filter((r) => r.counted);
  const dated = (set: readonly Form8938Row[]): DatedBalances[] =>
    datedBalances(set, year).map((d) => ({ ...d, activeFrom: activity.get(d.accountId)!.from, activeTo: activity.get(d.accountId)!.to }));
  const datesCounted = combinedByDate(dated(counted));
  const datesAll = combinedByDate(dated(rows));

  const yeKnown = (set: readonly Form8938Row[]) => set.every((r) => r.yearEnd.usdMinor !== null);
  const maxKnown = (set: readonly Form8938Row[]) => set.every((r) => r.maximum.status === "COMPLETE" && r.maximum.usdMinor !== null);
  const totals = {
    yearEndUsdMinor: { counted: sumKnown(counted, (r) => r.yearEnd.usdMinor), withUnresolved: sumKnown(rows, (r) => r.yearEnd.usdMinor) },
    sumOfMaximaUsdMinor: { counted: sumKnown(counted, (r) => r.maximum.usdMinor), withUnresolved: sumKnown(rows, (r) => r.maximum.usdMinor) },
  };

  const scenario = (t: { yearEnd: bigint; anyTime: bigint }): ScenarioResult => {
    const yearEnd: Paired<TestVerdict> = {
      counted: test(totals.yearEndUsdMinor.counted, t.yearEnd, yeKnown(counted)),
      withUnresolved: test(totals.yearEndUsdMinor.withUnresolved, t.yearEnd, yeKnown(rows)),
    };
    const sumOfMaxima: Paired<TestVerdict> = {
      counted: test(totals.sumOfMaximaUsdMinor.counted, t.anyTime, maxKnown(counted)),
      withUnresolved: test(totals.sumOfMaximaUsdMinor.withUnresolved, t.anyTime, maxKnown(rows)),
    };
    const sdC = singleDateTest(datesCounted, t.anyTime, maxKnown(counted));
    const sdA = singleDateTest(datesAll, t.anyTime, maxKnown(rows));
    const verdict: ScenarioResult["verdict"] =
      yearEnd.counted === "EXCEEDED" || sdC.verdict === "EXCEEDED"
        ? "REQUIRED"
        : yearEnd.withUnresolved === "NOT_EXCEEDED" && sumOfMaxima.withUnresolved === "NOT_EXCEEDED"
          ? "NOT_REQUIRED"
          : sumOfMaxima.withUnresolved === "EXCEEDED" || yearEnd.withUnresolved === "EXCEEDED"
            ? "DEPENDS_ON_RULE"
            : "UNDETERMINED";
    return {
      thresholds: { yearEndUsdMinor: t.yearEnd, anyTimeUsdMinor: t.anyTime },
      yearEnd,
      sumOfMaxima,
      singleDate: {
        counted: { verdict: sdC.verdict, exceededOn: sdC.exceededOn },
        withUnresolved: { verdict: sdA.verdict, exceededOn: sdA.exceededOn },
      },
      verdict,
    };
  };
  const us = scenario(FORM_8938_THRESHOLDS_USD_MINOR.us);
  const abroad = scenario(FORM_8938_THRESHOLDS_USD_MINOR.abroad);

  const { filingStatus, abroad: abroadSet } = input.taxYear;
  const applied: Form8938Report["applied"] = abroadSet === null ? "both" : abroadSet ? "abroad" : "us";
  const decisive = abroadSet === true ? abroad : us; // detail reasons: the row that applies, else the lower one

  let verdict: Form8938Verdict;
  if (rows.length === 0 && notReportable.length === 0 && notInScope.length === 0) verdict = "NO_FOREIGN_ACCOUNTS";
  else if (filingStatus !== "married_joint") verdict = "UNDETERMINED";
  else if (abroadSet !== null) verdict = decisive.verdict;
  else verdict = abroad.verdict === "REQUIRED" ? "REQUIRED" : us.verdict === "NOT_REQUIRED" ? "NOT_REQUIRED" : "UNDETERMINED";

  const reasons: Form8938Reason[] = [];
  if (verdict === "UNDETERMINED" || verdict === "DEPENDS_ON_RULE") {
    if (filingStatus !== "married_joint") reasons.push({ code: "unsupported_filing_status", filingStatus });
    else {
      if (abroadSet === null && verdict === "UNDETERMINED") reasons.push({ code: "residence_not_set" });
      const ids = (f: (r: Form8938Row) => boolean) => rows.filter(f).map((r) => r.accountId);
      const missing = ids((r) => r.maximum.minor === null || r.yearEnd.minor === null);
      if (missing.length > 0) reasons.push({ code: "missing_values", accountIds: missing });
      const noRate = rows.filter((r) => r.conversion.kind === "missing_rate" && ((r.maximum.minor !== null && r.maximum.usdMinor === null) || (r.yearEnd.minor !== null && r.yearEnd.usdMinor === null)));
      if (noRate.length > 0) reasons.push({ code: "missing_rate", accountIds: noRate.map((r) => r.accountId), currencies: [...new Set(noRate.map((r) => r.currency))].sort() });
      const conflicting = ids((r) => r.maximum.status === "CONFLICT" || r.yearEnd.status === "CONFLICT");
      if (conflicting.length > 0) reasons.push({ code: "conflicting_values", accountIds: conflicting });
      const ask = ids((r) => r.treatment === "ask_preparer");
      if (ask.length > 0) reasons.push({ code: "ask_preparer_accounts", accountIds: ask });
      const unclassified = ids((r) => r.treatment === "not_classified");
      if (unclassified.length > 0) reasons.push({ code: "not_classified_accounts", accountIds: unclassified });
      if (verdict === "DEPENDS_ON_RULE") {
        const countedOver = decisive.sumOfMaxima.counted === "EXCEEDED" || decisive.yearEnd.counted === "EXCEEDED";
        reasons.push(countedOver ? { code: "sum_of_maxima_only" } : { code: "unresolved_accounts_push_over" });
      }
    }
  }

  const status: Form8938Report["status"] = rows.some((r) => r.maximum.status === "CONFLICT" || r.yearEnd.status === "CONFLICT")
    ? "CONFLICT"
    : rows.every((r) => r.maximum.status === "COMPLETE" && r.maximum.usdMinor !== null && r.yearEnd.usdMinor !== null)
      ? "COMPLETE"
      : "INCOMPLETE";
  const groups = counted.flatMap((r) => r.taxItems?.groups ?? []);
  const taxItemsStatus: Form8938Report["taxItemsStatus"] = groups.some((g) => g.periods.some((p) => p.disagreeing !== null))
    ? "CONFLICT"
    : groups.every((g) => g.complete) && counted.every((r) => (r.taxItems?.excluded.length ?? 0) === 0)
      ? "COMPLETE"
      : "INCOMPLETE";

  return {
    year,
    filingStatus,
    abroad: abroadSet,
    rows,
    notReportable,
    notInScope,
    totals: { ...totals, singleDate: { counted: datesCounted, withUnresolved: datesAll } },
    applied,
    scenarios: { us, abroad },
    verdict,
    reasons,
    status,
    taxItemsStatus,
    partIV: { checkedByPreparer: true },
  };
}

// ---------------------------------------------------------------- loading from the vault

/**
 * Owners shown for an account: people with role 'owner' or 'joint' whose ownership period
 * overlaps the tax year (valid_from <= 31 Dec and valid_to >= 1 Jan, NULL = unbounded). Other roles
 * (custodian, beneficiary, participant) do not own the asset for the form; a plan's participant
 * can be added to the classification question later. Ordered by person id.
 */
export function loadForm8938Input(db: DatabaseSync, year: number): Form8938Input {
  const start = `${year}-01-01`;
  const end = `${year}-12-31`;
  const institutions = new Map((db.prepare("SELECT id, name FROM institutions").all() as { id: number; name: string }[]).map((i) => [i.id, i.name]));
  const identifiers = db.prepare("SELECT account_id, kind, value, valid_from, valid_to FROM account_identifiers ORDER BY id").all() as Record<string, unknown>[];
  const owners = db
    .prepare(
      `SELECT ao.account_id, p.id AS person_id, p.display_name FROM account_owners ao JOIN people p ON p.id = ao.person_id
       WHERE ao.role IN ('owner', 'joint')
         AND (ao.valid_from IS NULL OR ao.valid_from <= ?) AND (ao.valid_to IS NULL OR ao.valid_to >= ?)
       ORDER BY p.id, ao.id`,
    )
    .all(end, start) as Record<string, unknown>[];
  const accounts = (db.prepare("SELECT * FROM accounts ORDER BY id").all() as Record<string, unknown>[]).map((r): Form8938Account => {
    const id = Number(r["id"]);
    const seen = new Set<number>();
    return {
      id,
      displayName: String(r["display_name"]),
      country: String(r["country"]),
      nativeCurrency: String(r["native_currency"]),
      openedOn: (r["opened_on"] as string | null) ?? null,
      closedOn: (r["closed_on"] as string | null) ?? null,
      statementCadence: (r["statement_cadence"] as string | null) ?? null,
      institutionName: institutions.get(Number(r["institution_id"])) ?? null,
      identifiers: identifiers
        .filter((i) => Number(i["account_id"]) === id)
        .map((i) => ({ kind: String(i["kind"]), value: String(i["value"]), validFrom: (i["valid_from"] as string | null) ?? null, validTo: (i["valid_to"] as string | null) ?? null })),
      owners: owners
        .filter((o) => Number(o["account_id"]) === id)
        .map((o) => ({ personId: Number(o["person_id"]), displayName: String(o["display_name"]) }))
        .filter((o) => !seen.has(o.personId) && seen.add(o.personId)),
    };
  });
  const concepts = (db.prepare("SELECT id, generic_concept_id, period_type, value_type FROM concepts").all() as Record<string, unknown>[]).map(
    (r): Form8938Concept => ({
      id: String(r["id"]),
      genericConceptId: (r["generic_concept_id"] as string | null) ?? null,
      periodType: r["period_type"] as PeriodType,
      valueType: r["value_type"] as ValueType,
    }),
  );
  const classifications: Record<number, Form8938Classification> = {};
  for (const [accountId, t] of us8938TermsForYear(db, year)) classifications[accountId] = { termId: t.termId, reason: t.reason };
  const ty = getTaxYear(db, year);
  const facts = accounts.filter((a) => a.country !== "US").flatMap((a) => listFacts(db, { accountId: a.id }).map((v) => v.fact));
  const rateFor = (currency: string): UsdRate | null => {
    const r = findRate(db, TREASURY_SOURCE, "USD", currency, end);
    return r && { id: r.id, rate: r.rate, rateDate: r.rateDate };
  };
  return { year, taxYear: { filingStatus: ty?.filingStatus ?? null, abroad: ty?.abroad8938 ?? null }, accounts, classifications, facts, concepts, rateFor };
}
