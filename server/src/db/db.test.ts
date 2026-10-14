import { describe, expect, it } from "vitest";
import { openDb } from "./connection.ts";
import { checkDatabase } from "./integrity.ts";
import { getSchemaVersion, migrate, SCHEMA_VERSION } from "./migrate.ts";
import { insertAccount, insertInstitution } from "./repo.ts";

const clock = () => new Date("2026-01-02T03:04:05.000Z");

function freshDb() {
  const db = openDb(":memory:");
  migrate(db);
  return db;
}

describe("migrations", () => {
  it("apply from empty and are idempotent", () => {
    const db = openDb(":memory:");
    expect(getSchemaVersion(db)).toBe(0);
    const applied = migrate(db);
    expect(applied).toEqual(Array.from({ length: SCHEMA_VERSION }, (_, i) => i + 1));
    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(2);
    expect(migrate(db)).toEqual([]);
    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION);
  });

  it("refuses a database newer than the code", () => {
    const db = openDb(":memory:");
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
    expect(() => migrate(db)).toThrow(/newer than this version/);
  });

  it("sets foreign_keys on", () => {
    const db = openDb(":memory:");
    expect((db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number }).foreign_keys).toBe(1);
  });
});

describe("seed vocabulary", () => {
  const db = freshDb();
  const concept = (id: string) =>
    db.prepare("SELECT * FROM concepts WHERE id = ?").get(id) as Record<string, unknown> | undefined;

  it("has the expected concepts with period types and generic links", () => {
    const expected: [string, string, string, string | null][] = [
      ["balance.ending", "instant", "money", null],
      ["income.interest", "duration", "money", null],
      ["statement.interest_paid", "duration", "money", "income.interest"],
      ["us.1099int.box1", "duration", "money", "income.interest"],
      ["il.f867.interest", "duration", "money", "income.interest"],
      ["income.wages", "duration", "money", null],
      ["us.w2.box1_wages", "duration", "money", "income.wages"],
      ["tax.withheld.us_federal", "duration", "money", null],
      ["us.w2.box2_fed_withheld", "duration", "money", "tax.withheld.us_federal"],
      ["il.pension.accrued_savings", "instant", "money", "balance.ending"],
      ["status.account_closed", "instant", "boolean", null],
      ["status.no_document_issued", "duration", "boolean", null],
    ];
    for (const [id, period, value, generic] of expected) {
      const c = concept(id);
      expect(c, id).toBeDefined();
      expect([c!.period_type, c!.value_type, c!.generic_concept_id], id).toEqual([period, value, generic]);
    }
  });

  it("ranks the 1099-INT above the statement and has Hebrew labels for IL and generic concepts", () => {
    expect(concept("us.1099int.box1")!.authority_rank as number).toBeGreaterThan(
      concept("statement.interest_paid")!.authority_rank as number,
    );
    expect(concept("balance.ending")!.label_he).toBe("יתרה לסוף תקופה");
    expect(concept("il.f867.interest")!.label_he).toBeTruthy();
    expect(concept("il.f867.interest")!.jurisdiction).toBe("IL");
  });

  it("every generic_concept_id resolves", () => {
    const dangling = db
      .prepare(
        `SELECT c.id FROM concepts c
         WHERE c.generic_concept_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM concepts g WHERE g.id = c.generic_concept_id)`,
      )
      .all();
    expect(dangling).toEqual([]);
    expect(checkDatabase(db).foreignKeyViolations).toEqual([]);
  });

  it("has taxonomies, hierarchical terms and rate sources", () => {
    const terms = db.prepare("SELECT id, taxonomy_id, label_he FROM terms").all() as {
      id: string;
      taxonomy_id: string;
      label_he: string | null;
    }[];
    expect(terms.length).toBeGreaterThanOrEqual(14);
    for (const t of terms) {
      expect(t.id.startsWith(t.taxonomy_id + "/")).toBe(true);
      expect(t.label_he).toBeTruthy();
    }
    expect(terms.map((t) => t.id)).toContain("asset_class/investment");
    const rs = db.prepare("SELECT id, cadence FROM rate_sources ORDER BY id").all();
    expect(rs).toEqual([
      { id: "boi_representative", cadence: "daily" },
      { id: "irs_yearly_average", cadence: "yearly" },
      { id: "manual", cadence: "manual" },
      { id: "us_treasury_reporting", cadence: "quarterly" },
    ]);
  });
});

describe("constraints", () => {
  it("rejects a money fact without a currency", () => {
    const db = freshDb();
    expect(() =>
      db
        .prepare(
          `INSERT INTO facts (concept_id, value_minor, instant_date, status, origin, created_at)
           VALUES ('balance.ending', 12345, '2025-12-31', 'proposed', 'manual', ?)`,
        )
        .run(clock().toISOString()),
    ).toThrow(/CHECK constraint/);
  });

  it("accepts a money fact with a currency", () => {
    const db = freshDb();
    db.prepare(
      `INSERT INTO facts (concept_id, value_minor, currency, instant_date, status, origin, created_at)
       VALUES ('balance.ending', 12345, 'USD', '2025-12-31', 'proposed', 'manual', ?)`,
    ).run(clock().toISOString());
    expect(checkDatabase(db).ok).toBe(true);
  });
});

describe("language defaulting", () => {
  it("institution from country, account from institution, overridable", () => {
    const db = freshDb();
    const il = insertInstitution(db, clock, { name: "הראל", altName: "Harel", country: "IL" });
    const us = insertInstitution(db, clock, { name: "Fidelity", country: "us" });
    const ilEn = insertInstitution(db, clock, { name: "Bank", country: "IL", language: "en" });
    const lang = (table: string, id: number) =>
      (db.prepare(`SELECT language FROM ${table} WHERE id = ?`).get(id) as { language: string }).language;
    expect(lang("institutions", il)).toBe("he");
    expect(lang("institutions", us)).toBe("en");
    expect(lang("institutions", ilEn)).toBe("en");

    const a1 = insertAccount(db, clock, { institutionId: il, displayName: "קרן פנסיה", nativeCurrency: "ILS" });
    const a2 = insertAccount(db, clock, { institutionId: us, displayName: "Brokerage", nativeCurrency: "USD" });
    const a3 = insertAccount(db, clock, {
      institutionId: il,
      displayName: "Statement in English",
      nativeCurrency: "ILS",
      language: "en",
    });
    expect(lang("accounts", a1)).toBe("he");
    expect(lang("accounts", a2)).toBe("en");
    expect(lang("accounts", a3)).toBe("en");
    const row = db.prepare("SELECT country, created_at FROM accounts WHERE id = ?").get(a1) as {
      country: string;
      created_at: string;
    };
    expect(row).toEqual({ country: "IL", created_at: "2026-01-02T03:04:05.000Z" });
  });
});
