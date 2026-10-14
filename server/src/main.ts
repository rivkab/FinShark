// FinShark launcher: opens (or creates) the vault, binds 127.0.0.1 only, prints (and opens)
// the one-time login link. One server per vault (the vault lock refuses a second one).

import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { buildServer } from "./http/server.ts";
import { choosePort, DEFAULT_PORT, isLoopbackPortFree, listenLoopback, LOOPBACK } from "./http/listen.ts";
import { vaultLayout } from "./vault/layout.ts";
import { createVault, openVault } from "./vault/vault.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const vaultRoot = process.env["FINSHARK_VAULT"] ? path.resolve(process.env["FINSHARK_VAULT"]) : path.join(repoRoot, "dev-vault");

let chosen;
try {
  chosen = await choosePort({ envPort: process.env["FINSHARK_PORT"], preferred: DEFAULT_PORT, isFree: isLoopbackPortFree });
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
const port = chosen.port;
if (chosen.note) console.log(chosen.note);

if (!existsSync(vaultLayout(vaultRoot).infoFile)) {
  createVault(vaultRoot, { now: new Date(), vaultId: randomUUID() });
  console.log(`Created a new vault.`);
}
const vault = openVault(vaultRoot);
console.log(`Vault: ${vault.layout.root} (id ${vault.info.vaultId})`);

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
  throw e;
}

const link = `http://${LOOPBACK}:${port}/auth?token=${token}`;
console.log(`FinShark is running at http://${LOOPBACK}:${port} — open this link to sign in:\n\n  ${link}\n`);
if (!existsSync(webDist)) console.log("(web/dist not built; in development use the Vite dev server, `npm run dev:web`.)");

if (process.env["FINSHARK_NO_OPEN"] !== "1" && process.platform === "darwin") {
  spawn("open", [link], { stdio: "ignore", detached: true }).unref();
}
