// FinShark launcher: binds 127.0.0.1 only, prints (and opens) the one-time login link.
//
// TODO(vault wiring): acquire the vault lock (DESIGN §7 / D1: refuse to start a second
// server on the same vault), open/migrate the DB, and pass handles to buildApp via
// `registerRoutes` / extra deps. Not wired yet; see server/src/vault and server/src/db.

import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { buildApp } from "./http/app.ts";
import { listenLoopback, LOOPBACK, pickFreePort } from "./http/listen.ts";

const envPort = process.env["FINSHARK_PORT"];
const port = envPort ? Number(envPort) : await pickFreePort();
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid FINSHARK_PORT: ${envPort}`);

const token = randomBytes(32).toString("base64url");
const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web/dist");

const app = buildApp({
  port,
  token,
  now: () => Date.now(),
  ...(existsSync(webDist) ? { staticDir: webDist } : {}),
});

await listenLoopback(app, port);

const link = `http://${LOOPBACK}:${port}/auth?token=${token}`;
console.log(`FinShark is running. Open this link in your browser:\n\n  ${link}\n`);
if (!existsSync(webDist)) console.log("(web/dist not built; in development use the Vite dev server, `npm run dev:web`.)");

if (process.env["FINSHARK_NO_OPEN"] !== "1" && process.platform === "darwin") {
  spawn("open", [link], { stdio: "ignore", detached: true }).unref();
}

const shutdown = () => void app.close().then(() => process.exit(0));
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
