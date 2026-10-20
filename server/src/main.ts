// FinShark launcher: opens (or creates) the vault, binds 127.0.0.1 only, prints (and opens)
// the one-time login link. One server per vault (the vault lock refuses a second one).

import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { buildServer } from "./http/server.ts";
import { choosePort, DEFAULT_PORT, isLoopbackPortFree, listenLoopback, LOOPBACK } from "./http/listen.ts";
import { fillMissingLanguages } from "./documents/language.ts";
import { fillMissingPeriods } from "./documents/period.ts";
import { vaultLayout } from "./vault/layout.ts";
import { createVault, openVault } from "./vault/vault.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const vaultRoot = process.env["FINSHARK_VAULT"] ? path.resolve(process.env["FINSHARK_VAULT"]) : path.join(repoRoot, "dev-vault");

/** Print a plain message (no stack trace) and stop. */
function fail(message: string): never {
  console.error(`\nFinShark could not start: ${message}\n`);
  process.exit(1);
}

const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor !== 24) {
  fail(`it needs Node 24, but this is Node ${process.versions.node}. Run \`nvm use\` in the FinShark folder first.`);
}

// Open the vault before choosing a port: "already open" is the more useful message
// when another FinShark is running, and it releases nothing if it fails.
let vault;
try {
  if (!existsSync(vaultLayout(vaultRoot).infoFile)) {
    createVault(vaultRoot, { now: new Date(), vaultId: randomUUID() });
    console.log(`Created a new vault.`);
  }
  vault = openVault(vaultRoot);
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
}
console.log(`Vault: ${vault.layout.root} (id ${vault.info.vaultId})`);

let chosen;
try {
  chosen = await choosePort({ envPort: process.env["FINSHARK_PORT"], preferred: DEFAULT_PORT, isFree: isLoopbackPortFree });
} catch (e) {
  vault.close();
  fail(e instanceof Error ? e.message : String(e));
}
const port = chosen.port;
if (chosen.note) console.log(chosen.note);

const token = randomBytes(32).toString("base64url");
const webDist = path.join(repoRoot, "web/dist");

const app = buildServer({
  vault,
  port,
  token,
  now: () => new Date(),
  newId: () => randomUUID(),
  ...(existsSync(webDist) ? { staticDir: webDist } : {}),
});

let shuttingDown = false;
const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  void app
    .close()
    .catch(() => {})
    .finally(() => {
      vault.close();
      process.exit(0);
    });
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

try {
  await listenLoopback(app, port);
} catch (e) {
  vault.close();
  fail(e instanceof Error ? e.message : String(e));
}

// Documents imported before language detection existed: fill in what the text layer shows.
void fillMissingLanguages(vault)
  .then((n) => { if (n > 0) console.log(`Set the language of ${n} document${n === 1 ? "" : "s"} from their text.`); })
  .catch((e) => console.error(`Could not detect document languages: ${e instanceof Error ? e.message : String(e)}`));

void fillMissingPeriods(vault)
  .then((n) => { if (n > 0) console.log(`Set the period or tax year of ${n} document${n === 1 ? "" : "s"} from their text.`); })
  .catch((e) => console.error(`Could not read document periods: ${e instanceof Error ? e.message : String(e)}`));

const link = `http://${LOOPBACK}:${port}/auth?token=${token}`;
console.log(`FinShark is running at http://${LOOPBACK}:${port} — open this link to sign in:\n\n  ${link}\n`);
if (!existsSync(webDist)) console.log("(web/dist not built; in development use the Vite dev server, `npm run dev:web`.)");

if (process.env["FINSHARK_NO_OPEN"] !== "1" && process.platform === "darwin") {
  spawn("open", [link], { stdio: "ignore", detached: true }).unref();
}
