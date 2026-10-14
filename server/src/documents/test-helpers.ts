// Test-only helpers for the documents area. Not imported by production code.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { vaultLayout, type VaultLayout } from "../vault/layout.ts";

const MIGRATION = new URL("../db/migrations/001_initial.sql", import.meta.url);

export interface TestVault {
  db: DatabaseSync;
  layout: VaultLayout;
  dir: string;
  cleanup(): Promise<void>;
}

export async function makeTestVault(): Promise<TestVault> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "finshark-docs-"));
  const layout = vaultLayout(path.join(dir, "vault"));
  await fs.mkdir(layout.documentsDir, { recursive: true });
  await fs.mkdir(layout.cacheDir, { recursive: true });
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  db.exec(await fs.readFile(MIGRATION, "utf8"));
  return {
    db,
    layout,
    dir,
    async cleanup() {
      db.close();
      // Stored documents are read-only files; directories stay writable so rm works.
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}

/** Write bytes to a file inside the test's scratch dir (outside the vault) and return its path. */
export async function writeSource(dir: string, name: string, bytes: Uint8Array | string): Promise<string> {
  const p = path.join(dir, "src", name);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, bytes);
  return p;
}
