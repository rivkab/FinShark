import type { DatabaseSync } from "node:sqlite";

// Plain-SQL helpers. The clock is injected so tests are reproducible.
export type Clock = () => Date;
export type Language = "en" | "he";

export function defaultLanguageForCountry(country: string): Language {
  return country.toUpperCase() === "IL" ? "he" : "en";
}

const iso = (clock: Clock): string => clock().toISOString();

export function insertPerson(db: DatabaseSync, clock: Clock, p: { displayName: string }): number {
  const r = db
    .prepare("INSERT INTO people (display_name, created_at) VALUES (?, ?)")
    .run(p.displayName, iso(clock));
  return Number(r.lastInsertRowid);
}

export interface NewAccountIdentifier {
  accountId: number;
  kind: string;
  value: string;
  validFrom?: string;
  validTo?: string;
}

export function insertAccountIdentifier(db: DatabaseSync, i: NewAccountIdentifier): number {
  const r = db
    .prepare("INSERT INTO account_identifiers (account_id, kind, value, valid_from, valid_to) VALUES (?, ?, ?, ?, ?)")
    .run(i.accountId, i.kind, i.value, i.validFrom ?? null, i.validTo ?? null);
  return Number(r.lastInsertRowid);
}

export interface NewInstitution {
  name: string;
  country: string;
  altName?: string;
  language?: Language; // default from country
}

export function insertInstitution(db: DatabaseSync, clock: Clock, i: NewInstitution): number {
  const country = i.country.toUpperCase();
  const r = db
    .prepare("INSERT INTO institutions (name, alt_name, country, language, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(i.name, i.altName ?? null, country, i.language ?? defaultLanguageForCountry(country), iso(clock));
  return Number(r.lastInsertRowid);
}

export interface NewAccount {
  institutionId: number;
  displayName: string;
  nativeCurrency: string;
  altName?: string;
  country?: string; // default: institution's
  language?: Language; // default: institution's
  openedOn?: string;
  closedOn?: string;
  statementCadence?: "monthly" | "quarterly" | "semiannual" | "annual" | "irregular";
}

export function insertAccount(db: DatabaseSync, clock: Clock, a: NewAccount): number {
  const inst = db.prepare("SELECT country, language FROM institutions WHERE id = ?").get(a.institutionId) as
    | { country: string; language: Language }
    | undefined;
  if (!inst) throw new Error(`Unknown institution ${a.institutionId}`);
  const r = db
    .prepare(
      `INSERT INTO accounts (institution_id, display_name, alt_name, country, language, native_currency,
                             opened_on, closed_on, statement_cadence, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      a.institutionId,
      a.displayName,
      a.altName ?? null,
      (a.country ?? inst.country).toUpperCase(),
      a.language ?? inst.language,
      a.nativeCurrency,
      a.openedOn ?? null,
      a.closedOn ?? null,
      a.statementCadence ?? null,
      iso(clock),
    );
  return Number(r.lastInsertRowid);
}
