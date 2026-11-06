import { spawn } from "node:child_process";
import { KeyError, type KeyStore } from "./keys.ts";

// The macOS Keychain as a KeyStore (DESIGN §8.3 (a), D20), through the built-in
// `security` tool, so no dependency is added. The private key is never put on a
// command line, where any process could read it: saving goes through `security -i`,
// which reads its command from standard input.
//
// A key saved this way stays on this Mac; it does not sync through iCloud Keychain.
// Another Mac gets it through "Use this vault's key on this Mac" (D20).

export const KEYCHAIN_SERVICE = "FinShark backup";

/** Exit code of `security find-generic-password` / `delete-generic-password` when there is no such item. */
const NOT_FOUND = 44;

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs `security` with these arguments and this standard input. Injected in tests. */
export type RunSecurity = (args: string[], stdin: string) => Promise<RunResult>;

export const runSecurity: RunSecurity = (args, stdin) =>
  new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/security", args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (d: string) => (stdout += d));
    child.stderr.setEncoding("utf8").on("data", (d: string) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.stdin.end(stdin);
  });

// Both values end up inside a `security -i` command line, so only plain characters are allowed.
const VAULT_ID = /^[A-Za-z0-9-]{1,64}$/;
const IDENTITY = /^AGE-SECRET-KEY-1[A-Z0-9]+$/;

export class KeychainKeyStore implements KeyStore {
  private readonly run: RunSecurity;
  /** A keychain file to use instead of the default (login) keychain. Tests only. */
  private readonly keychain: string | null;

  constructor(opts: { run?: RunSecurity; keychain?: string } = {}) {
    this.run = opts.run ?? runSecurity;
    this.keychain = opts.keychain ?? null;
  }

  private account(vaultId: string): string {
    if (!VAULT_ID.test(vaultId)) throw new KeyError(`Bad vault id: ${vaultId}`);
    return vaultId;
  }

  private withKeychain(args: string[]): string[] {
    return this.keychain === null ? args : [...args, this.keychain];
  }

  async save(vaultId: string, identity: string): Promise<void> {
    const account = this.account(vaultId);
    if (!IDENTITY.test(identity)) throw new KeyError("Not an age private key");
    const keychain = this.keychain === null ? "" : ` "${this.keychain.replaceAll('"', "")}"`;
    const command = `add-generic-password -U -s "${KEYCHAIN_SERVICE}" -a "${account}" -w "${identity}"${keychain}\n`;
    const r = await this.run(["-i"], command);
    // `security -i` can exit 0 even when the command inside failed, so read the key back.
    if (r.code !== 0 || (await this.load(vaultId)) !== identity) {
      throw new KeyError(`Could not save the backup key in the Keychain${r.stderr.trim() ? `: ${r.stderr.trim()}` : ""}`);
    }
  }

  async load(vaultId: string): Promise<string | null> {
    const r = await this.run(this.withKeychain(["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", this.account(vaultId), "-w"]), "");
    if (r.code === NOT_FOUND) return null;
    if (r.code !== 0) throw new KeyError(`Could not read the backup key from the Keychain${r.stderr.trim() ? `: ${r.stderr.trim()}` : ""}`);
    return r.stdout.trim();
  }

  async remove(vaultId: string): Promise<void> {
    const r = await this.run(this.withKeychain(["delete-generic-password", "-s", KEYCHAIN_SERVICE, "-a", this.account(vaultId)]), "");
    if (r.code !== 0 && r.code !== NOT_FOUND) throw new KeyError(`Could not remove the backup key from the Keychain: ${r.stderr.trim()}`);
  }
}
