import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { Decrypter } from "age-encryption";
import * as tar from "tar-stream";
import {
  BACKUP_FORMAT,
  DB_NAME,
  MANIFEST_NAME,
  parseManifest,
  VAULT_INFO_NAME,
  type Manifest,
  type Problem,
} from "./format.ts";

const MAX_MANIFEST_BYTES = 256 * 1024 * 1024;

export interface VerifyReport {
  ok: boolean;
  problems: Problem[];
  /** True when the file could not be decrypted at all (wrong key, or not an age file). */
  cannotDecrypt: boolean;
  manifest: Manifest | null;
  /** Number of archive entries whose content was checked. */
  entriesChecked: number;
}

export interface AnalyzeOptions {
  /**
   * Directory to write into. finance.db is always written there; with `extractAll`
   * also vault.json and documents/... (only entries listed in the manifest).
   * Without it nothing but the temp DB copy is written.
   */
  extractTo?: string;
  extractAll?: boolean;
  /** Refuse (before reading further) backups of a newer schema than this. */
  maxSchemaVersion?: number;
  /** Directory for the temporary finance.db copy when `extractTo` is not given. */
  tempDir?: string;
}

class Abort extends Error {}

interface ArchiveEntry extends AsyncIterable<Buffer> {
  header: { name: string; type?: string | null | undefined };
}

/** Internal: stream the archive, check every entry, run DB checks. Never throws for content problems. */
export async function analyzeBackup(file: string, identity: string, opts: AnalyzeOptions = {}): Promise<VerifyReport> {
  const problems: Problem[] = [];
  const report: VerifyReport = { ok: false, problems, cannotDecrypt: false, manifest: null, entriesChecked: 0 };
  const add = (code: string, message: string, p?: string) =>
    problems.push(p === undefined ? { code, message } : { code, message, path: p });

  let ownTemp: string | null = null;
  let dir = opts.extractTo;
  if (!dir) {
    ownTemp = await fs.mkdtemp(path.join(opts.tempDir ?? os.tmpdir(), "finshark-verify-"));
    dir = ownTemp;
  }
  const extractAll = opts.extractAll === true;
  const actualHashes = new Map<string, string>(); // archive path -> sha256 as read
  let src: ReturnType<typeof createReadStream> | null = null;
  let plain: Readable | null = null;
  let extract: tar.Extract | null = null;

  try {
    // 1. Open + decrypt header. Failure here means wrong key or not an age file.
    try {
      src = createReadStream(file);
      const d = new Decrypter();
      d.addIdentity(identity);
      const web = await d.decrypt(Readable.toWeb(src) as unknown as ReadableStream<Uint8Array>);
      plain = Readable.fromWeb(web as unknown as NodeWebReadableStream<Uint8Array>);
    } catch (e) {
      src?.destroy();
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        add("file-missing", `Backup file not found: ${file}`);
      } else {
        report.cannotDecrypt = true;
        add(
          "cannot-decrypt",
          `Cannot decrypt this backup: it is not a FinShark/age file, or the key does not match (${(e as Error).message})`,
        );
      }
      return report;
    }

    // 2. Stream tar entries.
    extract = tar.extract();
    const piped = pipeline(plain, extract);
    piped.catch(() => {}); // consumed below via the entry iterator / await piped

    let expected: Map<string, { size: number; sha256: string }> | null = null;
    const seen = new Set<string>();
    let first = true;

    try {
      for await (const entry of extract as unknown as AsyncIterable<ArchiveEntry>) {
        const name = entry.header.name;
        if (first) {
          first = false;
          if (name !== MANIFEST_NAME) {
            add("manifest-missing", `First entry must be ${MANIFEST_NAME}, found ${name}`);
            throw new Abort();
          }
          const chunks: Uint8Array[] = [];
          let total = 0;
          for await (const c of entry) {
            total += c.length;
            if (total > MAX_MANIFEST_BYTES) {
              add("manifest-invalid", "MANIFEST.json is implausibly large");
              throw new Abort();
            }
            chunks.push(c);
          }
          const parsed = parseManifest(Buffer.concat(chunks).toString("utf8"));
          if ("errors" in parsed) {
            add("manifest-invalid", `MANIFEST.json is invalid: ${parsed.errors.join("; ")}`);
            throw new Abort();
          }
          const m = parsed.manifest;
          report.manifest = m;
          if (m.backupFormat !== BACKUP_FORMAT) {
            add("unsupported-format", `Backup format ${m.backupFormat} is not supported (this app reads ${BACKUP_FORMAT})`);
            throw new Abort();
          }
          if (opts.maxSchemaVersion !== undefined && m.schemaVersion > opts.maxSchemaVersion) {
            add(
              "schema-too-new",
              `This backup has database schema version ${m.schemaVersion}, newer than this app supports (${opts.maxSchemaVersion}). Update FinShark and try again.`,
            );
            throw new Abort();
          }
          expected = new Map([[DB_NAME, { size: m.db.size, sha256: m.db.sha256 }]]);
          for (const f of m.files) expected.set(f.path, { size: f.size, sha256: f.sha256 });
          continue;
        }

        const exp = expected!.get(name);
        if (entry.header.type !== "file" || !exp) {
          add(
            "entry-unexpected",
            entry.header.type !== "file" ? `Entry ${name} is not a regular file` : `Entry ${name} is not listed in the manifest`,
            name,
          );
          await drain(entry);
          continue;
        }
        if (seen.has(name)) {
          add("entry-duplicate", `Entry ${name} appears more than once`, name);
          await drain(entry);
          continue;
        }
        seen.add(name);

        const hash = createHash("sha256");
        let size = 0;
        const writeIt = name === DB_NAME || (extractAll && name !== MANIFEST_NAME && name !== "RECOVERY.txt");
        let fh: fs.FileHandle | null = null;
        try {
          if (writeIt) {
            const dest = path.join(dir, ...name.split("/"));
            await fs.mkdir(path.dirname(dest), { recursive: true });
            fh = await fs.open(dest, "wx", 0o600);
          }
          for await (const chunk of entry) {
            hash.update(chunk);
            size += chunk.length;
            if (fh) await fh.write(chunk);
          }
          if (fh) await fh.sync();
        } finally {
          await fh?.close();
        }
        const digest = hash.digest("hex");
        actualHashes.set(name, digest);
        report.entriesChecked++;
        if (size !== exp.size) add("size-mismatch", `${name}: size ${size}, manifest says ${exp.size}`, name);
        if (digest !== exp.sha256) add("hash-mismatch", `${name}: SHA-256 differs from the manifest`, name);
      }
      await piped;
    } catch (e) {
      if (!(e instanceof Abort)) {
        add(
          "corrupt-archive",
          `The backup is damaged or has been tampered with (decryption/authentication failed): ${(e as Error).message}`,
        );
      }
      plain.destroy();
      extract.destroy();
      src.destroy();
      return finish(report);
    }

    if (!expected) {
      add("manifest-missing", "The archive is empty");
      return finish(report);
    }
    for (const p of expected.keys()) {
      if (!seen.has(p)) add("entry-missing", `Listed in the manifest but absent from the archive: ${p}`, p);
    }

    // 3. Database checks on the extracted copy.
    if (seen.has(DB_NAME) && actualHashes.get(DB_NAME) === expected.get(DB_NAME)!.sha256) {
      checkDatabase(path.join(dir, DB_NAME), report.manifest!, actualHashes, add);
    }

    // 4. vault.json agrees with the manifest (cheap sanity check).
    if (extractAll && seen.has(VAULT_INFO_NAME)) {
      try {
        const info = JSON.parse(await fs.readFile(path.join(dir, VAULT_INFO_NAME), "utf8")) as { vaultId?: unknown };
        if (info.vaultId !== report.manifest!.vaultId) add("vault-id-mismatch", "vault.json vaultId differs from the manifest", VAULT_INFO_NAME);
      } catch {
        add("vault-info-invalid", "vault.json is not valid JSON", VAULT_INFO_NAME);
      }
    }
    return finish(report);
  } finally {
    src?.destroy();
    if (ownTemp) await fs.rm(ownTemp, { recursive: true, force: true });
  }
}

function finish(report: VerifyReport): VerifyReport {
  report.ok = report.problems.length === 0;
  return report;
}

async function drain(s: AsyncIterable<Uint8Array>): Promise<void> {
  for await (const _ of s) {
    // discard
  }
}

function checkDatabase(
  dbPath: string,
  manifest: Manifest,
  archiveHashes: Map<string, string>,
  add: (code: string, message: string, p?: string) => void,
): void {
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(dbPath);
    const integrity = db.prepare("PRAGMA integrity_check").all() as { integrity_check: string }[];
    for (const r of integrity) {
      if (r.integrity_check !== "ok") add("db-integrity", `PRAGMA integrity_check: ${r.integrity_check}`, DB_NAME);
    }
    const fk = db.prepare("PRAGMA foreign_key_check").all() as { table: string; rowid: number; parent: string }[];
    for (const r of fk) {
      add("db-foreign-key", `Foreign key violation in ${r.table} (rowid ${r.rowid}) referencing ${r.parent}`, DB_NAME);
    }
    const uv = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
    if (uv !== manifest.schemaVersion) {
      add("schema-version-mismatch", `Database user_version ${uv} differs from the manifest (${manifest.schemaVersion})`, DB_NAME);
    }
    const docs = db.prepare("SELECT sha256, stored_path FROM documents").all() as { sha256: string; stored_path: string }[];
    for (const d of docs) {
      const actual = archiveHashes.get(d.stored_path);
      if (actual === undefined) {
        add("db-document-missing", `Document ${d.stored_path} is in the database but not in the backup`, d.stored_path);
      } else if (actual !== d.sha256) {
        add("db-document-hash-mismatch", `Document ${d.stored_path}: file content does not match the sha256 recorded in the database`, d.stored_path);
      }
    }
  } catch (e) {
    add("db-unreadable", `finance.db in the backup cannot be opened or queried: ${(e as Error).message}`, DB_NAME);
  } finally {
    try {
      db?.close();
    } catch {
      // ignore
    }
  }
}

/**
 * Verify a backup file without restoring it: decrypts as a stream (age authenticates
 * every chunk), checks every entry against MANIFEST.json, runs integrity and foreign
 * key checks on the contained database, and confirms every `documents` row's file is
 * present with the recorded sha256. Content problems are reported, not thrown.
 */
export function verifyBackup(file: string, identity: string, opts: { tempDir?: string } = {}): Promise<VerifyReport> {
  return analyzeBackup(file, identity, opts.tempDir === undefined ? {} : { tempDir: opts.tempDir });
}
