import { describe, expect, it } from "vitest";
import type { Fact } from "../facts/types.ts";
import { balanceFact } from "./test-helpers.ts";
import { maxInPeriod, type MaxInPeriodAccount } from "./max-in-period.ts";

const balance = balanceFact;

const account = (over: Partial<MaxInPeriodAccount> = {}): MaxInPeriodAccount => ({
  id: 1,
  nativeCurrency: "ILS",
  openedOn: null,
  closedOn: null,
  statementCadence: "quarterly",
  ...over,
});
const YEAR = { start: "2025-01-01", end: "2025-12-31" };
const run = (facts: Fact[], acct = account(), period = YEAR) => maxInPeriod({ account: acct, facts, concepts: [], period });
const quarterly = (...v: bigint[]) => ["2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31"].map((d, i) => balance(d, v[i]!));

describe("maxInPeriod", () => {
  it("takes the highest verified period-end balance and records how", () => {
    const facts = quarterly(100_00n, 450_00n, 300_00n, 200_00n);
    const r = run(facts);
    expect(r.status).toBe("COMPLETE");
    expect(r.max).toEqual({ minor: 450_00n, currency: "ILS", date: "2025-06-30", factIds: [facts[1]!.id] });
    expect(r.approximation).toBe(true);
    expect(r.derivation).toEqual({ rule: "max_of_period_end_balances", period: YEAR, currency: "ILS", factIds: facts.map((f) => f.id) });
  });

  it("compares exactly, beyond what a float can hold", () => {
    const big = 9_007_199_254_740_993n; // 2^53 + 1
    const r = run(quarterly(big - 1n, big, big - 2n, 0n));
    expect(r.max!.minor).toBe(big);
  });

  it("reports an expected statement with no balance as missing, never skipped", () => {
    const facts = quarterly(100_00n, 450_00n, 300_00n, 200_00n).filter((f) => f.instantDate !== "2025-09-30");
    const r = run(facts);
    expect(r.status).toBe("INCOMPLETE");
    expect(r.missing).toEqual(["2025-09-30"]);
    expect(r.max!.minor).toBe(450_00n);
  });

  it("expects twelve month ends for a monthly account", () => {
    const facts = [balance("2025-01-31", 1n), balance("2025-12-31", 2n)];
    const r = run(facts, account({ statementCadence: "monthly" }));
    expect(r.missing).toHaveLength(10);
    expect(r.missing[0]).toBe("2025-02-28");
    expect(r.missing).toContain("2025-11-30");
  });

  it("only expects statements while the account was open", () => {
    const facts = [balance("2025-09-30", 5n), balance("2025-12-31", 7n)];
    const r = run(facts, account({ openedOn: "2025-07-15" }));
    expect(r.missing).toEqual([]);
    expect(r.status).toBe("COMPLETE");
    const closed = run([balance("2025-03-31", 5n)], account({ closedOn: "2025-05-02" }));
    expect(closed.missing).toEqual([]);
    expect(closed.status).toBe("COMPLETE");
  });

  it("is never COMPLETE when the cadence does not say which dates to expect", () => {
    for (const statementCadence of [null, "irregular"]) {
      const r = run([balance("2025-12-31", 5n)], account({ statementCadence }));
      expect(r.coverageKnown).toBe(false);
      expect(r.status).toBe("INCOMPLETE");
      expect(r.max!.minor).toBe(5n);
    }
  });

  it("does not choose between two verified facts that disagree on a date", () => {
    const facts = [...quarterly(100n, 200n, 300n, 400n), balance("2025-06-30", 999n)];
    const r = run(facts);
    expect(r.status).toBe("CONFLICT");
    expect(r.conflicts).toEqual([
      { date: "2025-06-30", values: [{ minor: 200n, factIds: [facts[1]!.id] }, { minor: 999n, factIds: [facts[4]!.id] }] },
    ]);
    expect(r.max!.minor).toBe(400n); // the disputed date is not used
    expect(r.missing).toEqual([]);
  });

  it("treats equal values from several sources as one corroborated point", () => {
    const facts = [...quarterly(100n, 200n, 300n, 400n), balance("2025-12-31", 400n)];
    const r = run(facts);
    expect(r.status).toBe("COMPLETE");
    expect(r.max!.factIds).toEqual([facts[3]!.id, facts[4]!.id]);
  });

  it("lists unverified, foreign-currency and amountless balances as excluded, and ignores dead facts", () => {
    const proposed = balance("2025-12-31", 9_999n, { status: "proposed" });
    const usd = balance("2025-12-31", 8_888n, { currency: "USD" });
    const noAmount = balance("2025-06-30", null);
    const rejected = balance("2025-12-31", 7_777n, { status: "rejected" });
    const superseded = balance("2025-12-31", 6_666n, { status: "superseded" });
    const r = run([...quarterly(100n, 200n, 300n, 400n), proposed, usd, noAmount, rejected, superseded]);
    expect(r.excluded).toEqual([
      { factId: noAmount.id, date: "2025-06-30", reason: "no_amount" },
      { factId: proposed.id, date: "2025-12-31", reason: "unverified" },
      { factId: usd.id, date: "2025-12-31", reason: "other_currency" },
    ]);
    expect(r.max!.minor).toBe(400n);
  });

  it("uses only balances inside the period, inclusive of both ends, for this account", () => {
    const facts = [
      balance("2024-12-31", 9_000n),
      balance("2025-01-01", 10n),
      balance("2025-12-31", 20n),
      balance("2026-01-01", 9_000n),
      balance("2025-06-30", 9_000n, { accountId: 2 }),
    ];
    const r = run(facts, account({ statementCadence: "annual" }));
    expect(r.points.map((p) => p.date)).toEqual(["2025-01-01", "2025-12-31"]);
    expect(r.max!.minor).toBe(20n);
  });

  it("matches a specific concept whose generic concept is balance.ending", () => {
    const pension = balance("2025-12-31", 77n, { conceptId: "il.pension.accrued_savings" });
    const other = balance("2025-12-31", 99n, { conceptId: "statement.interest_paid" });
    const concepts = [{ id: "il.pension.accrued_savings", genericConceptId: "balance.ending" }];
    const r = maxInPeriod({ account: account({ statementCadence: "annual" }), facts: [pension, other], concepts, period: YEAR });
    expect(r.max!.minor).toBe(77n);
  });

  it("has no maximum and is INCOMPLETE when nothing is recorded", () => {
    const r = run([]);
    expect(r.max).toBeNull();
    expect(r.status).toBe("INCOMPLETE");
    expect(r.missing).toHaveLength(4);
  });

  it("rejects an impossible period", () => {
    expect(() => run([], account(), { start: "2025-12-31", end: "2025-01-01" })).toThrow(RangeError);
    expect(() => run([], account(), { start: "2025-02-30", end: "2025-12-31" })).toThrow(/real YYYY-MM-DD/);
  });
});
