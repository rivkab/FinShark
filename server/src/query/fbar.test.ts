import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { insertAccount, insertInstitution, insertPerson } from "../db/repo.ts";
import { importTreasuryRates } from "../currency/index.ts";
import { proposeManualFact, verifyFact } from "../facts/index.ts";
import { sampleStatementPdf } from "../testing/pdf-fixture.ts";
import { makeRealVault, type RealTestVault } from "../testing/test-vault.ts";
import { fbarReport, FBAR_THRESHOLD_USD_MINOR, loadFbarInput, toUsdMinor, type FbarAccount, type FbarInput } from "./fbar.ts";
import { balanceFact } from "./test-helpers.ts";

const il = (id: number, over: Partial<FbarAccount> = {}): FbarAccount => ({
  id,
  displayName: `IL account ${id}`,
  country: "IL",
  nativeCurrency: "ILS",
  openedOn: null,
  closedOn: null,
  statementCadence: "annual",
  ...over,
});
const RATE = { id: 7, rate: "3.191", rateDate: "2025-12-31" };

function report(over: Partial<FbarInput>) {
  return fbarReport({ year: 2025, accounts: [], facts: [], concepts: [], rateFor: (c) => (c === "ILS" ? RATE : null), ...over });
}
const year = (accountId: number, minor: bigint) => balanceFact("2025-12-31", minor, { accountId });

describe("toUsdMinor", () => {
  it("divides by the rate and rounds half up to the cent", () => {
    expect(toUsdMinor(4_500_000n, "ILS", "3.191")).toBe(1_410_216n); // 1,410,216.234...
    expect(toUsdMinor(3n, "ILS", "2")).toBe(2n); // 1.5 -> 2
    expect(toUsdMinor(5n, "ILS", "2")).toBe(3n); // 2.5 -> 3
  });
  it("stays exact beyond Number's range", () => {
    expect(toUsdMinor(9_007_199_254_740_993n, "ILS", "1")).toBe(9_007_199_254_740_993n);
  });
});

describe("fbarReport", () => {
  it("converts each account's maximum at the year-end rate and sums them", () => {
    const r = report({ accounts: [il(1), il(2)], facts: [year(1, 4_500_000n), year(2, 3_191_000n)] });
    expect(r.rows.map((x) => x.usdMinor)).toEqual([1_410_216n, 1_000_000n]);
    expect(r.rows[0]!.conversion).toEqual({ kind: "rate", rate: "3.191", rateDate: "2025-12-31", rateId: 7, rounding: "half_up_to_cent" });
    expect(r.knownAggregateUsdMinor).toBe(2_410_216n);
    expect(r.verdict).toBe("REQUIRED");
    expect(r.status).toBe("COMPLETE");
  });

  it("separates the two readings: peaks on different dates exceed the sum test but not the single-date test", () => {
    // ILS 20,000 is about $6,267 at 3.191. Account 1 peaks in March, account 2 in October.
    const facts = [
      balanceFact("2025-03-31", 2_000_000n, { accountId: 1 }),
      balanceFact("2025-10-31", 2_000_000n, { accountId: 2 }),
      balanceFact("2025-03-31", 0n, { accountId: 2 }),
      balanceFact("2025-10-31", 0n, { accountId: 1 }),
    ];
    const monthly = [il(1, { statementCadence: "annual" }), il(2, { statementCadence: "annual" })];
    const r = report({ accounts: monthly, facts: [...facts, balanceFact("2025-12-31", 0n, { accountId: 1 }), balanceFact("2025-12-31", 0n, { accountId: 2 })] });
    expect(r.tests.sumOfMaxima).toBe("EXCEEDED");
    expect(r.tests.singleDate.verdict).toBe("NOT_EXCEEDED");
    expect(r.tests.singleDate.dates.map((d) => [d.date, d.usdMinor])).toEqual([
      ["2025-03-31", 626_763n],
      ["2025-10-31", 626_763n],
      ["2025-12-31", 0n],
    ]);
    expect(r.verdict).toBe("DEPENDS_ON_RULE");
  });

  it("is REQUIRED under both readings when the accounts together exceed it on one date, and says when", () => {
    const r = report({ accounts: [il(1), il(2)], facts: [year(1, 2_000_000n), year(2, 2_000_000n)] });
    expect(r.tests.singleDate).toMatchObject({ verdict: "EXCEEDED", exceededOn: "2025-12-31" });
    expect(r.verdict).toBe("REQUIRED");
  });

  it("does not claim the single-date test is clear when accounts have balances on different dates", () => {
    // Account 2 has no balance on 2025-06-30, so the combined balance that day is unknown.
    const r = report({
      accounts: [il(1, { statementCadence: "irregular" }), il(2, { statementCadence: "irregular" })],
      facts: [balanceFact("2025-06-30", 1_000_000n, { accountId: 1 }), balanceFact("2025-12-31", 1_000_000n, { accountId: 1 }), year(2, 1_000_000n)],
    });
    expect(r.tests.singleDate.dates[0]).toEqual({ date: "2025-06-30", usdMinor: 313_381n, missingAccountIds: [2] });
    expect(r.tests.singleDate.verdict).toBe("UNDETERMINED");
  });

  it("requires the aggregate to exceed $10,000, not just reach it", () => {
    const at = report({ accounts: [il(1)], facts: [year(1, 3_191_000n)] });
    expect(at.knownAggregateUsdMinor).toBe(FBAR_THRESHOLD_USD_MINOR);
    expect(at.verdict).toBe("NOT_REQUIRED");
    const over = report({ accounts: [il(1)], facts: [year(1, 3_191_032n)] });
    expect(over.verdict).toBe("REQUIRED");
  });

  it("counts several small accounts together", () => {
    const r = report({ accounts: [il(1), il(2)], facts: [year(1, 2_000_000n), year(2, 2_000_000n)] });
    expect(r.rows.every((x) => x.usdMinor! < FBAR_THRESHOLD_USD_MINOR)).toBe(true);
    expect(r.verdict).toBe("REQUIRED");
  });

  it("does not say NOT_REQUIRED while data is missing", () => {
    const r = report({ accounts: [il(1), il(2)], facts: [year(1, 100_00n)] });
    expect(r.rows[1]!.measure.max).toBeNull();
    expect(r.status).toBe("INCOMPLETE");
    expect(r.verdict).toBe("UNDETERMINED");
  });

  it("still says REQUIRED when a lower bound already exceeds the threshold, but stays INCOMPLETE", () => {
    const r = report({ accounts: [il(1), il(2)], facts: [year(1, 9_000_000n)] });
    expect(r.verdict).toBe("REQUIRED");
    expect(r.status).toBe("INCOMPLETE");
  });

  it("reports a missing year-end rate instead of guessing one", () => {
    const r = report({ accounts: [il(1)], facts: [year(1, 9_000_000n)], rateFor: () => null });
    expect(r.rows[0]).toMatchObject({ usdMinor: null, conversion: { kind: "missing_rate", currency: "ILS" } });
    expect(r.knownAggregateUsdMinor).toBe(0n);
    expect(r.verdict).toBe("UNDETERMINED");
    expect(r.status).toBe("INCOMPLETE");
  });

  it("does not convert a USD account held abroad, and ignores US accounts", () => {
    const abroad = il(1, { nativeCurrency: "USD" });
    const domestic = il(2, { country: "US" });
    const r = report({
      accounts: [abroad, domestic],
      facts: [balanceFact("2025-12-31", 2_000_000n, { accountId: 1, currency: "USD" }), year(2, 9_999_999_999n)],
      rateFor: () => null,
    });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ usdMinor: 2_000_000n, conversion: { kind: "none" } });
    expect(r.verdict).toBe("REQUIRED");
    expect(r.status).toBe("COMPLETE");
  });

  it("lists foreign accounts that were not open during the year", () => {
    const r = report({ accounts: [il(1, { openedOn: "2026-02-01" }), il(2, { closedOn: "2024-12-31" }), il(3)], facts: [year(3, 100n)] });
    expect(r.notInScope).toEqual([
      { accountId: 1, displayName: "IL account 1", reason: "opened_after_year" },
      { accountId: 2, displayName: "IL account 2", reason: "closed_before_year" },
    ]);
    expect(r.rows.map((x) => x.accountId)).toEqual([3]);
  });

  it("reports a conflict and does not decide for the user", () => {
    const r = report({ accounts: [il(1)], facts: [year(1, 100n), year(1, 200n)] });
    expect(r.status).toBe("CONFLICT");
    expect(r.verdict).toBe("UNDETERMINED");
  });

  it("says so when there are no foreign accounts at all", () => {
    expect(report({ accounts: [il(1, { country: "US" })] }).verdict).toBe("NO_FOREIGN_ACCOUNTS");
    expect(report({}).verdict).toBe("NO_FOREIGN_ACCOUNTS");
  });
});

describe("loadFbarInput (real vault)", () => {
  let v: RealTestVault;
  beforeEach(async () => {
    v = await makeRealVault();
  });
  afterEach(async () => {
    await v.cleanup();
  });

  it("builds a report from verified facts and the stored Treasury rate", async () => {
    const db = v.vault.db;
    const actor = insertPerson(db, v.now, { displayName: "Dana" });
    const inst = insertInstitution(db, v.now, { name: "Bank Example", country: "IL" });
    const account = insertAccount(db, v.now, { institutionId: inst, displayName: "Savings", nativeCurrency: "ILS", statementCadence: "annual" });
    const documentId = (await v.importPdf(sampleStatementPdf())).documentId;
    const deps = { db, layout: v.vault.layout, now: v.now };
    const view = await proposeManualFact(deps, actor, {
      documentId,
      pageNo: 1,
      bbox: [395, 595, 480, 615],
      conceptId: "balance.ending",
      accountId: account,
      value: "₪45,000.00",
      currency: "ILS",
      instantDate: "2025-12-31",
    });
    verifyFact(deps, actor, view.fact.id);
    importTreasuryRates(
      { db, now: v.now },
      "Record Date,Country - Currency Description,Exchange Rate,Effective Date\n2025-12-31,Israel-Shekel,3.191,2025-12-31",
    );

    const r = fbarReport(loadFbarInput(db, 2025));
    expect(r.status).toBe("COMPLETE");
    expect(r.rows[0]).toMatchObject({ accountId: account, usdMinor: 1_410_216n });
    expect(r.rows[0]!.measure.max).toMatchObject({ minor: 4_500_000n, date: "2025-12-31", factIds: [view.fact.id] });
    expect(r.verdict).toBe("REQUIRED");

    // 2024: the account is in scope but has no balance (and no 2024 rate is stored). Nothing is guessed.
    const earlier = fbarReport(loadFbarInput(db, 2024));
    expect(earlier.rows[0]!.measure).toMatchObject({ max: null, missing: ["2024-12-31"] });
    expect(earlier.verdict).toBe("UNDETERMINED");
    expect(earlier.status).toBe("INCOMPLETE");
  });
});
