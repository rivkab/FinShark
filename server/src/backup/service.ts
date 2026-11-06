import fs from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { checkDatabase } from "../db/integrity.ts";
import type { VaultLayout } from "../vault/layout.ts";
import { createBackup } from "./create.ts";
import { recoveryText, type Problem } from "./format.ts";
import { KeyError, generateVaultKey, recipientOf, unwrapIdentity, wrapIdentityWithPassphrase, type KeyStore } from "./keys.ts";
import { selectBackupsToDelete, type RetentionPolicy } from "./retention.ts";
import { verifyBackup } from "./verify.ts";

// Backups run from the app (DESIGN D20): setup, automatic and manual backups, verify,
// the second folder and retention. The backup format itself is create/verify/restore.
//
// There is no background service: while the app runs, a backup is made on start (if the
// last one is more than a day old, or something changed since), 10 minutes after the last
// change, and on demand. One backup runs at a time.

export const KEY_FILE_NAME = "vault-key.age";
export const MIN_PASSPHRASE_LENGTH = 10;
export const CHANGE_DELAY_MS = 10 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
export const STALE_AFTER_MS = 7 * DAY_MS;
export const RETENTION: RetentionPolicy = { daily: 7, weekly: 8, monthly: 24 };

/** Only files FinShark named are ever listed, copied or deleted. */
const BACKUP_NAME = /^FinShark-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})\.ffbackup$/;

export function backupTimeFromName(name: string): Date | null {
  const m = BACKUP_NAME.exec(name);
  return m ? new Date(`${m[1]}T${m[2]}:${m[3]}:00.000Z`) : null;
}

/** A problem the person can act on; the routes turn it into a 409. */
export class BackupError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const realTimers: Timers = {
  set: (fn, ms) => {
    const t = setTimeout(fn, ms);
    t.unref();
    return t;
  },
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export interface BackupServiceDeps {
  db: DatabaseSync;
  layout: VaultLayout;
  vaultId: string;
  keyStore: KeyStore;
  now: () => Date;
  appVersion: string;
  timers?: Timers;
  /** scrypt work factor for vault-key.age; tests pass a low one. */
  scryptWorkFactor?: number;
  log?: (message: string) => void;
}

export interface BackupFileInfo {
  name: string;
  createdAt: string;
  bytes: number;
  /** null = not yet verified. */
  verifiedAt: string | null;
  verifyOk: boolean | null;
  problems: Problem[];
  vaultWarnings: Problem[];
  copiedAt: string | null;
  copyError: string | null;
}

export type BackupWarningCode = "not_set_up" | "stale" | "verify_failed" | "vault_problems" | "second_folder" | "backup_failed";

export interface BackupWarning {
  code: BackupWarningCode;
  message: string;
}

export interface BackupStatus {
  /** Setup finished: key made and the recovery sheet confirmed. */
  setUp: boolean;
  /** A key was made but the recovery sheet is not confirmed yet. */
  awaitingConfirmation: boolean;
  recipient: string | null;
  /** This Mac's Keychain holds the private key that matches the vault's public key. */
  keyOnThisMac: boolean;
  /** The Keychain holds a key, but for a different public key. */
  keyMismatch: boolean;
  secondDir: string | null;
  secondDirProblem: string | null;
  running: boolean;
  lastError: string | null;
  /** Newest first. */
  files: BackupFileInfo[];
  warnings: BackupWarning[];
}

interface SettingsRow {
  recipient: string;
  created_at: string;
  confirmed_at: string | null;
  second_dir: string | null;
  changed_at: string | null;
}

interface FileRow {
  name: string;
  created_at: string;
  bytes: number;
  verified_at: string | null;
  verify_ok: number | null;
  problems_json: string;
  vault_warnings_json: string;
  copied_at: string | null;
  copy_error: string | null;
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Copy via `<dest>.partial` and rename, so a half-copied file never looks like a backup. */
async function copyAtomic(src: string, dest: string): Promise<void> {
  const partial = `${dest}.partial`;
  try {
    await fs.copyFile(src, partial);
    const h = await fs.open(partial, "r");
    try {
      await h.sync();
    } finally {
      await h.close();
    }
    await fs.rename(partial, dest);
  } catch (e) {
    await fs.rm(partial, { force: true });
    throw e;
  }
}

async function listBackupNames(dir: string): Promise<string[]> {
  try {
    return (await fs.readdir(dir)).filter((n) => BACKUP_NAME.test(n));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
}

/** Why a folder can't take backups, or null if it can. Writes and removes a probe file. */
export async function folderProblem(dir: string): Promise<string | null> {
  if (!path.isAbsolute(dir)) return "Give the full path of the folder.";
  try {
    const st = await fs.stat(dir);
    if (!st.isDirectory()) return `${dir} is not a folder.`;
  } catch {
    return `${dir} can't be reached (an unplugged drive, or a folder that was moved?).`;
  }
  // Listing is needed to remove old backups there. macOS can allow writing to a protected
  // folder (iCloud Drive, Documents, an external drive) but refuse listing it.
  try {
    await fs.readdir(dir);
  } catch (e) {
    return blockedMessage(dir, e, "read");
  }
  const probe = path.join(dir, `.finshark-probe-${process.pid}`);
  try {
    await fs.writeFile(probe, "");
    await fs.rm(probe);
  } catch (e) {
    return blockedMessage(dir, e, "write to");
  }
  return null;
}

function blockedMessage(dir: string, e: unknown, verb: string): string {
  const code = (e as NodeJS.ErrnoException).code;
  if (code === "EPERM" || code === "EACCES") {
    return (
      `macOS isn't letting FinShark ${verb} ${dir}. In System Settings > Privacy & Security > Files and Folders, ` +
      `allow the app FinShark was started from (such as Terminal) to use this folder, or give it Full Disk Access; then restart FinShark.`
    );
  }
  return `FinShark can't ${verb} ${dir}: ${e instanceof Error ? e.message : String(e)}`;
}

export class BackupService {
  private readonly d: BackupServiceDeps;
  private readonly timers: Timers;
  private running: Promise<BackupFileInfo> | null = null;
  private changeTimer: unknown = null;
  private lastError: string | null = null;
  /** Cached result of reading the Keychain; null = not read yet. */
  private keyState: { identity: string | null; mismatch: boolean } | null = null;

  constructor(deps: BackupServiceDeps) {
    this.d = deps;
    this.timers = deps.timers ?? realTimers;
  }

  // ---------------------------------------------------------------- state

  private settings(): SettingsRow | null {
    return (this.d.db.prepare("SELECT recipient, created_at, confirmed_at, second_dir, changed_at FROM backup_settings WHERE id = 1").get() as SettingsRow | undefined) ?? null;
  }

  private requireSetUp(): SettingsRow {
    const s = this.settings();
    if (!s || s.confirmed_at === null) throw new BackupError("not_set_up", "Set up backups first.");
    return s;
  }

  private log(message: string): void {
    (this.d.log ?? console.log)(message);
  }

  /** The private key on this Mac, if it matches the vault's public key. Never throws. */
  private async identity(): Promise<string | null> {
    const s = this.settings();
    if (!s) return null;
    if (this.keyState === null) {
      try {
        const id = await this.d.keyStore.load(this.d.vaultId);
        const matches = id !== null && (await recipientOf(id)) === s.recipient;
        this.keyState = { identity: matches ? id : null, mismatch: id !== null && !matches };
      } catch (e) {
        // A locked or unreadable Keychain: not cached, so the next call tries again.
        this.log(`Backups: could not read the key from the Keychain: ${e instanceof Error ? e.message : String(e)}`);
        return null;
      }
    }
    return this.keyState.identity;
  }

  private async files(): Promise<BackupFileInfo[]> {
    const names = new Set(await listBackupNames(this.d.layout.backupsDir));
    const rows = this.d.db.prepare("SELECT * FROM backup_files").all() as unknown as FileRow[];
    const byName = new Map(rows.map((r) => [r.name, r]));
    const out: BackupFileInfo[] = [];
    for (const name of names) {
      const r = byName.get(name);
      if (r) {
        out.push({
          name,
          createdAt: r.created_at,
          bytes: r.bytes,
          verifiedAt: r.verified_at,
          verifyOk: r.verify_ok === null ? null : r.verify_ok === 1,
          problems: JSON.parse(r.problems_json) as Problem[],
          vaultWarnings: JSON.parse(r.vault_warnings_json) as Problem[],
          copiedAt: r.copied_at,
          copyError: r.copy_error,
        });
      } else {
        // A backup file this vault has no record of (e.g. copied in by hand): listed, never trusted.
        const st = await fs.stat(path.join(this.d.layout.backupsDir, name));
        out.push({
          name,
          createdAt: backupTimeFromName(name)!.toISOString(),
          bytes: st.size,
          verifiedAt: null,
          verifyOk: null,
          problems: [],
          vaultWarnings: [],
          copiedAt: null,
          copyError: null,
        });
      }
    }
    return out.sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
  }

  async status(): Promise<BackupStatus> {
    const s = this.settings();
    const files = await this.files();
    const identity = await this.identity();
    const secondDirProblem = s?.second_dir ? await folderProblem(s.second_dir) : null;
    const status: BackupStatus = {
      setUp: s !== null && s.confirmed_at !== null,
      awaitingConfirmation: s !== null && s.confirmed_at === null,
      recipient: s?.recipient ?? null,
      keyOnThisMac: identity !== null,
      keyMismatch: this.keyState?.mismatch ?? false,
      secondDir: s?.second_dir ?? null,
      secondDirProblem,
      running: this.running !== null,
      lastError: this.lastError,
      files,
      warnings: [],
    };
    status.warnings = backupWarnings(status, this.d.now());
    return status;
  }

  // ---------------------------------------------------------------- setup

  /**
   * Make the vault's key pair, save the private key in the Keychain and as vault-key.age
   * (wrapped with the passphrase). Returns the private key once, for the recovery sheet.
   * Setup is finished by confirm(). Until then it can be started again (a new key).
   */
  async setup(passphrase: string): Promise<{ identity: string; recipient: string; recoverySheet: string }> {
    const s = this.settings();
    if (s?.confirmed_at) throw new BackupError("already_set_up", "Backups are already set up for this vault.");
    if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
      throw new BackupError("weak_passphrase", `Use a passphrase of at least ${MIN_PASSPHRASE_LENGTH} characters.`);
    }
    const key = await generateVaultKey();
    await this.d.keyStore.save(this.d.vaultId, key.identity);
    const wrapped = await wrapIdentityWithPassphrase(key.identity, passphrase, this.d.scryptWorkFactor === undefined ? {} : { workFactor: this.d.scryptWorkFactor });
    await fs.mkdir(this.d.layout.backupsDir, { recursive: true });
    const keyFile = path.join(this.d.layout.backupsDir, KEY_FILE_NAME);
    await fs.writeFile(`${keyFile}.partial`, wrapped, { mode: 0o600 });
    await fs.rename(`${keyFile}.partial`, keyFile);
    const now = this.d.now().toISOString();
    this.d.db
      .prepare(
        `INSERT INTO backup_settings (id, recipient, created_at, confirmed_at, second_dir, changed_at) VALUES (1, ?, ?, NULL, NULL, NULL)
         ON CONFLICT (id) DO UPDATE SET recipient = excluded.recipient, created_at = excluded.created_at, confirmed_at = NULL`,
      )
      .run(key.recipient, now);
    this.keyState = { identity: key.identity, mismatch: false };
    const recoverySheet = [
      `FinShark backup key`,
      ``,
      `Vault id:     ${this.d.vaultId}`,
      `Private key:  ${key.identity}`,
      `Public key:   ${key.recipient}`,
      ``,
      recoveryText({ createdAt: now, vaultId: this.d.vaultId, appVersion: this.d.appVersion }),
    ].join("\n");
    return { identity: key.identity, recipient: key.recipient, recoverySheet };
  }

  /** Finish setup: the person typed back the last 6 characters of the key from the recovery sheet. */
  async confirm(lastChars: string): Promise<void> {
    const s = this.settings();
    if (!s) throw new BackupError("not_set_up", "Set up backups first.");
    if (s.confirmed_at) return;
    const identity = await this.identity();
    if (identity === null) throw new BackupError("no_key", "The key isn't in this Mac's Keychain. Start setup again.");
    if (lastChars.trim().toUpperCase() !== identity.slice(-6)) {
      throw new BackupError("wrong_characters", "Those aren't the last 6 characters of the key on the recovery sheet.");
    }
    this.d.db.prepare("UPDATE backup_settings SET confirmed_at = ? WHERE id = 1").run(this.d.now().toISOString());
  }

  /**
   * "Use this vault's key on this Mac": from the vault-key.age passphrase or the key on
   * the recovery sheet. Accepted only if it matches the vault's public key.
   */
  async importKey(input: { passphrase: string } | { identity: string }): Promise<void> {
    const s = this.requireSetUp();
    let identity: string;
    if ("identity" in input) {
      identity = input.identity.trim();
      if (!identity.startsWith("AGE-SECRET-KEY-1")) throw new BackupError("bad_key", "That isn't a FinShark backup key. It starts with AGE-SECRET-KEY-1.");
    } else {
      const candidates = [this.d.layout.backupsDir, ...(s.second_dir ? [s.second_dir] : [])].map((d) => path.join(d, KEY_FILE_NAME));
      let file: Uint8Array | null = null;
      for (const c of candidates) {
        try {
          file = await fs.readFile(c);
          break;
        } catch {
          // try the next folder
        }
      }
      if (file === null) throw new BackupError("no_key_file", `No ${KEY_FILE_NAME} was found in the backup folders. Paste the key from the recovery sheet instead.`);
      try {
        identity = await unwrapIdentity(file, input.passphrase);
      } catch (e) {
        if (e instanceof KeyError) throw new BackupError("wrong_passphrase", "That passphrase doesn't unlock the key file.");
        throw e;
      }
    }
    let recipient: string;
    try {
      recipient = await recipientOf(identity);
    } catch {
      throw new BackupError("bad_key", "That key is not valid. Check it against the recovery sheet.");
    }
    if (recipient !== s.recipient) throw new BackupError("wrong_key", "That key belongs to a different vault or an earlier setup.");
    await this.d.keyStore.save(this.d.vaultId, identity);
    this.keyState = { identity, mismatch: false };
  }

  /** Set (or clear, with null) the second backup folder, and copy the key file and the newest backup there. */
  async setSecondDir(dir: string | null): Promise<void> {
    this.requireSetUp();
    if (dir !== null) {
      const problem = await folderProblem(dir);
      if (problem) throw new BackupError("bad_folder", problem);
      if (path.resolve(dir) === path.resolve(this.d.layout.backupsDir)) {
        throw new BackupError("bad_folder", "Choose a folder other than the vault's own backups folder.");
      }
    }
    this.d.db.prepare("UPDATE backup_settings SET second_dir = ? WHERE id = 1").run(dir === null ? null : path.resolve(dir));
    if (dir !== null) {
      const newest = (await this.files())[0];
      if (newest) await this.copyToSecond(newest.name);
    }
  }

  // ---------------------------------------------------------------- backups

  /** Copy one backup (and vault-key.age, if missing there) to the second folder; records the outcome. */
  private async copyToSecond(name: string): Promise<void> {
    const dir = this.settings()?.second_dir;
    if (!dir) return;
    const record = this.d.db.prepare("UPDATE backup_files SET copied_at = ?, copy_error = ? WHERE name = ?");
    try {
      const problem = await folderProblem(dir);
      if (problem) throw new Error(problem);
      const keyFile = path.join(this.d.layout.backupsDir, KEY_FILE_NAME);
      const keyDest = path.join(dir, KEY_FILE_NAME);
      if ((await exists(keyFile)) && !(await exists(keyDest))) await copyAtomic(keyFile, keyDest);
      const dest = path.join(dir, name);
      if (!(await exists(dest))) await copyAtomic(path.join(this.d.layout.backupsDir, name), dest);
      record.run(this.d.now().toISOString(), null, name);
    } catch (e) {
      record.run(null, e instanceof Error ? e.message : String(e), name);
    }
  }

  private recordVerify(name: string, ok: boolean, problems: Problem[]): void {
    this.d.db
      .prepare("UPDATE backup_files SET verified_at = ?, verify_ok = ?, problems_json = ? WHERE name = ?")
      .run(this.d.now().toISOString(), ok ? 1 : 0, JSON.stringify(problems), name);
  }

  /** Verify one backup now (§8.2). Needs the key on this Mac. */
  async verify(name: string): Promise<BackupFileInfo> {
    this.requireSetUp();
    if (!BACKUP_NAME.test(name)) throw new BackupError("not_found", "No such backup.");
    const file = path.join(this.d.layout.backupsDir, name);
    if (!(await exists(file))) throw new BackupError("not_found", "No such backup.");
    const identity = await this.identity();
    if (identity === null) throw new BackupError("no_key", "This Mac doesn't have the backup key, so it can't verify backups.");
    const st = await fs.stat(file);
    this.d.db
      .prepare("INSERT INTO backup_files (name, created_at, bytes) VALUES (?, ?, ?) ON CONFLICT (name) DO NOTHING")
      .run(name, backupTimeFromName(name)!.toISOString(), st.size);
    const report = await verifyBackup(file, identity);
    this.recordVerify(name, report.ok, report.problems);
    return (await this.files()).find((f) => f.name === name)!;
  }

  /** Back up now. If a backup is already running, waits for that one instead of starting another. */
  backupNow(): Promise<BackupFileInfo> {
    if (this.running) return this.running;
    const run = this.runBackup().finally(() => {
      this.running = null;
    });
    this.running = run;
    return run;
  }

  private async runBackup(): Promise<BackupFileInfo> {
    const s = this.requireSetUp();
    const now = this.d.now();
    const identity = await this.identity();
    const result = await createBackup({
      layout: this.d.layout,
      db: this.d.db,
      now: () => now,
      recipients: [s.recipient],
      outDir: this.d.layout.backupsDir,
      appVersion: this.d.appVersion,
      preflight: () => {
        const report = checkDatabase(this.d.db);
        if (!report.ok) throw new BackupError("vault_check_failed", `The vault check failed, so no backup was made: ${[...report.integrityCheck, ...report.foreignKeyViolations.map((v) => `${v.table} row ${v.rowid} -> ${v.parent}`)].join("; ")}`);
      },
      ...(identity !== null ? { verifyIdentity: identity } : {}),
    }).catch((e: unknown) => {
      if (e instanceof Error && /^Backup already exists/.test(e.message)) {
        throw new BackupError("too_soon", "A backup was made less than a minute ago. Try again in a minute.");
      }
      throw e;
    });
    const name = path.basename(result.file);
    this.d.db
      .prepare(
        `INSERT INTO backup_files (name, created_at, bytes, verified_at, verify_ok, problems_json, vault_warnings_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        name,
        result.manifest.createdAt,
        result.bytes,
        result.verify ? this.d.now().toISOString() : null,
        result.verify ? (result.verify.ok ? 1 : 0) : null,
        JSON.stringify(result.verify?.problems ?? []),
        JSON.stringify(result.vaultWarnings),
      );
    await this.copyToSecond(name);

    // Backups written while the key was unavailable are verified now that it is.
    if (identity !== null) {
      for (const f of await this.files()) {
        if (f.verifiedAt === null && f.name !== name) {
          const report = await verifyBackup(path.join(this.d.layout.backupsDir, f.name), identity);
          this.recordVerify(f.name, report.ok, report.problems);
        }
      }
    }
    await this.applyRetention();
    this.lastError = null;
    return (await this.files()).find((f) => f.name === name)!;
  }

  /** GFS retention in each folder. Never deletes the newest verified backup. */
  private async applyRetention(): Promise<void> {
    const files = await this.files();
    const newestVerified = files.find((f) => f.verifyOk === true)?.name ?? null;
    const dirs = [this.d.layout.backupsDir, this.settings()?.second_dir ?? null];
    for (const dir of dirs) {
      if (dir === null) continue;
      // Removing old backups is housekeeping: if it fails, the new backup still stands.
      // A second folder that can't be listed is reported by status() as a warning.
      try {
        const refs = (await listBackupNames(dir)).map((name) => ({ name, createdAt: backupTimeFromName(name)! }));
        for (const name of selectBackupsToDelete(refs, RETENTION, this.d.now())) {
          if (name === newestVerified) continue;
          await fs.rm(path.join(dir, name), { force: true });
          if (dir === this.d.layout.backupsDir) this.d.db.prepare("DELETE FROM backup_files WHERE name = ?").run(name);
        }
      } catch (e) {
        this.log(`Backups: could not remove old backups in ${dir}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  // ---------------------------------------------------------------- schedule

  private automatic(reason: string): void {
    if (!this.settings()?.confirmed_at) return;
    this.backupNow().then(
      (f) => this.log(`Backed up (${reason}): ${f.name}${f.verifyOk === null ? " (not yet verified: the key isn't available)" : ""}`),
      (e: unknown) => {
        this.lastError = e instanceof Error ? e.message : String(e);
        this.log(`Backup failed (${reason}): ${this.lastError}`);
      },
    );
  }

  /** On start: back up if the last backup is more than a day old, or something changed since it. */
  async start(): Promise<void> {
    const s = this.settings();
    if (!s?.confirmed_at) return;
    const newest = (await this.files())[0];
    const now = this.d.now().getTime();
    if (!newest) return this.automatic("first backup");
    if (now - Date.parse(newest.createdAt) > DAY_MS) return this.automatic("last backup over a day old");
    if (s.changed_at !== null && s.changed_at > newest.createdAt) return this.automatic("changes since the last backup");
  }

  /** Something changed through the app: back up 10 minutes after the last change. */
  markChanged(): void {
    if (!this.settings()?.confirmed_at) return;
    this.d.db.prepare("UPDATE backup_settings SET changed_at = ? WHERE id = 1").run(this.d.now().toISOString());
    if (this.changeTimer !== null) this.timers.clear(this.changeTimer);
    this.changeTimer = this.timers.set(() => {
      this.changeTimer = null;
      this.automatic("after changes");
    }, CHANGE_DELAY_MS);
  }

  stop(): void {
    if (this.changeTimer !== null) this.timers.clear(this.changeTimer);
    this.changeTimer = null;
  }

  /** Waits for a running backup (for shutdown and tests). */
  async idle(): Promise<void> {
    await this.running?.catch(() => {});
  }
}

/**
 * What must be shown on every page (DESIGN D20). A missing key on this Mac is not one:
 * the Backups page explains it, and unverified backups are expected until the key is added.
 */
export function backupWarnings(s: Omit<BackupStatus, "warnings">, now: Date): BackupWarning[] {
  const w: BackupWarning[] = [];
  if (!s.setUp) {
    w.push({ code: "not_set_up", message: "This vault has no backups yet. Set them up on the Backups page." });
    return w;
  }
  if (s.lastError) w.push({ code: "backup_failed", message: `The last backup failed: ${s.lastError}` });
  const newest = s.files[0];
  if (!newest) {
    if (!s.running) w.push({ code: "stale", message: "There is no backup of this vault yet." });
  } else if (now.getTime() - Date.parse(newest.createdAt) > STALE_AFTER_MS) {
    w.push({ code: "stale", message: `The last backup is more than 7 days old (${newest.createdAt.slice(0, 10)}).` });
  }
  const failed = s.files.filter((f) => f.verifyOk === false);
  if (failed.length > 0) {
    w.push({ code: "verify_failed", message: `${failed.length === 1 ? "A backup" : `${failed.length} backups`} failed verification: ${failed.map((f) => f.name).join(", ")}.` });
  }
  if (newest && newest.vaultWarnings.length > 0) {
    w.push({ code: "vault_problems", message: `The vault check found ${newest.vaultWarnings.length} problem${newest.vaultWarnings.length === 1 ? "" : "s"} when the last backup was made.` });
  }
  if (s.secondDir !== null) {
    if (s.secondDirProblem) w.push({ code: "second_folder", message: `Backups aren't reaching the second folder: ${s.secondDirProblem}` });
    else if (newest?.copyError) w.push({ code: "second_folder", message: `The last backup wasn't copied to the second folder: ${newest.copyError}` });
  }
  return w;
}

