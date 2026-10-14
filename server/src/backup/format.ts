// Backup file format (docs/DESIGN.md §8.1): age( tar( MANIFEST.json, finance.db,
// vault.json, documents/..., RECOVERY.txt ) ). Standard age and tar, nothing custom.

export const BACKUP_FORMAT = 1;
export const MANIFEST_NAME = "MANIFEST.json";
export const DB_NAME = "finance.db";
export const VAULT_INFO_NAME = "vault.json";
export const RECOVERY_NAME = "RECOVERY.txt";
export const BACKUP_EXTENSION = ".ffbackup";

export interface ManifestFile {
  path: string;
  size: number;
  sha256: string;
}

export interface Manifest {
  backupFormat: number;
  appVersion: string;
  schemaVersion: number;
  vaultId: string;
  createdAt: string;
  db: { path: string; size: number; sha256: string };
  files: ManifestFile[];
}

/** A finding about a backup or a vault. Never thrown; collected into reports. */
export interface Problem {
  code: string;
  message: string;
  path?: string;
}

/** `FinShark-2026-10-07T21-14.ffbackup`, from the UTC time. */
export function backupFileName(at: Date): string {
  const iso = at.toISOString(); // 2026-10-07T21:14:05.000Z
  return `FinShark-${iso.slice(0, 10)}T${iso.slice(11, 13)}-${iso.slice(14, 16)}${BACKUP_EXTENSION}`;
}

/** Entries allowed in an archive: fixed names and documents/..., with no tricks. */
export function isSafeArchivePath(p: string): boolean {
  if (p === MANIFEST_NAME || p === DB_NAME || p === VAULT_INFO_NAME || p === RECOVERY_NAME) return true;
  if (!p.startsWith("documents/") || p.length > 1024) return false;
  if (p.includes("\\") || p.includes("\0")) return false;
  return p.split("/").every((seg) => seg !== "" && seg !== "." && seg !== "..");
}

const HEX64 = /^[0-9a-f]{64}$/;

function isNonNegInt(n: unknown): n is number {
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
}

/** Parse and validate MANIFEST.json. Returns the manifest or a list of reasons it is unusable. */
export function parseManifest(text: string): { manifest: Manifest } | { errors: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { errors: ["MANIFEST.json is not valid JSON"] };
  }
  const errors: string[] = [];
  const m = raw as Partial<Manifest> | null;
  if (typeof m !== "object" || m === null) return { errors: ["MANIFEST.json is not an object"] };
  if (!isNonNegInt(m.backupFormat)) errors.push("backupFormat missing");
  if (typeof m.appVersion !== "string") errors.push("appVersion missing");
  if (!isNonNegInt(m.schemaVersion)) errors.push("schemaVersion missing");
  if (typeof m.vaultId !== "string") errors.push("vaultId missing");
  if (typeof m.createdAt !== "string") errors.push("createdAt missing");
  if (!m.db || m.db.path !== DB_NAME || !isNonNegInt(m.db.size) || !HEX64.test(String(m.db.sha256))) {
    errors.push("db entry invalid");
  }
  const seen = new Set<string>();
  if (!Array.isArray(m.files)) {
    errors.push("files missing");
  } else {
    for (const f of m.files) {
      if (!f || typeof f.path !== "string" || !isSafeArchivePath(f.path) || f.path === MANIFEST_NAME || f.path === DB_NAME) {
        errors.push(`bad file entry: ${JSON.stringify(f?.path)}`);
      } else if (seen.has(f.path)) {
        errors.push(`duplicate file entry: ${f.path}`);
      } else if (!isNonNegInt(f.size) || !HEX64.test(String(f.sha256))) {
        errors.push(`bad size/hash for ${f.path}`);
      }
      if (f && typeof f.path === "string") seen.add(f.path);
    }
  }
  if (errors.length > 0) return { errors };
  return { manifest: m as Manifest };
}

export function recoveryText(info: { createdAt: string; vaultId: string; appVersion: string }): string {
  return `FinShark backup - manual recovery instructions
=================================================

This file is a FinShark backup made on ${info.createdAt} (vault ${info.vaultId},
FinShark ${info.appVersion}). You can recover everything from it WITHOUT FinShark.

What you need
  1. This backup file (it ends in .ffbackup).
  2. The vault's private key: a line starting with  AGE-SECRET-KEY-1...
     (from your printed recovery sheet, or from the passphrase-protected
     vault-key.age file stored next to your backups).
  3. The free "age" tool: https://age-encryption.org  (macOS: brew install age)

Steps (in Terminal)
  1. Save the private key line into a text file named key.txt
     (If you only have vault-key.age:  age -d vault-key.age > key.txt
      and enter your passphrase.)
  2. Make an empty folder and unpack the backup into it:

       mkdir recovered && cd recovered
       age -d -i ../key.txt ../FinShark-YYYY-MM-DDTHH-MM.ffbackup | tar x

What you get
  MANIFEST.json   list of every file with its size and SHA-256 checksum
  finance.db      the database (SQLite; open with any SQLite tool, e.g. sqlite3 finance.db)
  vault.json      vault id and format version
  documents/      your original PDFs, named by their SHA-256 checksum
  RECOVERY.txt    this file

To check a file by hand:  shasum -a 256 documents/2025/ab/ab12....pdf
The result must equal the file name and the entry in MANIFEST.json.
`;
}
