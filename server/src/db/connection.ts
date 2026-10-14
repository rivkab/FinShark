import { DatabaseSync } from "node:sqlite";

export const BUSY_TIMEOUT_MS = 5000;

/** Open a SQLite database with FinShark's required pragmas. Accepts ':memory:' for tests. */
export function openDb(file: string): DatabaseSync {
  const db = new DatabaseSync(file);
  try {
    db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    db.exec("PRAGMA foreign_keys = ON");
    if (file !== ":memory:") db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = FULL");
  } catch (e) {
    db.close();
    throw e;
  }
  return db;
}
