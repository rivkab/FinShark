import type { DatabaseSync } from "node:sqlite";
import { getSchemaVersion } from "./migrate.ts";

export interface ForeignKeyViolation {
  table: string;
  rowid: number | null;
  parent: string;
  fkid: number;
}

export interface DatabaseReport {
  ok: boolean;
  schemaVersion: number;
  integrityCheck: string[]; // ['ok'] when healthy
  foreignKeyViolations: ForeignKeyViolation[];
}

/** Database-level checks only. Document-file checks live elsewhere. */
export function checkDatabase(db: DatabaseSync): DatabaseReport {
  const integrityCheck = (db.prepare("PRAGMA integrity_check").all() as { integrity_check: string }[]).map(
    (r) => r.integrity_check,
  );
  const foreignKeyViolations = (
    db.prepare("PRAGMA foreign_key_check").all() as {
      table: string;
      rowid: number | bigint | null;
      parent: string;
      fkid: number | bigint;
    }[]
  ).map((r) => ({
    table: r.table,
    rowid: r.rowid === null ? null : Number(r.rowid),
    parent: r.parent,
    fkid: Number(r.fkid),
  }));
  return {
    ok: integrityCheck.length === 1 && integrityCheck[0] === "ok" && foreignKeyViolations.length === 0,
    schemaVersion: getSchemaVersion(db),
    integrityCheck,
    foreignKeyViolations,
  };
}
