import fs from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { openDb } from "../db/connection.ts";
import { migrate } from "../db/migrate.ts";
import { acquireLock } from "./lock.ts";
import { VAULT_FORMAT_VERSION, vaultLayout, type VaultInfo, type VaultLayout } from "./layout.ts";

export interface Vault {
  layout: VaultLayout;
  info: VaultInfo;
  db: DatabaseSync;
  close(): void;
}

export interface CreateVaultOptions {
  now: Date;
  vaultId: string;
}

/** Create a new vault in an absent or empty directory. Leaves the vault closed. */
export function createVault(root: string, opts: CreateVaultOptions): VaultLayout {
  const layout = vaultLayout(root);
  if (fs.existsSync(layout.root) && fs.readdirSync(layout.root).length > 0) {
    throw new Error(`Refusing to create a vault in a non-empty directory: ${layout.root}`);
  }
  fs.mkdirSync(layout.root, { recursive: true });
  for (const d of [layout.documentsDir, layout.cacheDir, layout.inboxDir, layout.backupsDir]) {
    fs.mkdirSync(d, { recursive: true });
  }
  const info: VaultInfo = {
    formatVersion: VAULT_FORMAT_VERSION,
    vaultId: opts.vaultId,
    createdAt: opts.now.toISOString(),
  };
  fs.writeFileSync(layout.infoFile, JSON.stringify(info, null, 2) + "\n", { flag: "wx" });
  const db = openDb(layout.dbFile);
  try {
    migrate(db);
  } finally {
    db.close();
  }
  return layout;
}

export function readVaultInfo(layout: VaultLayout): VaultInfo {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(layout.infoFile, "utf8"));
  } catch (e) {
    throw new Error(`Not a FinShark vault (cannot read ${layout.infoFile}): ${(e as Error).message}`, { cause: e });
  }
  const o = raw as Partial<VaultInfo> | null;
  if (!o || typeof o.formatVersion !== "number" || typeof o.vaultId !== "string" || typeof o.createdAt !== "string") {
    throw new Error(`Invalid vault.json in ${layout.root}`);
  }
  if (o.formatVersion !== VAULT_FORMAT_VERSION) {
    throw new Error(
      `Unsupported vault format version ${o.formatVersion} (this FinShark understands ${VAULT_FORMAT_VERSION}).`,
    );
  }
  return { formatVersion: o.formatVersion, vaultId: o.vaultId, createdAt: o.createdAt };
}

/** Validate, lock, open and migrate an existing vault. */
export function openVault(root: string): Vault {
  const layout = vaultLayout(root);
  const info = readVaultInfo(layout);
  const lock = acquireLock(layout.lockFile);
  let db: DatabaseSync | undefined;
  try {
    db = openDb(layout.dbFile);
    migrate(db);
  } catch (e) {
    db?.close();
    lock.release();
    throw e;
  }
  const opened = db;
  let closed = false;
  return {
    layout,
    info,
    db: opened,
    close() {
      if (closed) return;
      closed = true;
      try {
        opened.close();
      } finally {
        lock.release();
      }
    },
  };
}
