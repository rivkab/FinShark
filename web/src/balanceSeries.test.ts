import { describe, expect, it } from "vitest";
import type { AccountDto, ConceptDto, FactDto } from "@finshark/shared";
import { balanceSeries, cadenceMaxDays, isBalanceConcept } from "./balanceSeries.ts";

const concepts: Pick<ConceptDto, "id" | "genericConceptId">[] = [
  { id: "balance.ending", genericConceptId: null },
  { id: "il.pension.accrued_savings", genericConceptId: "balance.ending" },
  { id: "interest.earned", genericConceptId: null },
];

const account = (over: Partial<AccountDto> = {}) =>
  ({ id: 1, nativeCurrency: "USD", openedOn: null, closedOn: null, statementCadence: "monthly", ...over }) as AccountDto;

const fact = (id: number, over: Partial<FactDto> = {}): FactDto =>
  ({
    id,
    conceptId: "balance.ending",
    accountId: 1,
    instantDate: "2025-01-31",
    valueMinor: "10000",
    currency: "USD",
    status: "verified",
    ...over,
  }) as FactDto;

describe("isBalanceConcept", () => {
  it("matches balance.ending and generic children only", () => {
    expect(isBalanceConcept("balance.ending", [])).toBe(true);
    expect(isBalanceConcept("il.pension.accrued_savings", concepts)).toBe(true);
    expect(isBalanceConcept("interest.earned", concepts)).toBe(false);
    expect(isBalanceConcept("unknown", concepts)).toBe(false);
  });
});

describe("cadenceMaxDays", () => {
  it("maps cadences", () => {
    expect(cadenceMaxDays("monthly")).toBe(45);
    expect(cadenceMaxDays("quarterly")).toBe(120);
    expect(cadenceMaxDays("semiannual")).toBe(200);
    expect(cadenceMaxDays("annual")).toBe(400);
    expect(cadenceMaxDays("irregular")).toBeNull();
    expect(cadenceMaxDays(null)).toBeNull();
    expect(cadenceMaxDays("weird")).toBeNull();
  });
});

describe("balanceSeries", () => {
  it("groups equal values on a date into one corroborated point", () => {
    const s = balanceSeries(account(), [fact(5), fact(2), fact(3, { instantDate: "2025-02-28", valueMinor: "12345" })], concepts);
    expect(s.points).toHaveLength(2);
    expect(s.points[0]!.facts.map((f) => f.id)).toEqual([2, 5]);
    expect(s.points[0]!.minor).toBe(10000n);
    expect(s.points[0]!.formatted).toBe("$100.00");
    expect(s.points[0]!.conflict).toBe(false);
    expect(s.segments).toEqual([{ from: "2025-01-31", to: "2025-02-28" }]);
    expect(s.gaps).toEqual([]);
  });

  it("flags conflicts and breaks the line at that date", () => {
    const s = balanceSeries(
      account(),
      [
        fact(1, { instantDate: "2025-01-31" }),
        fact(2, { instantDate: "2025-02-28", valueMinor: "200" }),
        fact(3, { instantDate: "2025-02-28", valueMinor: "100", status: "proposed" }),
        fact(4, { instantDate: "2025-03-31" }),
      ],
      concepts,
    );
    expect(s.points.map((p) => [p.date, p.minor, p.conflict])).toEqual([
      ["2025-01-31", 10000n, false],
      ["2025-02-28", 100n, true],
      ["2025-02-28", 200n, true],
      ["2025-03-31", 10000n, false],
    ]);
    expect(s.segments).toEqual([]);
    expect(s.gaps).toEqual([]);
  });

  it("makes a gap instead of a segment beyond the cadence limit", () => {
    const facts = [fact(1), fact(2, { instantDate: "2025-03-17" }), fact(3, { instantDate: "2025-03-18" })];
    // Jan 31 -> Mar 17 is 45 days (ok); Mar 17 -> Mar 18 fine
    expect(balanceSeries(account(), facts, concepts).gaps).toEqual([]);
    const s = balanceSeries(account(), [fact(1), fact(2, { instantDate: "2025-03-18" })], concepts); // 46 days
    expect(s.gaps).toEqual([{ from: "2025-01-31", to: "2025-03-18" }]);
    expect(s.segments).toEqual([]);
  });

  it("uses each cadence's limit", () => {
    const two = (to: string) => [fact(1, { instantDate: "2025-01-01" }), fact(2, { instantDate: to })];
    expect(balanceSeries(account({ statementCadence: "quarterly" }), two("2025-05-01"), concepts).gaps).toHaveLength(0); // 120
    expect(balanceSeries(account({ statementCadence: "quarterly" }), two("2025-05-02"), concepts).gaps).toHaveLength(1);
    expect(balanceSeries(account({ statementCadence: "semiannual" }), two("2025-07-20"), concepts).gaps).toHaveLength(0); // 200
    expect(balanceSeries(account({ statementCadence: "semiannual" }), two("2025-07-21"), concepts).gaps).toHaveLength(1);
    expect(balanceSeries(account({ statementCadence: "annual" }), two("2026-02-05"), concepts).gaps).toHaveLength(0); // 400
    expect(balanceSeries(account({ statementCadence: "annual" }), two("2026-02-06"), concepts).gaps).toHaveLength(1);
  });

  it("never gaps for irregular or unset cadence", () => {
    const facts = [fact(1, { instantDate: "2020-01-01" }), fact(2, { instantDate: "2025-01-01" })];
    for (const statementCadence of ["irregular", null]) {
      const s = balanceSeries(account({ statementCadence }), facts, concepts);
      expect(s.gaps).toEqual([]);
      expect(s.segments).toHaveLength(1);
    }
  });

  it("includes generic balance concepts and excludes other concepts", () => {
    const s = balanceSeries(
      account(),
      [
        fact(1, { conceptId: "il.pension.accrued_savings" }),
        fact(2, { conceptId: "interest.earned", instantDate: "2025-02-28" }),
        fact(3, { conceptId: "interest.earned", instantDate: null }),
      ],
      concepts,
    );
    expect(s.points.map((p) => p.facts[0]!.id)).toEqual([1]);
    expect(s.notPlotted).toEqual([]);
  });

  it("lists other-currency and amountless facts as not plotted, sorted", () => {
    const s = balanceSeries(
      account(),
      [
        fact(1),
        fact(4, { instantDate: "2025-02-28", currency: "EUR" }),
        fact(3, { instantDate: "2025-02-28", valueMinor: null }),
        fact(2, { instantDate: "2025-01-15", currency: "ILS" }),
      ],
      concepts,
    );
    expect(s.points).toHaveLength(1);
    expect(s.notPlotted.map((f) => f.id)).toEqual([2, 3, 4]);
  });

  it("ignores rejected, superseded and other accounts entirely", () => {
    const s = balanceSeries(
      account(),
      [
        fact(1, { status: "rejected" }),
        fact(2, { status: "superseded", currency: "EUR" }),
        fact(3, { accountId: 2 }),
        fact(4, { accountId: null }),
      ],
      concepts,
    );
    expect(s.points).toEqual([]);
    expect(s.notPlotted).toEqual([]);
    expect(s.start).toBeNull();
    expect(s.end).toBeNull();
  });

  it("computes start, end and closed", () => {
    const facts = [fact(1, { instantDate: "2025-02-28" }), fact(2, { instantDate: "2025-03-31" })];
    const open = balanceSeries(account(), facts, concepts);
    expect([open.start, open.end, open.closed]).toEqual(["2025-02-28", "2025-03-31", false]);
    const closed = balanceSeries(account({ openedOn: "2025-01-01", closedOn: "2025-06-30" }), facts, concepts);
    expect([closed.start, closed.end, closed.closed, closed.currency]).toEqual(["2025-01-01", "2025-06-30", true, "USD"]);
  });
});
