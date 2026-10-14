import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makePdf } from "../testing/pdf-fixture.ts";
import { documentRelativePath, vaultLayout, type VaultLayout } from "../vault/layout.ts";
import { createBackup, type CreateBackupResult } from "./create.ts";
import { generateVaultKey, type VaultKey } from "./keys.ts";
import { restoreBackup } from "./restore.ts";
import { verifyBackup } from "./verify.ts";

const MIGRATION = path.resolve(import.meta.dirname, "../db/migrations/001_initial.sql");
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

let tmp: string;
let layout: VaultLayout;
let db: DatabaseSync;
let key: VaultKey;
let docs: { rel: string; bytes: Uint8Array }[];
let clock: Date;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "finshark-backup-test-"));
  layout = vaultLayout(path.join(tmp, "vault"));
  await fs.mkdir(layout.root, { recursive: true });
  await fs.writeFile(layout.infoFile, JSON.stringify({ formatVersion: 1, vaultId: randomUUID(), createdAt: "2026-01-01T00:00:00Z" }));
  db = new DatabaseSync(layout.dbFile);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(await fs.readFile(MIGRATION, "utf8"));
  docs = [];
  for (let i = 0; i < 3; i++) {
    const bytes = makePdf([{ texts: [{ text: `Fake statement ${i}`, x: 72, y: 700 }] }]);
    const hash = sha(bytes);
    const rel = documentRelativePath(hash, 2025 + (i % 2), "pdf");
    await fs.mkdir(path.dirname(path.join(layout.root, rel)), { recursive: true });
    await fs.writeFile(path.join(layout.root, rel), bytes);
    db.prepare(
      "INSERT INTO documents (sha256, stored_path, original_filename, byte_size, mime, imported_at) VALUES (?, ?, ?, ?, 'application/pdf', '2026-01-01T00:00:00Z')",
    ).run(hash, rel, `s${i}.pdf`, bytes.length);
    docs.push({ rel, bytes });
  }
  // Things that must be excluded.
  await fs.mkdir(layout.cacheDir, { recursive: true });
  await fs.writeFile(path.join(layout.cacheDir, "thumb.png"), "cache");
  await fs.writeFile(layout.lockFile, "123");
  key = await generateVaultKey();
  clock = new Date("2026-10-07T21:14:30Z");
});

afterEach(async () => {
  db.close();
  await fs.rm(tmp, { recursive: true, force: true });
});

function make(over: Partial<Parameters<typeof createBackup>[0]> = {}): Promise<CreateBackupResult> {
  return createBackup({
    layout,
    db,
    now: () => clock,
    recipients: [key.recipient],
    outDir: path.join(tmp, "out"),
    appVersion: "0.0.0-test",
    verifyIdentity: key.identity,
    ...over,
  });
}

describe("backup round trip", () => {
  it("creates an unattended backup with only the public key, verifiable later", async () => {
    const r = await createBackup({
      layout,
      db,
      now: () => clock,
      recipients: [key.recipient],
      outDir: path.join(tmp, "out"),
      appVersion: "0.0.0-test",
    });
    expect(r.verify).toBeNull();
    const v = await verifyBackup(r.file, key.identity);
    expect(v.ok, JSON.stringify(v.problems)).toBe(true);
  });

  it("creates, verifies and restores identical data", async () => {
    const r = await make();
    expect(path.basename(r.file)).toBe("FinShark-2026-10-07T21-14.ffbackup");
    expect(r.verify!.ok, JSON.stringify(r.verify!.problems)).toBe(true);
    expect(r.vaultWarnings).toEqual([]);
    expect(r.manifest.files.map((f) => f.path)).not.toContainEqual(expect.stringContaining("cache"));
    expect((await fs.readdir(path.join(tmp, "out"))).sort()).toEqual(["FinShark-2026-10-07T21-14.ffbackup"]);

    const v = await verifyBackup(r.file, key.identity);
    expect(v.ok).toBe(true);
    expect(v.entriesChecked).toBe(1 + 1 + docs.length + 1); // db, vault.json, docs, recovery

    const target = path.join(tmp, "restored");
    const res = await restoreBackup(r.file, key.identity, target, { maxSchemaVersion: 1 });
    expect(res.ok, JSON.stringify(res.problems)).toBe(true);
    expect(await fs.readdir(`${tmp}`)).not.toContain("restored.restoring");
    for (const d of docs) {
      const restored = await fs.readFile(path.join(target, d.rel));
      expect(Buffer.compare(restored, d.bytes)).toBe(0);
      expect((await fs.stat(path.join(target, d.rel))).mode & 0o777).toBe(0o444);
    }
    const copy = new DatabaseSync(path.join(target, "finance.db"));
    const rows = (x: DatabaseSync) => x.prepare("SELECT sha256, stored_path FROM documents ORDER BY id").all();
    expect(rows(copy)).toEqual(rows(db));
    copy.close();
    expect(await fs.readFile(path.join(target, "vault.json"), "utf8")).toBe(await fs.readFile(layout.infoFile, "utf8"));
    await expect(fs.access(path.join(target, "cache", "thumb.png"))).rejects.toThrow();
    await expect(fs.access(path.join(target, "finshark.lock"))).rejects.toThrow();
  });

  it("supports multiple recipients", async () => {
    const second = await generateVaultKey();
    const r = await make({ recipients: [key.recipient, second.recipient] });
    expect((await verifyBackup(r.file, second.identity)).ok).toBe(true);
    expect((await verifyBackup(r.file, key.identity)).ok).toBe(true);
  });

  it("aborts when preflight throws and leaves nothing behind", async () => {
    await expect(
      make({
        preflight: () => {
          throw new Error("integrity check failed");
        },
      }),
    ).rejects.toThrow("integrity check failed");
    await expect(fs.readdir(path.join(tmp, "out"))).rejects.toThrow();
  });

  it("is a plain tar after age decryption (header sanity)", async () => {
    const r = await make();
    const head = await fs.readFile(r.file);
    expect(head.subarray(0, 21).toString()).toBe("age-encryption.org/v1");
  });
});

describe("tamper and failure cases", () => {
  it("detects a flipped byte in the encrypted payload", async () => {
    const r = await make();
    const buf = await fs.readFile(r.file);
    buf[Math.floor(buf.length * 0.6)]! ^= 0x01;
    await fs.writeFile(r.file, buf);
    const v = await verifyBackup(r.file, key.identity);
    expect(v.ok).toBe(false);
    expect(v.problems.some((p) => p.code === "corrupt-archive" || p.code === "cannot-decrypt")).toBe(true);
  });

  it("detects truncation", async () => {
    const r = await make();
    const buf = await fs.readFile(r.file);
    await fs.writeFile(r.file, buf.subarray(0, buf.length - 100));
    expect((await verifyBackup(r.file, key.identity)).ok).toBe(false);
  });

  it("reports a clear 'cannot decrypt' for the wrong identity", async () => {
    const r = await make();
    const other = await generateVaultKey();
    const v = await verifyBackup(r.file, other.identity);
    expect(v.ok).toBe(false);
    expect(v.cannotDecrypt).toBe(true);
    expect(v.problems[0]?.code).toBe("cannot-decrypt");
  });

  it("reports a missing file without throwing", async () => {
    const v = await verifyBackup(path.join(tmp, "nope.ffbackup"), key.identity);
    expect(v.ok).toBe(false);
    expect(v.problems[0]?.code).toBe("file-missing");
  });

  it("flags a document modified after its DB row was written", async () => {
    const d = docs[1]!;
    await fs.writeFile(path.join(layout.root, d.rel), Buffer.concat([d.bytes, Buffer.from("tampered")]));
    const r = await make();
    expect(r.vaultWarnings.map((w) => w.code)).toContain("document-modified");
    expect(r.verify!.ok).toBe(false);
    expect(r.verify!.problems.map((p) => p.code)).toContain("db-document-hash-mismatch");
  });

  it("flags a missing document file and an orphan file", async () => {
    await fs.rm(path.join(layout.root, docs[0]!.rel));
    const orphan = path.join(layout.root, "documents", "2025", "ff", "orphan.pdf");
    await fs.mkdir(path.dirname(orphan), { recursive: true });
    await fs.writeFile(orphan, "x");
    const r = await make();
    const codes = r.vaultWarnings.map((w) => w.code);
    expect(codes).toContain("document-missing");
    expect(codes).toContain("document-orphan");
    expect(r.verify!.problems.map((p) => p.code)).toContain("db-document-missing");
  });

  it("refuses to restore into a non-empty directory and leaves it untouched", async () => {
    const r = await make();
    const target = path.join(tmp, "existing");
    await fs.mkdir(target);
    await fs.writeFile(path.join(target, "keep.txt"), "mine");
    const res = await restoreBackup(r.file, key.identity, target, { maxSchemaVersion: 1 });
    expect(res.ok).toBe(false);
    expect(res.problems[0]?.code).toBe("target-not-empty");
    expect(await fs.readFile(path.join(target, "keep.txt"), "utf8")).toBe("mine");
  });

  it("restores into an existing empty directory", async () => {
    const r = await make();
    const target = path.join(tmp, "empty");
    await fs.mkdir(target);
    const res = await restoreBackup(r.file, key.identity, target, { maxSchemaVersion: 1 });
    expect(res.ok).toBe(true);
    await fs.access(path.join(target, "finance.db"));
  });

  it("refuses a backup with a newer schema version", async () => {
    db.exec("PRAGMA user_version = 7");
    const r = await make();
    expect(r.manifest.schemaVersion).toBe(7);
    const target = path.join(tmp, "newer");
    const res = await restoreBackup(r.file, key.identity, target, { maxSchemaVersion: 6 });
    expect(res.ok).toBe(false);
    expect(res.problems[0]?.code).toBe("schema-too-new");
    expect(res.problems[0]?.message).toMatch(/newer than this app supports/);
    await expect(fs.access(target)).rejects.toThrow();
    await expect(fs.access(`${target}.restoring`)).rejects.toThrow();
    expect((await restoreBackup(r.file, key.identity, target, { maxSchemaVersion: 7 })).ok).toBe(true);
  });

  it("restore with the wrong key creates nothing", async () => {
    const r = await make();
    const other = await generateVaultKey();
    const target = path.join(tmp, "wrongkey");
    const res = await restoreBackup(r.file, other.identity, target, { maxSchemaVersion: 1 });
    expect(res.ok).toBe(false);
    expect(res.report?.cannotDecrypt).toBe(true);
    await expect(fs.access(target)).rejects.toThrow();
    await expect(fs.access(`${target}.restoring`)).rejects.toThrow();
  });
});
