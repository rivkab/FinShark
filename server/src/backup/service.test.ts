import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createVault, openVault, type Vault } from "../vault/vault.ts";
import { MemoryKeyStore, generateVaultKey } from "./keys.ts";
import { BackupError, BackupService, CHANGE_DELAY_MS, KEY_FILE_NAME, backupWarnings, type BackupStatus, type Timers } from "./service.ts";

const VAULT_ID = "00000000-0000-4000-8000-000000000001";
const PASS = "a long enough passphrase";

let tmp: string;
let vault: Vault;
let keyStore: MemoryKeyStore;
let clock: Date;
let pending: { fn: () => void; ms: number } | null;
const timers: Timers = {
  set: (fn, ms) => (pending = { fn, ms }),
  clear: () => (pending = null),
};
const logs: string[] = [];

const service = (store = keyStore) =>
  new BackupService({
    db: vault.db,
    layout: vault.layout,
    vaultId: VAULT_ID,
    keyStore: store,
    now: () => clock,
    appVersion: "0.0.0-test",
    timers,
    scryptWorkFactor: 8,
    log: (m) => logs.push(m),
  });

const minute = (n: number) => (clock = new Date(clock.getTime() + n * 60_000));

async function setUp(svc: BackupService): Promise<string> {
  const { identity } = await svc.setup(PASS);
  await svc.confirm(identity.slice(-6));
  return identity;
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "finshark-backups-"));
  clock = new Date("2026-11-05T12:00:00.000Z");
  createVault(path.join(tmp, "vault"), { now: clock, vaultId: VAULT_ID });
  vault = openVault(path.join(tmp, "vault"));
  keyStore = new MemoryKeyStore();
  pending = null;
  logs.length = 0;
});
afterEach(() => {
  vault.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("BackupService setup", () => {
  it("warns until set up, and finishes setup only when the key's last characters are typed back", async () => {
    const svc = service();
    expect((await svc.status()).warnings.map((w) => w.code)).toEqual(["not_set_up"]);
    await expect(svc.setup("short")).rejects.toThrow(BackupError);

    const { identity, recipient, recoverySheet } = await svc.setup(PASS);
    expect(recoverySheet).toContain(identity);
    expect(fs.existsSync(path.join(vault.layout.backupsDir, KEY_FILE_NAME))).toBe(true);
    expect(await keyStore.load(VAULT_ID)).toBe(identity);
    let s = await svc.status();
    expect([s.setUp, s.awaitingConfirmation, s.recipient, s.keyOnThisMac]).toEqual([false, true, recipient, true]);

    await expect(svc.confirm("WRONG1")).rejects.toThrow(/last 6 characters/);
    await svc.confirm(identity.slice(-6).toLowerCase());
    s = await svc.status();
    expect([s.setUp, s.awaitingConfirmation]).toEqual([true, false]);
    await expect(svc.setup(PASS)).rejects.toThrow(/already set up/);
  });

  it("refuses to back up before setup is finished", async () => {
    const svc = service();
    await svc.setup(PASS);
    await expect(svc.backupNow()).rejects.toThrow(/Set up backups first/);
  });
});

describe("BackupService backups", () => {
  it("writes and verifies a backup, and refuses a second one in the same minute", async () => {
    const svc = service();
    await setUp(svc);
    const f = await svc.backupNow();
    expect(f.name).toBe("FinShark-2026-11-05T12-00.ffbackup");
    expect(f.verifyOk).toBe(true);
    expect(fs.existsSync(path.join(vault.layout.backupsDir, f.name))).toBe(true);
    expect((await svc.status()).warnings).toEqual([]);
    await expect(svc.backupNow()).rejects.toThrow(/less than a minute ago/);
  });

  it("without the key on this Mac, backs up unverified; importing the key verifies it on the next backup", async () => {
    await setUp(service());
    const otherMac = service(new MemoryKeyStore());
    let s = await otherMac.status();
    expect([s.setUp, s.keyOnThisMac]).toEqual([true, false]);
    const first = await otherMac.backupNow();
    expect(first.verifyOk).toBeNull();
    s = await otherMac.status();
    expect(s.warnings).toEqual([]); // unverified because the key is missing is not an alarm

    await expect(otherMac.importKey({ passphrase: "wrong passphrase" })).rejects.toThrow(/doesn't unlock/);
    await otherMac.importKey({ passphrase: PASS });
    expect((await otherMac.status()).keyOnThisMac).toBe(true);

    minute(24 * 60); // the next day, so retention keeps both
    await otherMac.backupNow();
    const files = (await otherMac.status()).files;
    expect(files.map((x) => [x.name, x.verifyOk])).toEqual([
      ["FinShark-2026-11-06T12-00.ffbackup", true],
      [first.name, true],
    ]);
  });

  it("accepts a pasted key only if it matches the vault's public key", async () => {
    const identity = await setUp(service());
    const otherMac = service(new MemoryKeyStore());
    await expect(otherMac.importKey({ identity: "not a key" })).rejects.toThrow(/AGE-SECRET-KEY-1/);
    await expect(otherMac.importKey({ identity: (await generateVaultKey()).identity })).rejects.toThrow(/different vault/);
    await otherMac.importKey({ identity: `  ${identity}\n` });
    expect((await otherMac.status()).keyOnThisMac).toBe(true);
  });

  it("copies backups and the key file to the second folder, and warns when it can't be reached", async () => {
    const svc = service();
    await setUp(svc);
    await svc.backupNow();
    const second = path.join(tmp, "synced");
    await expect(svc.setSecondDir(path.join(tmp, "missing"))).rejects.toThrow(/can't be reached/);
    fs.mkdirSync(second);
    await svc.setSecondDir(second);
    expect(fs.readdirSync(second).sort()).toEqual(["FinShark-2026-11-05T12-00.ffbackup", KEY_FILE_NAME]);

    fs.rmSync(second, { recursive: true });
    minute(1);
    const f = await svc.backupNow();
    expect(f.copyError).toMatch(/can't be reached/);
    expect((await svc.status()).warnings.map((w) => w.code)).toEqual(["second_folder"]);
  });

  it("refuses a second folder it may write to but not list, and a backup still succeeds if listing breaks later", async () => {
    const svc = service();
    await setUp(svc);
    await svc.backupNow();
    const second = path.join(tmp, "protected");
    fs.mkdirSync(second);
    fs.chmodSync(second, 0o300); // write and enter, but not list: like iCloud Drive under macOS privacy rules
    try {
      await expect(svc.setSecondDir(second)).rejects.toThrow(/isn't letting FinShark read/);
      fs.chmodSync(second, 0o700);
      await svc.setSecondDir(second);
      fs.chmodSync(second, 0o300);
      minute(24 * 60);
      const f = await svc.backupNow();
      expect(f.verifyOk).toBe(true);
      expect((await svc.status()).warnings.map((w) => w.code)).toEqual(["second_folder"]);
      expect(logs.some((l) => l.includes("could not remove old backups"))).toBe(true);
    } finally {
      fs.chmodSync(second, 0o700);
    }
  });

  it("saves the folder picked in the chooser, with the same checks, and does nothing on cancel", async () => {
    const picks: (string | null)[] = [null, path.join(tmp, "missing"), path.join(tmp, "picked")];
    const asked: { prompt: string; startIn: string | null }[] = [];
    const svc = new BackupService({
      db: vault.db, layout: vault.layout, vaultId: VAULT_ID, keyStore, now: () => clock, appVersion: "0.0.0-test", timers, scryptWorkFactor: 8, log: () => {},
      chooseFolder: async (o) => (asked.push(o), picks.shift() ?? null),
    });
    expect((await svc.status()).canChooseFolder).toBe(true);
    await setUp(svc);
    expect(await svc.chooseSecondDir()).toBe(false);
    expect((await svc.status()).secondDir).toBeNull();
    await expect(svc.chooseSecondDir()).rejects.toThrow(/can't be reached/);
    fs.mkdirSync(path.join(tmp, "picked"));
    expect(await svc.chooseSecondDir()).toBe(true);
    expect((await svc.status()).secondDir).toBe(path.join(tmp, "picked"));
    expect(await svc.chooseSecondDir()).toBe(false); // starts in the current folder
    expect(asked.at(-1)!.startIn).toBe(path.join(tmp, "picked"));
    expect((await service().status()).canChooseFolder).toBe(false);
  });

  it("keeps a GFS set, deletes only FinShark's files, and never the newest verified backup", async () => {
    const svc = service();
    await setUp(svc);
    const dir = vault.layout.backupsDir;
    // Two old backups in the same day: only the newer of the two is kept.
    fs.writeFileSync(path.join(dir, "FinShark-2026-11-01T08-00.ffbackup"), "x");
    fs.writeFileSync(path.join(dir, "FinShark-2026-11-01T09-00.ffbackup"), "x");
    // Far outside every window.
    fs.writeFileSync(path.join(dir, "FinShark-2020-01-01T00-00.ffbackup"), "x");
    fs.writeFileSync(path.join(dir, "notes.txt"), "mine");
    await svc.backupNow();
    expect(fs.readdirSync(dir).filter((n) => !n.startsWith(".")).sort()).toEqual([
      "FinShark-2026-11-01T09-00.ffbackup",
      "FinShark-2026-11-05T12-00.ffbackup",
      "notes.txt",
      KEY_FILE_NAME,
    ]);
  });
});

describe("BackupService schedule", () => {
  it("backs up 10 minutes after the last change, restarting the wait on each change", async () => {
    const svc = service();
    await setUp(svc);
    svc.markChanged();
    expect(pending?.ms).toBe(CHANGE_DELAY_MS);
    const first = pending;
    svc.markChanged();
    expect(pending).not.toBe(first);
    pending!.fn();
    await svc.idle();
    expect((await svc.status()).files).toHaveLength(1);
  });

  it("does nothing before setup", async () => {
    const svc = service();
    svc.markChanged();
    expect(pending).toBeNull();
    await svc.start();
    await svc.idle();
    expect((await svc.status()).files).toHaveLength(0);
  });

  it("on start, backs up if there is none, it is over a day old, or something changed since", async () => {
    const svc = service();
    await setUp(svc);
    const names = async () => (await svc.status()).files.map((f) => f.name);
    const restart = async () => {
      await svc.start();
      await svc.idle();
    };
    await restart();
    expect(await names()).toEqual(["FinShark-2026-11-05T12-00.ffbackup"]);

    minute(60);
    await restart();
    expect(await names()).toEqual(["FinShark-2026-11-05T12-00.ffbackup"]); // recent, nothing changed

    svc.markChanged(); // the app was closed before the 10 minutes were up
    svc.stop();
    minute(1);
    await restart();
    // Retention keeps the newest backup of the day.
    expect(await names()).toEqual(["FinShark-2026-11-05T13-01.ffbackup"]);

    minute(25 * 60);
    await restart();
    expect(await names()).toEqual(["FinShark-2026-11-06T14-01.ffbackup", "FinShark-2026-11-05T13-01.ffbackup"]);
  });

  it("records an automatic backup's failure as a warning", async () => {
    const svc = service();
    await setUp(svc);
    fs.chmodSync(vault.layout.backupsDir, 0o500);
    try {
      await svc.start();
      await svc.idle();
    } finally {
      fs.chmodSync(vault.layout.backupsDir, 0o700);
    }
    expect((await svc.status()).warnings.map((w) => w.code)).toContain("backup_failed");
  });
});

describe("backupWarnings", () => {
  const base: Omit<BackupStatus, "warnings"> = {
    setUp: true,
    awaitingConfirmation: false,
    recipient: "age1x",
    keyOnThisMac: true,
    keyMismatch: false,
    secondDir: null,
    secondDirProblem: null,
    canChooseFolder: false,
    running: false,
    lastError: null,
    files: [],
  };
  const file = (name: string, createdAt: string, over: Partial<BackupStatus["files"][number]> = {}) => ({
    name, createdAt, bytes: 1, verifiedAt: createdAt, verifyOk: true, problems: [], vaultWarnings: [], copiedAt: null, copyError: null, ...over,
  });
  const now = new Date("2026-11-20T00:00:00.000Z");

  it("flags a stale backup, failed verification and vault problems", () => {
    const files = [file("b", "2026-11-10T00:00:00.000Z", { vaultWarnings: [{ code: "document-missing", message: "m" }] }), file("a", "2026-11-01T00:00:00.000Z", { verifyOk: false })];
    expect(backupWarnings({ ...base, files }, now).map((w) => w.code)).toEqual(["stale", "verify_failed", "vault_problems"]);
  });

  it("is quiet for a recent, verified backup", () => {
    expect(backupWarnings({ ...base, files: [file("a", "2026-11-19T00:00:00.000Z")] }, now)).toEqual([]);
  });
});
