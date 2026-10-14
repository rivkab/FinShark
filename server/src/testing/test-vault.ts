// Test-only: a real vault (all migrations, seed vocabulary, lock) in a temp directory.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { importDocument, type ImportResult } from "../documents/import.ts";
import { insertAccount, insertInstitution, insertPerson } from "../db/repo.ts";
import { createVault, openVault, type Vault } from "../vault/vault.ts";

export const TEST_NOW = new Date("2026-10-14T12:00:00Z");

export interface RealTestVault {
  vault: Vault;
  dir: string;
  now: () => Date;
  /** Import PDF bytes through the real pipeline. */
  importPdf(bytes: Uint8Array, name?: string): Promise<Extract<ImportResult, { status: "imported" }>>;
  cleanup(): Promise<void>;
}

export async function makeRealVault(): Promise<RealTestVault> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "finshark-vault-"));
  const root = path.join(dir, "vault");
  createVault(root, { now: TEST_NOW, vaultId: "00000000-0000-4000-8000-000000000000" });
  const vault = openVault(root);
  const now = () => TEST_NOW;
  return {
    vault,
    dir,
    now,
    async importPdf(bytes, name = "statement.pdf") {
      const src = path.join(dir, "src", name);
      await fs.mkdir(path.dirname(src), { recursive: true });
      await fs.writeFile(src, bytes);
      const r = await importDocument({ db: vault.db, layout: vault.layout, now }, src);
      if (r.status !== "imported") throw new Error("expected a fresh import");
      return r;
    },
    async cleanup() {
      vault.close();
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}

/** One person, one US institution and a USD account. */
export function seedBasics(v: RealTestVault) {
  const personId = insertPerson(v.vault.db, v.now, { displayName: "Dana" });
  const institutionId = insertInstitution(v.vault.db, v.now, { name: "Example Brokerage", country: "US" });
  const accountId = insertAccount(v.vault.db, v.now, { institutionId, displayName: "Brokerage ...4821", nativeCurrency: "USD" });
  return { personId, institutionId, accountId };
}
