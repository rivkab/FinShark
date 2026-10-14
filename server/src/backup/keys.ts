import fs from "node:fs/promises";
import path from "node:path";
import { Decrypter, Encrypter, generateX25519Identity, identityToRecipient } from "age-encryption";

// Key management for backups. See docs/DESIGN.md §8.3.
//
// Backups are encrypted to one or more age X25519 *recipients* (public keys), so
// creating a backup needs no secret. The *identity* (private key, "AGE-SECRET-KEY-1...")
// is only needed to verify or restore.

export interface VaultKey {
  /** Private key, `AGE-SECRET-KEY-1...`. Keep secret. */
  identity: string;
  /** Public key, `age1...`. Safe to store anywhere. */
  recipient: string;
}

export async function generateVaultKey(): Promise<VaultKey> {
  const identity = await generateX25519Identity();
  return { identity, recipient: await identityToRecipient(identity) };
}

export async function recipientOf(identity: string): Promise<string> {
  return identityToRecipient(identity);
}

export class KeyError extends Error {}

/** Default scrypt work factor of age (2^18). Tests pass a lower value. */
export const DEFAULT_SCRYPT_WORK_FACTOR = 18;

/**
 * Encrypt the private key with a passphrase (age scrypt mode). The result is a
 * standard age file (`age -d vault-key.age` prints the identity); store it as
 * `vault-key.age` next to the backups (DESIGN §8.3 (c)).
 */
export async function wrapIdentityWithPassphrase(
  identity: string,
  passphrase: string,
  opts: { workFactor?: number } = {},
): Promise<Uint8Array> {
  if (!identity.startsWith("AGE-SECRET-KEY-1")) throw new KeyError("Not an age X25519 identity");
  if (passphrase.length === 0) throw new KeyError("Passphrase must not be empty");
  const e = new Encrypter();
  e.setScryptWorkFactor(opts.workFactor ?? DEFAULT_SCRYPT_WORK_FACTOR);
  e.setPassphrase(passphrase);
  return e.encrypt(identity);
}

/** Inverse of {@link wrapIdentityWithPassphrase}. Throws {@link KeyError} on a wrong passphrase or damaged file. */
export async function unwrapIdentity(file: Uint8Array, passphrase: string): Promise<string> {
  const d = new Decrypter();
  d.addPassphrase(passphrase);
  let text: string;
  try {
    text = await d.decrypt(file, "text");
  } catch {
    throw new KeyError("Cannot unlock the key file: wrong passphrase, or the file is damaged");
  }
  const identity = text.trim();
  if (!identity.startsWith("AGE-SECRET-KEY-1")) throw new KeyError("Key file does not contain an age identity");
  return identity;
}

/**
 * Where the private key lives between uses.
 *
 * TODO: macOS Keychain implementation (DESIGN §8.3 (a)). Out of scope for now;
 * it should implement this interface so callers don't change.
 */
export interface KeyStore {
  save(vaultId: string, identity: string): Promise<void>;
  load(vaultId: string): Promise<string | null>;
  remove(vaultId: string): Promise<void>;
}

export class MemoryKeyStore implements KeyStore {
  private readonly keys = new Map<string, string>();
  async save(vaultId: string, identity: string): Promise<void> {
    this.keys.set(vaultId, identity);
  }
  async load(vaultId: string): Promise<string | null> {
    return this.keys.get(vaultId) ?? null;
  }
  async remove(vaultId: string): Promise<void> {
    this.keys.delete(vaultId);
  }
}

/** Plain files, mode 0600, in a directory. Weaker than the Keychain; for tests and fallback only. */
export class FileKeyStore implements KeyStore {
  private readonly dir: string;
  constructor(dir: string) {
    this.dir = dir;
  }
  private file(vaultId: string): string {
    if (!/^[A-Za-z0-9._-]+$/.test(vaultId) || vaultId.startsWith(".")) throw new KeyError(`Bad vault id: ${vaultId}`);
    return path.join(this.dir, `${vaultId}.key`);
  }
  async save(vaultId: string, identity: string): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
    await fs.writeFile(this.file(vaultId), identity + "\n", { mode: 0o600 });
  }
  async load(vaultId: string): Promise<string | null> {
    try {
      return (await fs.readFile(this.file(vaultId), "utf8")).trim();
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }
  async remove(vaultId: string): Promise<void> {
    await fs.rm(this.file(vaultId), { force: true });
  }
}
