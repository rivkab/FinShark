import { describe, expect, it } from "vitest";
import { coverageNote, currencyTotals, newestBalanceDate } from "./accountTotals.ts";

const acct = (id: number, nativeCurrency: string) => ({ id, nativeCurrency });
const bal = (status: string, currency: string, valueMinor: string | null, instantDate = "2026-09-30") =>
  ({ status, currency, valueMinor, instantDate }) as never;

describe("currencyTotals", () => {
  it("sums verified balances per currency without converting", () => {
    const latest = new Map([
      [1, bal("verified", "USD", "100000000000000001")],
      [2, bal("verified", "USD", "2")],
      [3, bal("verified", "ILS", "50000")],
    ]);
    const t = currencyTotals([acct(1, "USD"), acct(2, "USD"), acct(3, "ILS")], latest);
    expect(t.map((x) => x.currency)).toEqual(["USD", "ILS"]); // most accounts first
    expect(t[0]).toMatchObject({ formatted: "$1,000,000,000,000,000.03", verifiedCount: 2, accountCount: 2 });
    expect(t[1]).toMatchObject({ formatted: "₪500.00", verifiedCount: 1, accountCount: 1 });
  });

  it("leaves proposed balances out and says so in the counts", () => {
    const latest = new Map([
      [1, bal("verified", "USD", "1000")],
      [2, bal("proposed", "USD", "999999")],
    ]);
    const [t] = currencyTotals([acct(1, "USD"), acct(2, "USD"), acct(3, "USD")], latest);
    expect(t).toMatchObject({ formatted: "$10.00", verifiedCount: 1, accountCount: 3 });
    expect(coverageNote(t!)).toBe("1 of 3 accounts");
  });

  it("has no total when only proposed values exist", () => {
    const [t] = currencyTotals([acct(1, "USD")], new Map([[1, bal("proposed", "USD", "500")]]));
    expect(t).toMatchObject({ formatted: null, verifiedCount: 0, accountCount: 1 });
    expect(coverageNote(t!)).toBe("0 of 1 accounts");
  });

  it("handles negatives and no balances", () => {
    expect(currencyTotals([], new Map())).toEqual([]);
    const [t] = currencyTotals([acct(1, "USD")], new Map([[1, bal("verified", "USD", "-1250")]]));
    expect(t!.formatted).toBe("-$12.50");
  });
});

describe("coverageNote", () => {
  it("singular and plural", () => {
    expect(coverageNote({ verifiedCount: 1, accountCount: 1 })).toBe("1 account");
    expect(coverageNote({ verifiedCount: 4, accountCount: 4 })).toBe("4 accounts");
  });
});

describe("newestBalanceDate", () => {
  it("picks the newest date or null", () => {
    expect(newestBalanceDate(new Map())).toBeNull();
    expect(newestBalanceDate(new Map([[1, bal("verified", "USD", "1", "2026-09-25")], [2, bal("verified", "USD", "1", "2026-09-30")]]))).toBe("2026-09-30");
  });
});
