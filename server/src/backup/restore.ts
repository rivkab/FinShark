import fs from "node:fs/promises";
import path from "node:path";
import { DB_NAME, VAULT_INFO_NAME, type Manifest, type Problem } from "./format.ts";
import { analyzeBackup, type VerifyReport } from "./verify.ts";

export interface RestoreResult {
  ok: boolean;
  problems: Problem[];
  /** Absolute path of the restored vault when ok. */
  targetRoot: string | null;
  manifest: Manifest | null;
  report: VerifyReport | null;
}

function refuse(code: string, message: string): RestoreResult {
  return { ok: false, problems: [{ code, message }], targetRoot: null, manifest: null, report: null };
}

async function chmodTree(dir: string, fileMode: number, dirMode: number): Promise<void> {
  for (const ent of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      await chmodTree(full, fileMode, dirMode);
      await fs.chmod(full, dirMode);
    } else await fs.chmod(full, fileMode);
  }
}

/**
 * Restore a backup into a NEW vault directory. `targetRoot` must not exist or be
 * an empty directory; an existing vault is never touched. The archive is extracted
 * into `<targetRoot>.restoring`, fully verified (hashes, DB integrity, documents vs
 * rows), and only then renamed into place. Backups with a database schema newer
 * than `maxSchemaVersion` are refused. Content problems are returned, not thrown.
 *
 * Older-schema backups are restored as they are; the caller migrates afterwards.
 */
export async function restoreBackup(
  file: string,
  identity: string,
  targetRoot: string,
  opts: { maxSchemaVersion: number },
): Promise<RestoreResult> {
  const target = path.resolve(targetRoot);
  const staging = `${target}.restoring`;

  try {
    const st = await fs.stat(target);
    if (!st.isDirectory()) return refuse("target-not-empty", `${target} exists and is not a directory`);
    if ((await fs.readdir(target)).length > 0) {
      return refuse("target-not-empty", `${target} is not empty; restore only into a new or empty folder`);
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  try {
    await fs.lstat(staging);
    return refuse("staging-exists", `${staging} already exists (left by an earlier attempt?). Remove it and retry.`);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }

  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.mkdir(staging, { mode: 0o700 });
  try {
    const report = await analyzeBackup(file, identity, {
      extractTo: staging,
      extractAll: true,
      maxSchemaVersion: opts.maxSchemaVersion,
    });
    if (!report.ok) {
      await fs.rm(staging, { recursive: true, force: true });
      return { ok: false, problems: report.problems, targetRoot: null, manifest: report.manifest, report };
    }

    // Vault skeleton the app expects, then permissions.
    for (const d of ["cache", "inbox", "backups"]) await fs.mkdir(path.join(staging, d), { recursive: true });
    const docsDir = path.join(staging, "documents");
    await fs.mkdir(docsDir, { recursive: true });
    await chmodTree(docsDir, 0o444, 0o755);
    await fs.chmod(path.join(staging, DB_NAME), 0o600);
    await fs.chmod(path.join(staging, VAULT_INFO_NAME), 0o644);

    // An empty target directory may exist; rename replaces it on POSIX.
    await fs.rename(staging, target);
    return { ok: true, problems: [], targetRoot: target, manifest: report.manifest, report };
  } catch (e) {
    await chmodTree(staging, 0o600, 0o700).catch(() => {});
    await fs.rm(staging, { recursive: true, force: true });
    throw e;
  }
}
