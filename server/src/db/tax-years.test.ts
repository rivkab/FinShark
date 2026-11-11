import { describe, expect, it } from "vitest";
import { openDb } from "./connection.ts";
import { migrate } from "./migrate.ts";
import { insertAccount, insertInstitution, insertPerson } from "./repo.ts";
import { getTaxYear, setTaxYear, setUs8938Term, us8938TermFor, us8938TermsForYear } from "./tax-years.ts";

const clock = () => new Date("2026-01-02T03:04:05.000Z");

function setup() {
  const db = openDb(":memory:");
  migrate(db);
  const person = insertPerson(db, clock, { displayName: "P" });
  void person;
  const inst = insertInstitution(db, clock, { name: "Bank", country: "IL" });
  const mk = (name: string) => insertAccount(db, clock, { institutionId: inst, displayName: name, nativeCurrency: "ILS" });
  return { db, a: mk("A"), b: mk("B") };
}

const rows = (db: ReturnType<typeof setup>["db"], id: number) =>
  db.prepare("SELECT term_id, valid_from, valid_to, reason FROM account_terms WHERE account_id = ? ORDER BY valid_from").all(id);
const term = (db: ReturnType<typeof setup>["db"], id: number, y: number) => us8938TermFor(db, id, y)?.termId ?? null;
const FA = "us_8938/financial_account" as const;
const PP = "us_8938/pension_plan" as const;
const NR = "us_8938/not_reportable" as const;

describe("migration 009", () => {
  it("adds tax_years, the us_8938 terms and account_terms.reason", () => {
    const { db } = setup();
    const t = db.prepare("SELECT id FROM terms WHERE taxonomy_id = 'us_8938' ORDER BY id").all().map((r) => r["id"]);
    expect(t).toEqual(["us_8938/ask_preparer", "us_8938/financial_account", "us_8938/not_reportable", "us_8938/pension_plan"]);
    expect(db.prepare("SELECT label_en FROM taxonomies WHERE id = 'us_8938'").get()).toEqual({ label_en: "Form 8938" });
    expect(() => db.prepare("SELECT reason FROM account_terms").all()).not.toThrow();
    expect(() => db.prepare("INSERT INTO tax_years (year, abroad_8938, updated_at) VALUES (2024, 2, 'x')").run()).toThrow();
  });
});

describe("tax years", () => {
  it("returns null for a missing year and upserts", () => {
    const { db } = setup();
    expect(getTaxYear(db, 2025)).toBeNull();
    setTaxYear(db, clock(), 2025, { filingStatus: "married_joint", abroad8938: false });
    expect(getTaxYear(db, 2025)).toEqual({ year: 2025, filingStatus: "married_joint", abroad8938: false, updatedAt: "2026-01-02T03:04:05.000Z" });
    setTaxYear(db, clock(), 2025, { filingStatus: null, abroad8938: true });
    expect(getTaxYear(db, 2025)).toMatchObject({ filingStatus: null, abroad8938: true });
    setTaxYear(db, clock(), 2025, { filingStatus: "single", abroad8938: null });
    expect(getTaxYear(db, 2025)).toMatchObject({ filingStatus: "single", abroad8938: null });
  });
});

describe("us_8938 classification validity", () => {
  it("is null with no rows", () => {
    const { db, a } = setup();
    expect(us8938TermFor(db, a, 2025)).toBeNull();
    expect(us8938TermsForYear(db, 2025).size).toBe(0);
  });

  it("set 2024, then 2026, then 2025", () => {
    const { db, a } = setup();
    setUs8938Term(db, a, 2024, FA, null);
    expect([2023, 2024, 2030].map((y) => term(db, a, y))).toEqual([null, FA, FA]);
    setUs8938Term(db, a, 2026, PP, null);
    expect(rows(db, a)).toEqual([
      { term_id: FA, valid_from: "2024-01-01", valid_to: "2025-12-31", reason: null },
      { term_id: PP, valid_from: "2026-01-01", valid_to: null, reason: null },
    ]);
    expect([2024, 2025, 2026, 2027].map((y) => term(db, a, y))).toEqual([FA, FA, PP, PP]);
    // 2025 onward supersedes the 2026 row and trims the 2024 one.
    setUs8938Term(db, a, 2025, NR, "closed");
    expect(rows(db, a)).toEqual([
      { term_id: FA, valid_from: "2024-01-01", valid_to: "2024-12-31", reason: null },
      { term_id: NR, valid_from: "2025-01-01", valid_to: null, reason: "closed" },
    ]);
    expect([2024, 2025, 2026].map((y) => term(db, a, y))).toEqual([FA, NR, NR]);
    expect(us8938TermFor(db, a, 2026)).toEqual({ termId: NR, reason: "closed", validFrom: "2025-01-01", validTo: null });
  });

  it("clears for a year onward and keeps earlier years", () => {
    const { db, a } = setup();
    setUs8938Term(db, a, 2023, FA, null);
    setUs8938Term(db, a, 2025, null, null);
    expect([2023, 2024, 2025, 2026].map((y) => term(db, a, y))).toEqual([FA, FA, null, null]);
    setUs8938Term(db, a, 2023, null, null); // clears everything
    expect(rows(db, a)).toEqual([]);
  });

  it("setting the same year twice replaces, not duplicates", () => {
    const { db, a } = setup();
    setUs8938Term(db, a, 2024, FA, null);
    setUs8938Term(db, a, 2024, PP, null);
    expect(rows(db, a)).toEqual([{ term_id: PP, valid_from: "2024-01-01", valid_to: null, reason: null }]);
  });

  it("trims an unbounded row and leaves other taxonomies and accounts alone", () => {
    const { db, a, b } = setup();
    db.prepare("INSERT INTO account_terms (account_id, term_id) VALUES (?, 'us_8938/ask_preparer')").run(a);
    db.prepare("INSERT INTO account_terms (account_id, term_id) VALUES (?, 'asset_class/cash')").run(a);
    setUs8938Term(db, b, 2024, FA, null);
    setUs8938Term(db, a, 2025, FA, null);
    expect(term(db, a, 2024)).toBe("us_8938/ask_preparer");
    expect(term(db, a, 2025)).toBe(FA);
    expect(db.prepare("SELECT valid_to FROM account_terms WHERE account_id = ? AND term_id = 'asset_class/cash'").get(a)).toEqual({ valid_to: null });
    const m = us8938TermsForYear(db, 2025);
    expect([...m.keys()].sort()).toEqual([a, b].sort());
    expect(m.get(b)!.termId).toBe(FA);
  });
});
