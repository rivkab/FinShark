// Create a development vault full of generated data (DESIGN D22):
//
//   npm run seed-dev                    # replaces <repo>/dev-vault
//   npm run seed-dev -- --vault <path>  # or another path
//
// An existing vault is only replaced if it is a development vault (vault.json "dev": true,
// or the default dev-vault/), and only while no FinShark has it open. Anything else is refused.

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { vaultLayout } from "../vault/layout.ts";
import { acquireLock } from "../vault/lock.ts";
import { readVaultInfo } from "../vault/vault.ts";
import { DEV_SEED_NOW, DEV_VAULT_ID, seedDevVault } from "./seed.ts";

function fail(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const defaultDevVault = path.join(repoRoot, "dev-vault");

const args = process.argv.slice(2);
const vaultFlag = args.indexOf("--vault");
if (vaultFlag >= 0 && !args[vaultFlag + 1]) fail("--vault needs a path.");
const root = vaultFlag >= 0 ? path.resolve(args[vaultFlag + 1]!) : defaultDevVault;
const layout = vaultLayout(root);

if (fs.existsSync(root) && fs.readdirSync(root).length > 0) {
  if (!fs.existsSync(layout.infoFile)) fail(`${root} is not empty and is not a FinShark vault. Nothing was changed.`);
  let isDev = root === defaultDevVault;
  try {
    isDev ||= readVaultInfo(layout).dev === true;
  } catch (e) {
    fail(`${root}: ${(e as Error).message} Nothing was changed.`);
  }
  if (!isDev) fail(`${root} is not a development vault, so it was not replaced. Nothing was changed.`);
  // Fails if a FinShark has it open; held until the folder is gone.
  let lock;
  try {
    lock = acquireLock(layout.lockFile);
  } catch (e) {
    fail(`${(e as Error).message} Nothing was changed.`);
  }
  lock.release();
  fs.rmSync(root, { recursive: true, force: true });
  console.log(`Removed the old development vault at ${root}.`);
}

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "finshark-seed-"));
try {
  // The default dev vault keeps one id, so its backup key in the Keychain is reused across reseeds.
  const vaultId = root === defaultDevVault ? DEV_VAULT_ID : randomUUID();
  const summary = await seedDevVault(root, { now: DEV_SEED_NOW, vaultId, workDir });
  console.log(
    `Created a development vault at ${root}:\n` +
      `  ${summary.people} people, ${summary.institutions} institutions, ${summary.accounts} accounts, ` +
      `${summary.documents} documents, ${summary.facts.verified} verified and ${summary.facts.proposed} unverified numbers.\n\n` +
      (root === defaultDevVault ? "  npm run dev:server   (or npm start)\n" : `  FINSHARK_VAULT=${root} npm run dev:server\n`),
  );
} catch (e) {
  fs.rmSync(root, { recursive: true, force: true });
  fail(`Could not create the development vault: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
} finally {
  fs.rmSync(workDir, { recursive: true, force: true });
}
