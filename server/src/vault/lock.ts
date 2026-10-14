import fs from "node:fs";

export interface VaultLock {
  release(): void;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM"; // exists, owned by someone else
  }
}

function readPid(file: string): number | null {
  try {
    const n = Number.parseInt(fs.readFileSync(file, "utf8").trim(), 10);
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/** Acquire the vault lock (file containing our PID). Takes over a stale lock. */
export function acquireLock(lockFile: string, pid: number = process.pid): VaultLock {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      fs.writeFileSync(lockFile, `${pid}\n`, { flag: "wx" });
      let released = false;
      return {
        release() {
          if (released) return;
          released = true;
          if (readPid(lockFile) === pid) fs.rmSync(lockFile, { force: true });
        },
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
    const holder = readPid(lockFile);
    if (holder !== null && isAlive(holder)) {
      throw new Error(
        `Vault is already open in another FinShark process (PID ${holder}). Close it first (lock file: ${lockFile}).`,
      );
    }
    // Stale (dead PID or unreadable contents): remove and retry atomic creation.
    fs.rmSync(lockFile, { force: true });
  }
  throw new Error(`Could not acquire vault lock ${lockFile}`);
}
