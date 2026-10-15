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

export const ACCOUNT_NUMBER_KIND = "account_number";

/** Trim and collapse spaces; account numbers may hold letters (IBAN), digits, spaces, - / . */
export function normalizeAccountNumber(raw: string): string {
  const v = raw.trim().replace(/\s+/g, " ");
  if (v === "" || v.length > 64 || !/^[A-Za-z0-9 ./-]+$/.test(v)) {
    throw new Error("An account number may contain letters, digits, spaces, '-', '/' and '.', up to 64 characters.");
  }
  return v;
}

/**
 * Set an account's current number (or clear it with null). The previous number is
 * kept as history: its valid_to becomes today, and the new one is valid from today.
 * Setting the same number again changes nothing.
 */
export function setAccountNumber(db: DatabaseSync, clock: Clock, accountId: number, value: string | null): void {
  const next = value === null ? null : normalizeAccountNumber(value);
  const current = db
    .prepare(
      "SELECT id, value FROM account_identifiers WHERE account_id = ? AND kind = ? AND valid_to IS NULL ORDER BY id DESC LIMIT 1",
    )
    .get(accountId, ACCOUNT_NUMBER_KIND) as { id: number; value: string } | undefined;
  if ((current?.value ?? null) === next) return;
  const today = iso(clock).slice(0, 10);
  db.exec("BEGIN");
  try {
    if (current) db.prepare("UPDATE account_identifiers SET valid_to = ? WHERE id = ?").run(today, current.id);
    if (next !== null) {
      insertAccountIdentifier(db, {
        accountId,
        kind: ACCOUNT_NUMBER_KIND,
        value: next,
        // The first number recorded is the account's number from the start.
        ...(current ? { validFrom: today } : {}),
      });
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export const OWNER_ROLES = ["owner", "joint", "custodian", "beneficiary", "participant"] as const;
export type OwnerRole = (typeof OWNER_ROLES)[number];

export interface AccountOwnerInput {
  personId: number;
  role: OwnerRole;
  /** Decimal fraction like '0.5', or null when unspecified. */
  share: string | null;
}

const ownerKey = (o: AccountOwnerInput): string => `${o.personId}|${o.role}|${o.share ?? ""}`;

/**
 * Set an account's current owners. Owners no longer listed keep their row with
 * valid_to = today (ownership is time-ranged); new ones are valid from today, or
 * from the start when the account had no owners yet. Listing the same owners again
 * changes nothing.
 */
export function setAccountOwners(db: DatabaseSync, clock: Clock, accountId: number, owners: AccountOwnerInput[]): void {
  const today = iso(clock).slice(0, 10);
  const open = db
    .prepare("SELECT id, person_id, role, share FROM account_owners WHERE account_id = ? AND valid_to IS NULL")
    .all(accountId) as { id: number; person_id: number; role: OwnerRole; share: string | null }[];
  const hadAny = db.prepare("SELECT 1 FROM account_owners WHERE account_id = ? LIMIT 1").get(accountId) !== undefined;
  const wanted = new Map(owners.map((o) => [ownerKey(o), o]));
  const kept = new Set<string>();
  db.exec("BEGIN");
  try {
    for (const row of open) {
      const key = ownerKey({ personId: row.person_id, role: row.role, share: row.share });
      if (wanted.has(key) && !kept.has(key)) kept.add(key);
      else db.prepare("UPDATE account_owners SET valid_to = ? WHERE id = ?").run(today, row.id);
    }
    for (const [key, o] of wanted) {
      if (kept.has(key)) continue;
      db.prepare("INSERT INTO account_owners (account_id, person_id, role, share, valid_from) VALUES (?, ?, ?, ?, ?)").run(
        accountId,
        o.personId,
        o.role,
        o.share,
        hadAny ? today : null,
      );
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
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
  accountType?: string;
}

export function insertAccount(db: DatabaseSync, clock: Clock, a: NewAccount): number {
  const inst = db.prepare("SELECT country, language FROM institutions WHERE id = ?").get(a.institutionId) as
    | { country: string; language: Language }
    | undefined;
  if (!inst) throw new Error(`Unknown institution ${a.institutionId}`);
  const r = db
    .prepare(
      `INSERT INTO accounts (institution_id, display_name, alt_name, country, language, native_currency,
                             opened_on, closed_on, statement_cadence, account_type, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      a.accountType ?? null,
      iso(clock),
    );
  return Number(r.lastInsertRowid);
}
