import { describe, expect, it } from "vitest";
import type { Fact } from "../facts/types.ts";
import { form8938Report, type Form8938Account, type Form8938Classification, type Form8938Concept, type Form8938Input } from "./form8938.ts";
import { balanceFact } from "./test-helpers.ts";

const USD = (n: number) => BigInt(n) * 100n; // whole dollars -> cents
const RATE = { id: 7, rate: "3.191", rateDate: "2025-12-31" };

const acct = (id: number, over: Partial<Form8938Account> = {}): Form8938Account => ({
  id,
  displayName: `Account ${id}`,
  country: "IL",
  nativeCurrency: "USD",
  openedOn: null,
  closedOn: null,
  statementCadence: "annual",
  institutionName: "Bank Example",
  identifiers: [],
  owners: [],
  ...over,
});
const FIN: Form8938Classification = { termId: "us_8938/financial_account", reason: null };
const PENSION: Form8938Classification = { termId: "us_8938/pension_plan", reason: null };
const ASK: Form8938Classification = { termId: "us_8938/ask_preparer", reason: null };

const concepts: Form8938Concept[] = [
  { id: "balance.ending", genericConceptId: null, periodType: "instant", valueType: "money" },
  { id: "income.interest", genericConceptId: null, periodType: "duration", valueType: "money" },
  { id: "statement.interest_paid", genericConceptId: "income.interest", periodType: "duration", valueType: "money" },
  { id: "us.1099int.box1", genericConceptId: "income.interest", periodType: "duration", valueType: "money" },
  { id: "income.wages", genericConceptId: null, periodType: "duration", valueType: "money" },
  { id: "statement.fee_total", genericConceptId: "fees.total", periodType: "duration", valueType: "money" },
];

function report(over: Partial<Form8938Input> = {}) {
  return form8938Report({
    year: 2025,
    taxYear: { filingStatus: "married_joint", abroad: false },
    accounts: [],
    classifications: {},
    facts: [],
    concepts,
    rateFor: (c) => (c === "ILS" ? RATE : null),
    ...over,
  });
}
/** A verified USD balance. */
const bal = (accountId: number, date: string, dollars: number, over: Partial<Fact> = {}) =>
  balanceFact(date, USD(dollars), { accountId, currency: "USD", ...over });
const ye = (accountId: number, dollars: number) => bal(accountId, "2025-12-31", dollars);
const interest = (accountId: number, start: string, end: string, minor: bigint | null, over: Partial<Fact> = {}) =>
  balanceFact("2025-12-31", minor, { accountId, currency: "USD", conceptId: "statement.interest_paid", instantDate: null, periodStart: start, periodEnd: end, ...over });
const all = (...ids: number[]) => Object.fromEntries(ids.map((i) => [i, FIN]));

describe("form8938Report thresholds (married filing jointly)", () => {
  it("year-end: REQUIRED only when the total exceeds $100,000 (US)", () => {
    const at = report({ accounts: [acct(1)], classifications: all(1), facts: [ye(1, 100_000)] });
    expect(at.verdict).toBe("NOT_REQUIRED");
    expect(at.status).toBe("COMPLETE");
    const over = report({ accounts: [acct(1)], classifications: all(1), facts: [bal(1, "2025-12-31", 0, { valueMinor: 10_000_001n })] });
    expect(over.verdict).toBe("REQUIRED");
    expect(over.scenarios.us.yearEnd.counted).toBe("EXCEEDED");
  });

  it("sums year-end values across accounts", () => {
    const r = report({ accounts: [acct(1), acct(2)], classifications: all(1, 2), facts: [ye(1, 60_000), ye(2, 60_000)] });
    expect(r.totals.yearEndUsdMinor.counted).toBe(USD(120_000));
    expect(r.verdict).toBe("REQUIRED");
  });

  it("at any time, single-date reading: two accounts together exceed $150,000 on a date although year-end is zero", () => {
    const r = report({
      accounts: [acct(1), acct(2)],
      classifications: all(1, 2),
      facts: [bal(1, "2025-06-30", 80_000), bal(2, "2025-06-30", 80_000), ye(1, 0), ye(2, 0)],
    });
    expect(r.totals.yearEndUsdMinor.counted).toBe(0n);
    expect(r.scenarios.us.singleDate.counted).toEqual({ verdict: "EXCEEDED", exceededOn: "2025-06-30" });
    expect(r.verdict).toBe("REQUIRED");
  });

  it("at any time, sum-of-maxima reading only: peaks on different dates -> DEPENDS_ON_RULE", () => {
    const r = report({
      accounts: [acct(1), acct(2)],
      classifications: all(1, 2),
      facts: [
        bal(1, "2025-06-30", 80_000), bal(2, "2025-06-30", 0),
        bal(1, "2025-09-30", 0), bal(2, "2025-09-30", 80_000),
        ye(1, 0), ye(2, 0),
      ],
    });
    expect(r.totals.sumOfMaximaUsdMinor.counted).toBe(USD(160_000));
    expect(r.scenarios.us.sumOfMaxima.counted).toBe("EXCEEDED");
    expect(r.scenarios.us.singleDate.counted.verdict).toBe("NOT_EXCEEDED");
    expect(r.verdict).toBe("DEPENDS_ON_RULE");
    expect(r.reasons).toContainEqual({ code: "sum_of_maxima_only" });
  });

  it("NOT_REQUIRED when everything is known and under both thresholds", () => {
    const r = report({ accounts: [acct(1)], classifications: all(1), facts: [bal(1, "2025-06-30", 90_000), ye(1, 50_000)] });
    expect(r.verdict).toBe("NOT_REQUIRED");
    expect(r.reasons).toEqual([]);
  });

  it("is UNDETERMINED while a value is missing and nothing known is over", () => {
    const r = report({ accounts: [acct(1), acct(2)], classifications: all(1, 2), facts: [ye(1, 10_000)] });
    expect(r.status).toBe("INCOMPLETE");
    expect(r.verdict).toBe("UNDETERMINED");
    expect(r.reasons).toContainEqual({ code: "missing_values", accountIds: [2] });
  });

  it("is REQUIRED from known lower bounds even when another account's value is missing", () => {
    const r = report({ accounts: [acct(1), acct(2)], classifications: all(1, 2), facts: [ye(1, 120_000)] });
    expect(r.verdict).toBe("REQUIRED");
    expect(r.status).toBe("INCOMPLETE");
  });

  it("says NO_FOREIGN_ACCOUNTS when there are none", () => {
    expect(report({}).verdict).toBe("NO_FOREIGN_ACCOUNTS");
    expect(report({ accounts: [acct(1, { country: "US" })] }).verdict).toBe("NO_FOREIGN_ACCOUNTS");
  });

  it("surfaces a conflicting year-end balance instead of choosing", () => {
    const r = report({ accounts: [acct(1)], classifications: all(1), facts: [ye(1, 10), ye(1, 20)] });
    expect(r.status).toBe("CONFLICT");
    expect(r.rows[0]!.yearEnd.source).toBe("conflict");
    expect(r.verdict).toBe("UNDETERMINED");
    expect(r.reasons).toContainEqual({ code: "conflicting_values", accountIds: [1] });
  });
});

describe("residence and filing status", () => {
  const base = (dollars: number) => ({ accounts: [acct(1)], classifications: all(1), facts: [ye(1, dollars)] });

  it("abroad: $400,000 year-end threshold", () => {
    expect(report({ ...base(200_000), taxYear: { filingStatus: "married_joint", abroad: true } }).verdict).toBe("NOT_REQUIRED");
    expect(report({ ...base(400_001), taxYear: { filingStatus: "married_joint", abroad: true } }).verdict).toBe("REQUIRED");
    expect(report({ ...base(200_000), taxYear: { filingStatus: "married_joint", abroad: false } }).verdict).toBe("REQUIRED");
  });

  it("abroad: $600,000 at-any-time threshold", () => {
    const facts = [bal(1, "2025-06-30", 500_000), bal(2, "2025-06-30", 200_000), ye(1, 0), ye(2, 0)];
    const r = report({ accounts: [acct(1), acct(2)], classifications: all(1, 2), facts, taxYear: { filingStatus: "married_joint", abroad: true } });
    expect(r.applied).toBe("abroad");
    expect(r.verdict).toBe("REQUIRED");
    expect(r.scenarios.abroad.singleDate.counted.exceededOn).toBe("2025-06-30");
  });

  it("residence not set: REQUIRED only if the abroad thresholds are exceeded", () => {
    const r = report({ ...base(500_000), taxYear: { filingStatus: "married_joint", abroad: null } });
    expect(r.applied).toBe("both");
    expect(r.verdict).toBe("REQUIRED");
  });

  it("residence not set: NOT_REQUIRED only if the US thresholds are not exceeded", () => {
    expect(report({ ...base(50_000), taxYear: { filingStatus: "married_joint", abroad: null } }).verdict).toBe("NOT_REQUIRED");
  });

  it("residence not set: in between is UNDETERMINED with a reason", () => {
    const r = report({ ...base(200_000), taxYear: { filingStatus: "married_joint", abroad: null } });
    expect(r.verdict).toBe("UNDETERMINED");
    expect(r.reasons).toContainEqual({ code: "residence_not_set" });
  });

  it.each(["single", "married_separate", "head_of_household", "qualifying_surviving_spouse", null] as const)("filing status %s is UNDETERMINED, never guessed", (filingStatus) => {
    const r = report({ ...base(900_000), taxYear: { filingStatus, abroad: false } });
    expect(r.verdict).toBe("UNDETERMINED");
    expect(r.reasons).toEqual([{ code: "unsupported_filing_status", filingStatus }]);
    expect(r.rows).toHaveLength(1); // values are still computed
  });
});

describe("classification", () => {
  it("lists not_reportable accounts with their reason and leaves them out of every total", () => {
    const r = report({
      accounts: [acct(1), acct(2)],
      classifications: { 1: FIN, 2: { termId: "us_8938/not_reportable", reason: "Held through a US broker" } },
      facts: [ye(1, 1_000), ye(2, 900_000)],
    });
    expect(r.notReportable).toEqual([{ accountId: 2, displayName: "Account 2", reason: "Held through a US broker" }]);
    expect(r.rows.map((x) => x.accountId)).toEqual([1]);
    expect(r.verdict).toBe("NOT_REQUIRED");
  });

  it("ask_preparer pushing the total over -> DEPENDS_ON_RULE, with the account named", () => {
    const r = report({ accounts: [acct(1), acct(2)], classifications: { 1: FIN, 2: ASK }, facts: [ye(1, 60_000), ye(2, 60_000)] });
    expect(r.totals.yearEndUsdMinor).toEqual({ counted: USD(60_000), withUnresolved: USD(120_000) });
    expect(r.rows.map((x) => [x.accountId, x.treatment, x.counted])).toEqual([[1, "financial_account", true], [2, "ask_preparer", false]]);
    expect(r.verdict).toBe("DEPENDS_ON_RULE");
    expect(r.reasons).toContainEqual({ code: "ask_preparer_accounts", accountIds: [2] });
    expect(r.reasons).toContainEqual({ code: "unresolved_accounts_push_over" });
  });

  it("an unclassified account is treated like ask_preparer and listed as not classified", () => {
    const r = report({ accounts: [acct(1), acct(2)], classifications: { 1: FIN, 2: null }, facts: [ye(1, 60_000), ye(2, 60_000)] });
    expect(r.rows[1]).toMatchObject({ accountId: 2, treatment: "not_classified", counted: false });
    expect(r.verdict).toBe("DEPENDS_ON_RULE");
    expect(r.reasons).toContainEqual({ code: "not_classified_accounts", accountIds: [2] });
  });

  it("NOT_REQUIRED needs unresolved accounts' values known too", () => {
    const r = report({ accounts: [acct(1), acct(2)], classifications: { 1: FIN, 2: ASK }, facts: [ye(1, 1_000)] });
    expect(r.verdict).toBe("UNDETERMINED");
    const known = report({ accounts: [acct(1), acct(2)], classifications: { 1: FIN, 2: ASK }, facts: [ye(1, 1_000), ye(2, 1_000)] });
    expect(known.verdict).toBe("NOT_REQUIRED");
  });

  it("an unresolved account's value never produces REQUIRED", () => {
    const r = report({ accounts: [acct(1)], classifications: { 1: ASK }, facts: [ye(1, 900_000)] });
    expect(r.verdict).toBe("DEPENDS_ON_RULE");
  });

  it("counts a joint account once", () => {
    const owners = [{ personId: 1, displayName: "Dana" }, { personId: 2, displayName: "Avi" }];
    const r = report({ accounts: [acct(1, { owners })], classifications: all(1), facts: [ye(1, 70_000)] });
    expect(r.rows).toHaveLength(1);
    expect(r.totals.yearEndUsdMinor.counted).toBe(USD(70_000));
    expect(r.rows[0]!.details.owners).toEqual(owners);
  });
});

describe("pension plans", () => {
  const pension = { accounts: [acct(1)], classifications: { 1: PENSION } };

  it("is valued on 31 December only; other balances are not used", () => {
    const r = report({ ...pension, facts: [bal(1, "2025-06-30", 900_000), ye(1, 120_000)] });
    expect(r.rows[0]!.maximum).toMatchObject({ source: "year_end_balance", usdMinor: USD(120_000), approximation: false });
    expect(r.rows[0]!.yearEnd.usdMinor).toBe(USD(120_000));
    expect(r.totals.sumOfMaximaUsdMinor.counted).toBe(USD(120_000));
    expect(r.verdict).toBe("REQUIRED");
  });

  it("without a 31 December balance the value is missing, not carried forward", () => {
    const r = report({ ...pension, facts: [bal(1, "2025-06-30", 900_000), bal(1, "2025-11-30", 900_000)] });
    expect(r.rows[0]!.maximum).toMatchObject({ source: "missing", usdMinor: null });
    expect(r.rows[0]!.yearEnd).toMatchObject({ source: "missing", usdMinor: null });
    expect(r.verdict).toBe("UNDETERMINED");
    expect(r.status).toBe("INCOMPLETE");
  });

  it("does not make the single-date test impossible to clear on other dates", () => {
    // A financial account with a mid-year balance and a pension plan valued on 31 December only.
    const r = report({
      accounts: [acct(1), acct(2)],
      classifications: { 1: FIN, 2: PENSION },
      facts: [bal(1, "2025-06-30", 20_000), ye(1, 20_000), ye(2, 30_000)],
    });
    const june = r.totals.singleDate.counted.find((d) => d.date === "2025-06-30")!;
    expect(june.missingAccountIds).toEqual([]);
    expect(r.scenarios.us.singleDate.counted.verdict).toBe("NOT_EXCEEDED");
    expect(r.verdict).toBe("NOT_REQUIRED");
  });

  it("a missing 31 December pension value still blocks 'not exceeded' on that date", () => {
    const r = report({ accounts: [acct(1), acct(2)], classifications: { 1: FIN, 2: PENSION }, facts: [ye(1, 20_000)] });
    expect(r.totals.singleDate.counted[0]!.missingAccountIds).toEqual([2]);
    expect(r.scenarios.us.singleDate.counted.verdict).toBe("UNDETERMINED");
  });
});

describe("year-end value", () => {
  it("is zero, stated as from the closing date, for an account closed before 31 December", () => {
    const r = report({
      accounts: [acct(1, { closedOn: "2025-06-15" })],
      classifications: all(1),
      facts: [bal(1, "2025-03-31", 60_000)],
    });
    expect(r.rows[0]!.yearEnd).toMatchObject({ minor: 0n, usdMinor: 0n, source: "closing_date", date: "2025-06-15" });
    expect(r.rows[0]!.maximum).toMatchObject({ usdMinor: USD(60_000), source: "balances" });
    expect(r.rows[0]!.details.closedDuringYear).toBe(true);
    expect(r.status).toBe("COMPLETE");
    expect(r.verdict).toBe("NOT_REQUIRED");
  });

  it("a closed account does not leave later dates unknown in the single-date totals", () => {
    const r = report({
      accounts: [acct(1, { closedOn: "2025-06-15" }), acct(2)],
      classifications: all(1, 2),
      facts: [bal(1, "2025-03-31", 10_000), bal(2, "2025-03-31", 10_000), ye(2, 10_000)],
    });
    expect(r.totals.singleDate.counted.every((d) => d.missingAccountIds.length === 0)).toBe(true);
    expect(r.verdict).toBe("NOT_REQUIRED");
  });

  it("is never carried forward from an earlier date", () => {
    const r = report({ accounts: [acct(1, { statementCadence: "quarterly" })], classifications: all(1), facts: [bal(1, "2025-09-30", 50_000)] });
    expect(r.rows[0]!.yearEnd).toMatchObject({ minor: null, source: "missing" });
    expect(r.status).toBe("INCOMPLETE");
  });
});

describe("rates", () => {
  it("converts at the 31 December rate and records it", () => {
    const il = acct(1, { nativeCurrency: "ILS" });
    const r = report({ accounts: [il], classifications: all(1), facts: [balanceFact("2025-12-31", 4_500_000n, { accountId: 1 })] });
    expect(r.rows[0]!.yearEnd.usdMinor).toBe(1_410_216n);
    expect(r.rows[0]!.maximum.usdMinor).toBe(1_410_216n);
    expect(r.rows[0]!.details.rate).toEqual({ rate: "3.191", rateDate: "2025-12-31", rateId: 7 });
  });

  it("shows a missing rate as missing and says which currency", () => {
    const il = acct(1, { nativeCurrency: "ILS" });
    const r = report({
      accounts: [il],
      classifications: all(1),
      facts: [balanceFact("2025-12-31", 900_000_000n, { accountId: 1 })],
      rateFor: () => null,
    });
    expect(r.rows[0]).toMatchObject({ conversion: { kind: "missing_rate", currency: "ILS" }, yearEnd: { usdMinor: null } });
    expect(r.verdict).toBe("UNDETERMINED");
    expect(r.status).toBe("INCOMPLETE");
    expect(r.reasons).toContainEqual({ code: "missing_rate", accountIds: [1], currencies: ["ILS"] });
  });
});

describe("scope and Part V/VI details", () => {
  it("lists foreign accounts not open during the year and ignores US accounts", () => {
    const r = report({
      accounts: [acct(1, { openedOn: "2026-01-02" }), acct(2, { closedOn: "2024-12-31" }), acct(3, { country: "US" }), acct(4)],
      classifications: all(4),
      facts: [ye(4, 1)],
    });
    expect(r.notInScope.map((n) => [n.accountId, n.reason])).toEqual([[1, "opened_after_year"], [2, "closed_before_year"]]);
    expect(r.rows.map((x) => x.accountId)).toEqual([4]);
  });

  it("carries identifiers, institution, opened flag, and reports address and GIIN as not stored", () => {
    const r = report({
      accounts: [
        acct(1, {
          openedOn: "2025-02-01",
          institutionName: "Bank Hapoalim",
          identifiers: [
            { kind: "iban", value: "IL62-0108-0000-0009-9999-999", validFrom: null, validTo: null },
            { kind: "last4", value: "1111", validFrom: null, validTo: "2024-12-31" },
          ],
        }),
      ],
      classifications: all(1),
      facts: [ye(1, 5)],
    });
    expect(r.rows[0]!.details).toMatchObject({
      identifiers: [{ kind: "iban", value: "IL62-0108-0000-0009-9999-999" }],
      institutionName: "Bank Hapoalim",
      openedDuringYear: true,
      closedDuringYear: false,
      currency: "USD",
      rate: null,
      mailingAddress: "not_in_finshark",
      giin: "not_in_finshark",
    });
    expect(r.partIV).toEqual({ checkedByPreparer: true });
  });
});

describe("Part III tax items", () => {
  const one = (facts: Fact[]) => report({ accounts: [acct(1)], classifications: all(1), facts: [ye(1, 10), ...facts] }).rows[0]!.taxItems!;

  it("totals by generic concept; complete when the periods cover the year without overlap", () => {
    const t = one([
      interest(1, "2025-01-01", "2025-06-30", 1_000n),
      interest(1, "2025-07-01", "2025-12-31", 2_500n, { conceptId: "us.1099int.box1" }), // another specific concept, same generic
    ]);
    expect(t.groups).toHaveLength(1);
    expect(t.groups[0]).toMatchObject({ genericConceptId: "income.interest", totalMinor: 3_500n, complete: true, gaps: [], overlaps: [] });
    expect(t.groups[0]!.factIds).toHaveLength(2);
    expect(t.noTaxItems).toBe(false);
  });

  it("a generic concept's own facts count, and non-income duration concepts are not tax items", () => {
    const t = one([
      interest(1, "2025-01-01", "2025-12-31", 700n, { conceptId: "income.interest" }),
      interest(1, "2025-01-01", "2025-12-31", 999n, { conceptId: "statement.fee_total" }),
      interest(1, "2025-01-01", "2025-12-31", 999n, { conceptId: "income.wages" }),
    ]);
    expect(t.groups.map((g) => [g.genericConceptId, g.totalMinor])).toEqual([["income.interest", 700n], ["income.wages", 999n]]);
  });

  it("lists gaps and is not complete", () => {
    const t = one([interest(1, "2025-02-01", "2025-06-30", 1_000n), interest(1, "2025-09-01", "2025-10-31", 500n)]);
    expect(t.groups[0]).toMatchObject({ complete: false, totalMinor: 1_500n });
    expect(t.groups[0]!.gaps).toEqual([
      { start: "2025-01-01", end: "2025-01-31" },
      { start: "2025-07-01", end: "2025-08-31" },
      { start: "2025-11-01", end: "2025-12-31" },
    ]);
  });

  it("lists overlaps and gives no total", () => {
    const t = one([
      interest(1, "2025-01-01", "2025-12-31", 3_000n),
      interest(1, "2025-07-01", "2025-12-31", 1_500n, { conceptId: "us.1099int.box1" }),
    ]);
    expect(t.groups[0]!.overlaps).toEqual([{ a: { start: "2025-01-01", end: "2025-12-31" }, b: { start: "2025-07-01", end: "2025-12-31" } }]);
    expect(t.groups[0]).toMatchObject({ totalMinor: null, complete: false });
  });

  it("surfaces conflicting facts for the same period instead of summing them", () => {
    const r = report({
      accounts: [acct(1)],
      classifications: all(1),
      facts: [ye(1, 10), interest(1, "2025-01-01", "2025-12-31", 3_000n), interest(1, "2025-01-01", "2025-12-31", 3_100n, { conceptId: "us.1099int.box1" })],
    });
    const g = r.rows[0]!.taxItems!.groups[0]!;
    expect(g.periods[0]).toMatchObject({ valueMinor: null });
    expect(g.periods[0]!.disagreeing!.map((d) => d.minor)).toEqual([3_000n, 3_100n]);
    expect(g).toMatchObject({ totalMinor: null, complete: false });
    expect(r.taxItemsStatus).toBe("CONFLICT");
  });

  it("corroborating facts with the same value count once", () => {
    const t = one([interest(1, "2025-01-01", "2025-12-31", 3_000n), interest(1, "2025-01-01", "2025-12-31", 3_000n, { conceptId: "us.1099int.box1" })]);
    expect(t.groups[0]).toMatchObject({ totalMinor: 3_000n, complete: true });
    expect(t.groups[0]!.periods[0]!.factIds).toHaveLength(2);
  });

  it("ignores unverified, rejected and other-year facts; lists excluded ones", () => {
    const t = one([
      interest(1, "2025-01-01", "2025-12-31", 3_000n, { status: "proposed" }),
      interest(1, "2025-01-01", "2025-12-31", 1n, { status: "rejected" }),
      interest(1, "2024-01-01", "2024-12-31", 8n),
      interest(1, "2024-07-01", "2025-06-30", 9n),
      interest(1, "2025-01-01", "2025-12-31", 5n, { currency: "ILS" }),
    ]);
    expect(t.groups).toEqual([]);
    expect(t.noTaxItems).toBe(true);
    expect(t.excluded.map((x) => x.reason).sort()).toEqual(["other_currency", "straddles_year", "unverified"]);
  });

  it("flags an account with no tax items, and only reports tax items for counted accounts", () => {
    const r = report({ accounts: [acct(1), acct(2)], classifications: { 1: FIN, 2: ASK }, facts: [ye(1, 1), ye(2, 1), interest(2, "2025-01-01", "2025-12-31", 5n)] });
    expect(r.rows[0]!.taxItems!.noTaxItems).toBe(true);
    expect(r.rows[1]!.taxItems).toBeNull();
  });
});
