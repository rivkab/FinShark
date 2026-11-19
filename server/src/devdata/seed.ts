// A development vault full of generated data (DESIGN D22): a fake two-person household
// with US and Israeli accounts, fake PDFs imported through the real pipeline, and numbers
// recorded from them with real provenance. It covers the cases the UI has to show:
// verified numbers, an unverified one, a conflict, a closed account, a pension, person-level
// tax forms, a converted value and a missing exchange rate.
//
// Deterministic: the clock and vault id are inputs, and every amount is computed from fixed
// numbers (integer minor units, no floats), so the same inputs give the same vault.

import fs from "node:fs/promises";
import path from "node:path";
import type { PdfRect } from "@finshark/shared";
import { insertAccount, insertInstitution, insertPerson, setAccountNumber, setAccountOwners, type NewAccount } from "../db/repo.ts";
import { setTaxYear, setUs8938Term } from "../db/tax-years.ts";
import { TREASURY_SOURCE } from "../currency/rates.ts";
import { importDocument, type ImportOptions } from "../documents/import.ts";
import { createAttestation, proposeManualFact, verifyFact } from "../facts/mutations.ts";
import type { FactFields } from "../facts/types.ts";
import { makePdf, type FixtureText } from "../testing/pdf-fixture.ts";
import { createVault, openVault, type Vault } from "../vault/vault.ts";

export const DEV_VAULT_ID = "de000000-0000-4000-8000-000000000001";
/** The seed's clock: every row is stamped with this time. */
export const DEV_SEED_NOW = new Date("2026-03-15T10:00:00Z");

export interface SeedOptions {
  now: Date;
  vaultId: string;
  /** Scratch directory for the generated PDFs before import (removed by the caller). */
  workDir: string;
}

export interface SeedSummary {
  people: number;
  institutions: number;
  accounts: number;
  documents: number;
  facts: { verified: number; proposed: number };
}

// ---------------------------------------------------------------- money formatting

/** 1234567n -> "12,345.67" (minor units with two decimals). */
export function formatMinor(minor: bigint): string {
  const neg = minor < 0n;
  const abs = neg ? -minor : minor;
  const units = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const cents = (abs % 100n).toString().padStart(2, "0");
  return `${neg ? "-" : ""}${units}.${cents}`;
}

const pad2 = (n: number) => String(n).padStart(2, "0");
const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const monthEnd = (year: number, month: number) => `${year}-${pad2(month)}-${pad2(lastDay(year, month))}`;
const usDate = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;

// ---------------------------------------------------------------- documents

interface Line {
  label: string;
  value: string;
}

interface GeneratedDoc {
  bytes: Uint8Array;
  /** The box around line i's value, for a fact's source. */
  box(i: number): PdfRect;
}

const VALUE_X = 400;
const firstLineY = 600;
const lineY = (i: number) => firstLineY - 22 * i;

/** A one-page fake document: a title, header lines, then label/value rows. */
function generatedDoc(title: string, header: string[], lines: Line[]): GeneratedDoc {
  const texts: FixtureText[] = [
    { text: title, x: 72, y: 720, size: 16 },
    { text: "GENERATED TEST DATA - NOT A REAL DOCUMENT", x: 72, y: 740, size: 8 },
    ...header.map((text, i) => ({ text, x: 72, y: 690 - 18 * i })),
  ];
  lines.forEach((l, i) => {
    texts.push({ text: l.label, x: 72, y: lineY(i) }, { text: l.value, x: VALUE_X, y: lineY(i) });
  });
  return { bytes: makePdf([{ texts }]), box: (i) => [VALUE_X - 5, lineY(i) - 4, 540, lineY(i) + 12] };
}

// ---------------------------------------------------------------- the seeder

class Seeder {
  readonly vault: Vault;
  readonly opts: SeedOptions;
  readonly now: () => Date;
  actor = 0;
  private fileNo = 0;
  readonly summary: SeedSummary = { people: 0, institutions: 0, accounts: 0, documents: 0, facts: { verified: 0, proposed: 0 } };

  constructor(vault: Vault, opts: SeedOptions) {
    this.vault = vault;
    this.opts = opts;
    this.now = () => opts.now;
  }

  get db() {
    return this.vault.db;
  }

  person(displayName: string, o: { usesApp?: boolean } = {}): number {
    this.summary.people++;
    return insertPerson(this.db, this.now, { displayName, ownsAccounts: true, usesApp: o.usesApp ?? true });
  }

  institution(name: string, country: string, o: { altName?: string; kind?: "financial" | "employer" } = {}): number {
    this.summary.institutions++;
    return insertInstitution(this.db, this.now, { name, country, kind: o.kind ?? "financial", ...(o.altName ? { altName: o.altName } : {}) });
  }

  account(a: NewAccount, number: string, owners: number[]): number {
    this.summary.accounts++;
    const id = insertAccount(this.db, this.now, a);
    setAccountNumber(this.db, this.now, id, number);
    setAccountOwners(
      this.db,
      this.now,
      id,
      owners.map((personId) => ({ personId, role: owners.length > 1 ? "joint" : "owner", share: null })),
    );
    return id;
  }

  async importDoc(doc: GeneratedDoc, name: string, opts: ImportOptions): Promise<number> {
    const file = path.join(this.opts.workDir, `${String(++this.fileNo).padStart(3, "0")}-${name}.pdf`);
    await fs.writeFile(file, doc.bytes);
    const r = await importDocument({ db: this.db, layout: this.vault.layout, now: this.now }, file, opts);
    if (r.status !== "imported") throw new Error(`Generated document ${name} was a duplicate`);
    this.summary.documents++;
    return r.documentId;
  }

  /** Record line `line` of a document as a fact; verified unless `verify` is false. */
  async fact(documentId: number, doc: GeneratedDoc, line: number, f: FactFields, o: { verify?: boolean } = {}): Promise<number> {
    const deps = { db: this.db, layout: this.vault.layout, now: this.now };
    const view = await proposeManualFact(deps, this.actor, { ...f, documentId, pageNo: 1, bbox: doc.box(line) });
    if (o.verify === false) {
      this.summary.facts.proposed++;
      return view.fact.id;
    }
    const r = verifyFact(deps, this.actor, view.fact.id);
    if (!r.ok) throw new Error(`Seed fact ${view.fact.id} (${f.conceptId}) conflicts with a verified fact`);
    this.summary.facts.verified++;
    return view.fact.id;
  }
}

export async function seedDevVault(root: string, opts: SeedOptions): Promise<SeedSummary> {
  createVault(root, { now: opts.now, vaultId: opts.vaultId, dev: true });
  const vault = openVault(root);
  try {
    const s = new Seeder(vault, opts);
    await seedHousehold(s);
    return s.summary;
  } finally {
    vault.close();
  }
}

async function seedHousehold(s: Seeder): Promise<void> {
  const db = s.db;
  const dana = s.person("Dana Example");
  const avi = s.person("Avi Example");
  s.actor = dana;

  const usBank = s.institution("Example National Bank", "US");
  const broker = s.institution("Example Brokerage", "US");
  const ilBank = s.institution("Example Israel Bank", "IL", { altName: "בנק לדוגמה" });
  const pensionFund = s.institution("Example Pension Fund", "IL", { altName: "קרן פנסיה לדוגמה" });
  const employer = s.institution("Example Employer Inc", "US", { kind: "employer" });

  const usChecking = s.account(
    { institutionId: usBank, displayName: "Checking ...1001", nativeCurrency: "USD", accountType: "checking", statementCadence: "monthly", openedOn: "2019-04-02" },
    "000011001",
    [dana, avi],
  );
  const brokerage = s.account(
    { institutionId: broker, displayName: "Brokerage ...4821", nativeCurrency: "USD", accountType: "investment", statementCadence: "annual", openedOn: "2020-01-15" },
    "BRK-4821",
    [dana],
  );
  const ilCurrent = s.account(
    { institutionId: ilBank, displayName: "Current account ...7702", altName: "חשבון עו\"ש", nativeCurrency: "ILS", accountType: "checking", statementCadence: "monthly", openedOn: "2021-08-01" },
    "12-345-7702",
    [dana, avi],
  );
  const ilDeposit = s.account(
    { institutionId: ilBank, displayName: "Deposit ...3310", altName: "פיקדון", nativeCurrency: "ILS", accountType: "deposit", statementCadence: "quarterly", openedOn: "2024-11-10" },
    "12-345-3310",
    [avi],
  );
  const ilSavings = s.account(
    { institutionId: ilBank, displayName: "Savings ...9040", altName: "חיסכון", nativeCurrency: "ILS", accountType: "savings", statementCadence: "quarterly", openedOn: "2022-02-01", closedOn: "2025-05-31" },
    "12-345-9040",
    [dana],
  );
  const pension = s.account(
    { institutionId: pensionFund, displayName: "Pension ...5150", altName: "קרן פנסיה", nativeCurrency: "ILS", accountType: "pension", statementCadence: "semiannual", openedOn: "2021-09-01" },
    "PF-5150",
    [avi],
  );

  // Form 8938 settings for 2025. The deposit is left unclassified on purpose.
  setTaxYear(db, s.opts.now, 2025, { filingStatus: "married_joint", abroad8938: true });
  setUs8938Term(db, ilCurrent, 2025, "us_8938/financial_account", null);
  setUs8938Term(db, ilSavings, 2025, "us_8938/financial_account", null);
  setUs8938Term(db, pension, 2025, "us_8938/pension_plan", null);

  // A fake Treasury rate for 2025-12-31. 2024 has none, so 2024 reports show a missing rate.
  db.prepare(
    "INSERT INTO exchange_rates (source_id, base, quote, rate, rate_date, note, imported_at) VALUES (?, 'USD', 'ILS', '3.65', '2025-12-31', ?, ?)",
  ).run(TREASURY_SOURCE, "Generated test rate, not the real Treasury rate", s.opts.now.toISOString());

  // ---- US checking: monthly statements for 2025, every second one recorded.
  for (let m = 2; m <= 12; m += 2) {
    const end = monthEnd(2025, m);
    const balance = 1_250_000n + BigInt(m) * 43_517n - (m % 4 === 0 ? 120_000n : 0n);
    const doc = generatedDoc("Example National Bank - Monthly Statement", ["Checking account ending 1001", `Statement period: ${usDate(`2025-${pad2(m)}-01`)} - ${usDate(end)}`], [
      { label: "Ending balance", value: `$${formatMinor(balance)}` },
    ]);
    const id = await s.importDoc(doc, `us-checking-2025-${pad2(m)}`, { institutionId: usBank, docType: "doc_type/statement", language: "en", periodStart: `2025-${pad2(m)}-01`, periodEnd: end });
    await s.fact(id, doc, 0, { conceptId: "balance.ending", accountId: usChecking, value: formatMinor(balance), currency: "USD", instantDate: end });
  }

  // ---- Brokerage: annual statement and 1099-INT for 2025.
  {
    const doc = generatedDoc("Example Brokerage - Annual Statement", ["Account ending 4821", "Statement period: 01/01/2025 - 12/31/2025"], [
      { label: "Ending balance", value: "$83,421.17" },
      { label: "Interest paid", value: "$1,204.33" },
    ]);
    const id = await s.importDoc(doc, "brokerage-2025-annual", { institutionId: broker, docType: "doc_type/annual_statement", language: "en", periodStart: "2025-01-01", periodEnd: "2025-12-31" });
    await s.fact(id, doc, 0, { conceptId: "balance.ending", accountId: brokerage, value: "83,421.17", currency: "USD", instantDate: "2025-12-31" });
    await s.fact(id, doc, 1, { conceptId: "statement.interest_paid", accountId: brokerage, value: "1,204.33", currency: "USD", periodStart: "2025-01-01", periodEnd: "2025-12-31" });
  }
  {
    const doc = generatedDoc("Form 1099-INT 2025 - Example Brokerage", ["Recipient: Dana Example", "Account BRK-4821"], [{ label: "Box 1 Interest income", value: "1,204.33" }]);
    const id = await s.importDoc(doc, "brokerage-2025-1099int", { institutionId: broker, docType: "doc_type/tax_form", language: "en", taxYear: 2025 });
    await s.fact(id, doc, 0, { conceptId: "us.1099int.box1", accountId: brokerage, personId: dana, value: "1,204.33", currency: "USD", periodStart: "2025-01-01", periodEnd: "2025-12-31", taxYear: 2025 });
  }

  // ---- W-2 from the employer: person-level numbers, no account.
  {
    const doc = generatedDoc("Form W-2 2025 - Example Employer Inc", ["Employee: Dana Example"], [
      { label: "Box 1 Wages, tips, other compensation", value: "96,500.00" },
      { label: "Box 2 Federal income tax withheld", value: "14,210.55" },
    ]);
    const id = await s.importDoc(doc, "w2-2025", { institutionId: employer, docType: "doc_type/tax_form", language: "en", taxYear: 2025 });
    const period = { periodStart: "2025-01-01", periodEnd: "2025-12-31", taxYear: 2025 };
    await s.fact(id, doc, 0, { conceptId: "us.w2.box1_wages", personId: dana, value: "96,500.00", currency: "USD", ...period });
    await s.fact(id, doc, 1, { conceptId: "us.w2.box2_fed_withheld", personId: dana, value: "14,210.55", currency: "USD", ...period });
  }

  // ---- Israeli current account: December 2024 and every month of 2025. August is left
  // unverified. Interest is credited quarterly.
  const ilMonths: [number, number][] = [[2024, 12], ...Array.from({ length: 12 }, (_, i) => [2025, i + 1] as [number, number])];
  for (const [y, m] of ilMonths) {
    const end = monthEnd(y, m);
    const k = BigInt((y - 2024) * 12 + m);
    const balance = 4_200_000n + k * 137_513n - (k % 3n === 0n ? 650_000n : 0n) + (k === 18n ? 2_400_000n : 0n);
    const interest = m % 3 === 0 ? 4_000n + k * 61n : null;
    const lines: Line[] = [{ label: "Closing balance (ILS)", value: formatMinor(balance) }];
    if (interest !== null) lines.push({ label: "Interest credited (ILS)", value: formatMinor(interest) });
    const doc = generatedDoc("Example Israel Bank - Monthly Statement", ["Account 12-345-7702", `Period: ${y}-${pad2(m)}-01 to ${end}`], lines);
    const id = await s.importDoc(doc, `il-current-${y}-${pad2(m)}`, { institutionId: ilBank, docType: "doc_type/statement", language: "en", periodStart: `${y}-${pad2(m)}-01`, periodEnd: end });
    const verify = !(y === 2025 && m === 8);
    await s.fact(id, doc, 0, { conceptId: "balance.ending", accountId: ilCurrent, value: formatMinor(balance), currency: "ILS", instantDate: end }, { verify });
    if (interest !== null) {
      const start = `${y}-${pad2(m - 2)}-01`;
      await s.fact(id, doc, 1, { conceptId: "statement.interest_paid", accountId: ilCurrent, value: formatMinor(interest), currency: "ILS", periodStart: start, periodEnd: end });
    }
  }

  // ---- Israeli deposit: quarterly statements. Q3 was reissued with a different balance,
  // which is recorded but conflicts with the verified one.
  const quarters: [string, bigint][] = [["2025-03-31", 15_000_000n], ["2025-06-30", 15_118_220n], ["2025-09-30", 15_236_910n], ["2025-12-31", 15_355_480n]];
  for (const [i, [end, balance]] of quarters.entries()) {
    const doc = generatedDoc("Example Israel Bank - Deposit Statement", ["Deposit 12-345-3310", `Quarter ${i + 1} 2025, as of ${end}`], [{ label: "Deposit value (ILS)", value: formatMinor(balance) }]);
    const id = await s.importDoc(doc, `il-deposit-2025-q${i + 1}`, { institutionId: ilBank, docType: "doc_type/statement", language: "en", periodEnd: end });
    await s.fact(id, doc, 0, { conceptId: "balance.ending", accountId: ilDeposit, value: formatMinor(balance), currency: "ILS", instantDate: end });
  }
  {
    const doc = generatedDoc("Example Israel Bank - Deposit Statement (corrected)", ["Deposit 12-345-3310", "Quarter 3 2025, as of 2025-09-30"], [{ label: "Deposit value (ILS)", value: formatMinor(15_263_910n) }]);
    const id = await s.importDoc(doc, "il-deposit-2025-q3-corrected", { institutionId: ilBank, docType: "doc_type/statement", language: "en", periodEnd: "2025-09-30" });
    await s.fact(id, doc, 0, { conceptId: "balance.ending", accountId: ilDeposit, value: formatMinor(15_263_910n), currency: "ILS", instantDate: "2025-09-30" }, { verify: false });
  }

  // ---- Israeli savings: closed during 2025. One statement, then an attestation of closure.
  {
    const doc = generatedDoc("Example Israel Bank - Savings Statement", ["Savings 12-345-9040", "As of 2025-03-31"], [{ label: "Balance (ILS)", value: formatMinor(2_210_045n) }]);
    const id = await s.importDoc(doc, "il-savings-2025-q1", { institutionId: ilBank, docType: "doc_type/statement", language: "en", periodEnd: "2025-03-31" });
    await s.fact(id, doc, 0, { conceptId: "balance.ending", accountId: ilSavings, value: formatMinor(2_210_045n), currency: "ILS", instantDate: "2025-03-31" });
    const closed = createAttestation({ db, now: s.now }, s.actor, {
      conceptId: "status.account_closed",
      accountId: ilSavings,
      value: "true",
      instantDate: "2025-05-31",
      note: "Generated: the bank's closing letter said the balance was moved to the current account.",
    });
    const r = verifyFact({ db, now: s.now }, s.actor, closed.fact.id);
    if (!r.ok) throw new Error("Seed attestation conflicts");
    s.summary.facts.verified++;
  }

  // ---- Pension: semiannual reports for 2025.
  for (const [end, savings] of [["2025-06-30", 31_455_000n], ["2025-12-31", 33_902_440n]] as const) {
    const doc = generatedDoc("Example Pension Fund - Member Report", ["Member: Avi Example", "Policy PF-5150", `As of ${end}`], [{ label: "Accrued savings (ILS)", value: formatMinor(savings) }]);
    const id = await s.importDoc(doc, `pension-${end}`, { institutionId: pensionFund, docType: "doc_type/pension_report", language: "en", periodEnd: end });
    await s.fact(id, doc, 0, { conceptId: "il.pension.accrued_savings", accountId: pension, value: formatMinor(savings), currency: "ILS", instantDate: end });
  }
}
