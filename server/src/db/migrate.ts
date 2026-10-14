import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

export const MIGRATIONS_DIR = path.join(import.meta.dirname, "migrations");

export interface Migration {
  version: number;
  name: string;
  file: string;
}

export function loadMigrations(dir: string = MIGRATIONS_DIR): Migration[] {
  const migrations = fs
    .readdirSync(dir)
    .map((f) => /^(\d{3})_([a-z0-9_]+)\.sql$/.exec(f))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ version: Number(m[1]), name: m[2]!, file: path.join(dir, m[0]) }))
    .sort((a, b) => a.version - b.version);
  migrations.forEach((m, i) => {
    if (m.version !== i + 1) {
      throw new Error(`Migration numbering gap or duplicate: expected ${i + 1}, found ${m.version}`);
    }
  });
  return migrations;
}

/** Highest migration version known to this code. */
export const SCHEMA_VERSION: number = loadMigrations().at(-1)?.version ?? 0;

export function getSchemaVersion(db: DatabaseSync): number {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  return row.user_version;
}

/** Apply pending migrations, each in its own transaction. Returns versions applied. */
export function migrate(db: DatabaseSync, dir: string = MIGRATIONS_DIR): number[] {
  const migrations = loadMigrations(dir);
  const known = migrations.at(-1)?.version ?? 0;
  const current = getSchemaVersion(db);
  if (current > known) {
    throw new Error(
      `Database schema version ${current} is newer than this version of FinShark understands ` +
        `(${known}). Upgrade FinShark; refusing to open the database.`,
    );
  }
  const applied: number[] = [];
  for (const m of migrations) {
    if (m.version <= current) continue;
    const sql = fs.readFileSync(m.file, "utf8");
    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.exec(`PRAGMA user_version = ${m.version}`);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw new Error(`Migration ${m.version}_${m.name} failed: ${(e as Error).message}`, { cause: e });
    }
    applied.push(m.version);
  }
  return applied;
}
