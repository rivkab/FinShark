import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkDatabase } from "../db/integrity.ts";
import { SCHEMA_VERSION } from "../db/migrate.ts";
import { VAULT_FORMAT_VERSION } from "./layout.ts";
import { acquireLock } from "./lock.ts";
import { createVault, openVault } from "./vault.ts";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "finshark-vault-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const opts = { now: new Date("2026-10-14T12:00:00.000Z"), vaultId: "00000000-0000-4000-8000-000000000001" };

describe("vault", () => {
  it("create/open round trip", () => {
    const root = path.join(tmp, "vault");
    const layout = createVault(root, opts);
    for (const d of [layout.documentsDir, layout.cacheDir, layout.inboxDir, layout.backupsDir]) {
      expect(fs.statSync(d).isDirectory()).toBe(true);
    }
    expect(fs.existsSync(layout.lockFile)).toBe(false);

    const v = openVault(root);
    try {
      expect(v.info).toEqual({
        formatVersion: VAULT_FORMAT_VERSION,
        vaultId: opts.vaultId,
        createdAt: "2026-10-14T12:00:00.000Z",
      });
      expect(fs.readFileSync(layout.lockFile, "utf8").trim()).toBe(String(process.pid));
      const report = checkDatabase(v.db);
      expect(report.ok).toBe(true);
      expect(report.schemaVersion).toBe(SCHEMA_VERSION);
      expect((v.db.prepare("PRAGMA journal_mode").get() as { journal_mode: string }).journal_mode).toBe("wal");
    } finally {
      v.close();
    }
    expect(fs.existsSync(layout.lockFile)).toBe(false);
    openVault(root).close(); // reopenable after close
  });

  it("createVault works in an existing empty directory but refuses a non-empty one", () => {
    const empty = path.join(tmp, "empty");
    fs.mkdirSync(empty);
    createVault(empty, opts);
    expect(() => createVault(empty, opts)).toThrow(/non-empty/);
  });

  it("openVault rejects a missing or wrong-format vault.json", () => {
    const root = path.join(tmp, "v");
    expect(() => openVault(root)).toThrow(/Not a FinShark vault/);
    const layout = createVault(root, opts);
    fs.writeFileSync(layout.infoFile, JSON.stringify({ formatVersion: 99, vaultId: "x", createdAt: "y" }));
    expect(() => openVault(root)).toThrow(/Unsupported vault format version 99/);
    expect(fs.existsSync(layout.lockFile)).toBe(false);
  });

  it("a second openVault fails while the first is open", () => {
    const root = path.join(tmp, "vault");
    createVault(root, opts);
    const first = openVault(root);
    try {
      expect(() => openVault(root)).toThrow(/already open/);
    } finally {
      first.close();
    }
    openVault(root).close();
  });

  it("takes over a stale lock", () => {
    const root = path.join(tmp, "vault");
    const layout = createVault(root, opts);
    fs.writeFileSync(layout.lockFile, "2147483646\n"); // no such process
    const v = openVault(root);
    expect(fs.readFileSync(layout.lockFile, "utf8").trim()).toBe(String(process.pid));
    v.close();
  });
});

describe("lock", () => {
  it("treats an unreadable lock file as stale and refuses a live holder", () => {
    const file = path.join(tmp, "x.lock");
    fs.writeFileSync(file, "garbage");
    const l = acquireLock(file);
    expect(() => acquireLock(file, process.pid + 1)).toThrow(/PID/);
    l.release();
    expect(fs.existsSync(file)).toBe(false);
  });
});
