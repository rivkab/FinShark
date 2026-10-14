import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync, backup as sqliteBackup } from "node:sqlite";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { Encrypter } from "age-encryption";
import * as tar from "tar-stream";
import type { VaultLayout } from "../vault/layout.ts";
import {
  BACKUP_FORMAT,
  DB_NAME,
  MANIFEST_NAME,
  RECOVERY_NAME,
  VAULT_INFO_NAME,
  backupFileName,
  recoveryText,
  type Manifest,
  type ManifestFile,
  type Problem,
} from "./format.ts";
import { verifyBackup, type VerifyReport } from "./verify.ts";

export interface CreateBackupOptions {
  layout: VaultLayout;
  /** The live database. Only read (snapshotted with the SQLite backup API). */
  db: DatabaseSync;
  now: () => Date;
  /** age recipients (`age1...`); at least one. No secret is needed to create a backup. */
  recipients: string[];
  outDir: string;
  appVersion: string;
  /** Caller's integrity checks (DESIGN §7 "Verify vault"). Throw to abort the backup. */
  preflight?: () => void | Promise<void>;
  /**
   * Private key used to verify the file right after writing it. Required: an
   * unverified backup is not accepted as a backup.
   */
  verifyIdentity: string;
}

export interface CreateBackupResult {
  /** Absolute path of the finished `.ffbackup`. */
  file: string;
  manifest: Manifest;
  bytes: number;
  /**
   * Inconsistencies found in the vault while reading it (document file differs
   * from its DB row, row without file, file without row). The backup is still
   * written, as it is the best evidence available, but `verify.ok` will be false
   * for the first two kinds.
   */
  vaultWarnings: Problem[];
  verify: VerifyReport;
}

interface Hashed {
  size: number;
  sha256: string;
}

async function hashFile(file: string): Promise<Hashed> {
  const h = createHash("sha256");
  let size = 0;
  for await (const chunk of createReadStream(file)) {
    h.update(chunk as Buffer);
    size += (chunk as Buffer).length;
  }
  return { size, sha256: h.digest("hex") };
}

/** Recursively list regular files under `dir`, as forward-slash paths relative to `base`, sorted. */
async function listFiles(dir: string, base: string, problems: Problem[]): Promise<string[]> {
  const out: string[] = [];
  const walk = async (d: string): Promise<void> => {
    let entries;
    try {
      entries = await fs.readdir(d, { withFileTypes: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
      throw e;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const ent of entries) {
      const full = path.join(d, ent.name);
      if (ent.isDirectory()) await walk(full);
      else if (ent.isFile()) out.push(path.relative(base, full).split(path.sep).join("/"));
      else problems.push({ code: "vault-special-file", message: `Skipped non-regular file: ${full}` });
    }
  };
  await walk(dir);
  return out;
}

/** Fails the stream if the bytes differ from what the manifest recorded (file changed mid-backup). */
function integrityGuard(name: string, expected: Hashed): Transform {
  const h = createHash("sha256");
  let size = 0;
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      h.update(chunk);
      size += chunk.length;
      cb(null, chunk);
    },
    flush(cb) {
      if (size !== expected.size || h.digest("hex") !== expected.sha256) {
        cb(new Error(`${name} changed while the backup was being written; try again`));
      } else cb();
    },
  });
}

function putBuffer(pack: tar.Pack, name: string, data: Buffer, mtime: Date): Promise<void> {
  return new Promise((resolve, reject) => {
    pack.entry({ name, size: data.length, mode: 0o644, mtime, type: "file" }, data, (err) => (err ? reject(err) : resolve()));
  });
}

async function putFile(pack: tar.Pack, name: string, abs: string, expected: Hashed, mtime: Date): Promise<void> {
  const entry = pack.entry({ name, size: expected.size, mode: 0o644, mtime, type: "file" });
  await pipeline(createReadStream(abs), integrityGuard(name, expected), entry);
}

/**
 * Create an encrypted backup: snapshot DB, stream tar -> age -> `<name>.partial`,
 * fsync, rename, then immediately verify the written file.
 *
 * Memory use is bounded: documents are read in chunks twice (once to build the
 * manifest, once while writing; the second pass fails the backup if a file
 * changed in between). Only the manifest (path/size/hash per file) is held in memory.
 */
export async function createBackup(opts: CreateBackupOptions): Promise<CreateBackupResult> {
  const { layout, db, now, outDir } = opts;
  if (opts.recipients.length === 0) throw new Error("At least one recipient is required");
  for (const r of opts.recipients) {
    if (!r.startsWith("age1")) throw new Error(`Not an age recipient: ${r.slice(0, 12)}...`);
  }
  await opts.preflight?.();

  const createdAt = now();
  await fs.mkdir(outDir, { recursive: true });
  const finalPath = path.resolve(outDir, backupFileName(createdAt));
  const partialPath = `${finalPath}.partial`;
  try {
    await fs.access(finalPath);
    throw new Error(`Backup already exists: ${finalPath}`);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }

  const workDir = await fs.mkdtemp(path.join(outDir, ".snapshot-"));
  try {
    // 1. Consistent DB snapshot (SQLite online backup API), never the live file.
    const snapshotPath = path.join(workDir, DB_NAME);
    await sqliteBackup(db, snapshotPath);
    const dbHash = await hashFile(snapshotPath);
    const snap = new DatabaseSync(snapshotPath);
    let schemaVersion: number;
    let docRows: { sha256: string; stored_path: string }[];
    try {
      schemaVersion = (snap.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
      docRows = snap.prepare("SELECT sha256, stored_path FROM documents").all() as typeof docRows;
    } finally {
      snap.close();
    }

    // 2. Manifest: hash vault.json and every document (streaming), compare with DB rows.
    const vaultWarnings: Problem[] = [];
    const infoBytes = await fs.readFile(layout.infoFile);
    const info = JSON.parse(infoBytes.toString("utf8")) as { vaultId?: unknown };
    if (typeof info.vaultId !== "string") throw new Error("vault.json has no vaultId");

    const docPaths = await listFiles(layout.documentsDir, layout.root, vaultWarnings);
    const files: ManifestFile[] = [];
    const sources = new Map<string, string>(); // archive path -> absolute path
    const hashes = new Map<string, Hashed>();
    for (const rel of docPaths) {
      const abs = path.join(layout.root, ...rel.split("/"));
      const h = await hashFile(abs);
      files.push({ path: rel, ...h });
      sources.set(rel, abs);
      hashes.set(rel, h);
    }
    const rowPaths = new Set<string>();
    for (const row of docRows) {
      rowPaths.add(row.stored_path);
      const h = hashes.get(row.stored_path);
      if (!h) {
        vaultWarnings.push({ code: "document-missing", message: `Document file missing for database row: ${row.stored_path}`, path: row.stored_path });
      } else if (h.sha256 !== row.sha256) {
        vaultWarnings.push({
          code: "document-modified",
          message: `Document ${row.stored_path} no longer matches the sha256 in the database (modified or corrupted)`,
          path: row.stored_path,
        });
      }
    }
    for (const rel of docPaths) {
      if (!rowPaths.has(rel)) vaultWarnings.push({ code: "document-orphan", message: `File has no database row: ${rel}`, path: rel });
    }

    const infoHash = { size: infoBytes.length, sha256: createHash("sha256").update(infoBytes).digest("hex") };
    const recovery = Buffer.from(recoveryText({ createdAt: createdAt.toISOString(), vaultId: info.vaultId, appVersion: opts.appVersion }), "utf8");
    const recoveryHash = { size: recovery.length, sha256: createHash("sha256").update(recovery).digest("hex") };
    const manifest: Manifest = {
      backupFormat: BACKUP_FORMAT,
      appVersion: opts.appVersion,
      schemaVersion,
      vaultId: info.vaultId,
      createdAt: createdAt.toISOString(),
      db: { path: DB_NAME, ...dbHash },
      files: [{ path: VAULT_INFO_NAME, ...infoHash }, ...files, { path: RECOVERY_NAME, ...recoveryHash }],
    };

    // 3. Stream: tar -> age -> .partial
    const encrypter = new Encrypter();
    for (const r of opts.recipients) encrypter.addRecipient(r);
    const pack = tar.pack();
    const encrypted = await encrypter.encrypt((ReadableStream as unknown as { from(i: AsyncIterable<Uint8Array>): unknown }).from(pack as unknown as AsyncIterable<Uint8Array>) as ReadableStream<Uint8Array>);
    let bytes = 0;
    try {
      const out = createWriteStream(partialPath, { flags: "wx", mode: 0o600 });
      const written = pipeline(Readable.fromWeb(encrypted as unknown as NodeWebReadableStream<Uint8Array>), out);
      written.catch(() => {});
      try {
        await putBuffer(pack, MANIFEST_NAME, Buffer.from(JSON.stringify(manifest, null, 2) + "\n"), createdAt);
        await putFile(pack, DB_NAME, snapshotPath, dbHash, createdAt);
        await putBuffer(pack, VAULT_INFO_NAME, infoBytes, createdAt);
        for (const f of files) await putFile(pack, f.path, sources.get(f.path)!, f, createdAt);
        await putBuffer(pack, RECOVERY_NAME, recovery, createdAt);
        pack.finalize();
      } catch (e) {
        pack.destroy(e as Error);
        throw e;
      }
      await written;
      const fh = await fs.open(partialPath, "r+");
      try {
        await fh.sync();
        bytes = (await fh.stat()).size;
      } finally {
        await fh.close();
      }
    } catch (e) {
      await fs.rm(partialPath, { force: true });
      throw e;
    }
    await fs.rename(partialPath, finalPath);
    const dirFd = await fs.open(path.dirname(finalPath), "r");
    try {
      await dirFd.sync();
    } finally {
      await dirFd.close();
    }

    // 4. Verify what is actually on disk.
    const verify = await verifyBackup(finalPath, opts.verifyIdentity);
    return { file: finalPath, manifest, bytes, vaultWarnings, verify };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}
