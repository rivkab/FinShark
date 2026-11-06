// Restore a backup into a NEW vault folder (DESIGN §8.2, D20):
//
//   npm run restore -- <file.ffbackup> <new-folder> [--vault-id <id>]
//
// The key comes from this Mac's Keychain (vault id from --vault-id, or from the vault in
// FINSHARK_VAULT), or else from vault-key.age next to the backup, unlocked with its passphrase.
// The current vault is never touched. Start FinShark on the result with FINSHARK_VAULT.

import fs from "node:fs/promises";
import path from "node:path";
import { SCHEMA_VERSION } from "../db/migrate.ts";
import { vaultLayout } from "../vault/layout.ts";
import { readVaultInfo } from "../vault/vault.ts";
import { KeychainKeyStore } from "./keychain.ts";
import { unwrapIdentity } from "./keys.ts";
import { restoreBackup } from "./restore.ts";
import { KEY_FILE_NAME } from "./service.ts";

function fail(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}

/** Read a line from the terminal without echoing it. */
function askHidden(prompt: string): Promise<string> {
  process.stdout.write(prompt);
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    return new Promise((resolve) => {
      let buf = "";
      stdin.setEncoding("utf8");
      stdin.on("data", (d: string) => (buf += d));
      stdin.on("end", () => resolve(buf.split("\n")[0] ?? ""));
    });
  }
  return new Promise((resolve) => {
    let buf = "";
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    stdin.resume();
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stdout.write("\n");
          resolve(buf);
          return;
        }
        if (ch === "\u0003") process.exit(130); // Ctrl-C
        if (ch === "\u007f") buf = buf.slice(0, -1);
        else buf += ch;
      }
    };
    stdin.on("data", onData);
  });
}

async function keychainIdentity(vaultId: string | null): Promise<string | null> {
  if (vaultId === null || process.platform !== "darwin") return null;
  try {
    return await new KeychainKeyStore().load(vaultId);
  } catch {
    return null;
  }
}

const args = process.argv.slice(2);
const idFlag = args.indexOf("--vault-id");
const vaultIdArg = idFlag >= 0 ? (args[idFlag + 1] ?? null) : null;
const positional = args.filter((_, i) => idFlag < 0 || (i !== idFlag && i !== idFlag + 1));
if (positional.length !== 2) fail("Usage: npm run restore -- <file.ffbackup> <new-folder> [--vault-id <id>]");
const file = path.resolve(positional[0]!);
const target = path.resolve(positional[1]!);

try {
  await fs.access(file);
} catch {
  fail(`No such backup file: ${file}`);
}

let vaultId = vaultIdArg;
if (vaultId === null && process.env["FINSHARK_VAULT"]) {
  try {
    vaultId = readVaultInfo(vaultLayout(process.env["FINSHARK_VAULT"])).vaultId;
  } catch {
    // no readable vault there; fall back to the key file
  }
}

let identity = await keychainIdentity(vaultId);
if (identity !== null) {
  console.log("Using the backup key from this Mac's Keychain.");
} else {
  const keyFile = path.join(path.dirname(file), KEY_FILE_NAME);
  let wrapped: Uint8Array;
  try {
    wrapped = await fs.readFile(keyFile);
  } catch {
    fail(
      `The key isn't in this Mac's Keychain${vaultId === null ? " (no vault id: pass --vault-id, or set FINSHARK_VAULT)" : ""}, ` +
        `and there is no ${KEY_FILE_NAME} next to the backup.\n` +
        `Put ${KEY_FILE_NAME} from the backup folder next to the file, or use the key on the recovery sheet:\n` +
        `  age -d -i key.txt ${path.basename(file)} | tar x`,
    );
  }
  const passphrase = await askHidden(`Passphrase for ${KEY_FILE_NAME}: `);
  try {
    identity = await unwrapIdentity(wrapped, passphrase);
  } catch {
    fail("That passphrase doesn't unlock the key file.");
  }
}

console.log(`Restoring ${path.basename(file)} into ${target} ...`);
const result = await restoreBackup(file, identity, target, { maxSchemaVersion: SCHEMA_VERSION });
if (!result.ok) {
  fail(`The backup was not restored:\n${result.problems.map((p) => `  - ${p.message}`).join("\n")}`);
}
console.log(`\nRestored and verified. Start FinShark on it with:\n\n  FINSHARK_VAULT=${target} npm start\n`);
