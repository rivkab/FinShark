import path from "node:path";

// On-disk layout of a vault. See docs/DESIGN.md §7. Every module that touches
// vault files goes through these helpers so the layout is defined in one place.
//
//   <root>/
//     vault.json                  VaultInfo
//     finance.db                  SQLite (WAL)
//     finshark.lock               PID of the server holding the vault
//     documents/YYYY/ab/<sha256>.<ext>
//     cache/                      regenerable: text layers, thumbnails
//     inbox/
//     backups/

export const VAULT_FORMAT_VERSION = 1;

export interface VaultInfo {
  formatVersion: number;
  vaultId: string; // random UUID, fixed at creation
  createdAt: string; // ISO-8601 UTC
}

export interface VaultLayout {
  root: string;
  infoFile: string;
  dbFile: string;
  lockFile: string;
  documentsDir: string;
  cacheDir: string;
  inboxDir: string;
  backupsDir: string;
}

export function vaultLayout(root: string): VaultLayout {
  const abs = path.resolve(root);
  return {
    root: abs,
    infoFile: path.join(abs, "vault.json"),
    dbFile: path.join(abs, "finance.db"),
    lockFile: path.join(abs, "finshark.lock"),
    documentsDir: path.join(abs, "documents"),
    cacheDir: path.join(abs, "cache"),
    inboxDir: path.join(abs, "inbox"),
    backupsDir: path.join(abs, "backups"),
  };
}

/**
 * Vault-relative path for a stored document, as recorded in documents.stored_path.
 * Content-addressed; the year is the import year and never changes afterwards.
 * Always uses forward slashes.
 */
export function documentRelativePath(sha256: string, importYear: number, ext: string): string {
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error(`Not a lowercase sha256: ${sha256}`);
  const cleanExt = ext.replace(/^\./, "").toLowerCase();
  return `documents/${importYear}/${sha256.slice(0, 2)}/${sha256}.${cleanExt}`;
}

/** Absolute path for a vault-relative path, refusing anything that escapes the root. */
export function resolveInVault(layout: VaultLayout, relative: string): string {
  const abs = path.resolve(layout.root, relative);
  if (abs !== layout.root && !abs.startsWith(layout.root + path.sep)) {
    throw new Error(`Path escapes vault: ${relative}`);
  }
  return abs;
}
