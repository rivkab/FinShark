// Build FinShark.app, a double-clickable launcher for one vault (see applescript.ts):
//
//   FINSHARK_VAULT=~/FinShark-vault npm run make-app [-- --out <path/FinShark.app>]
//
// Uses macOS's built-in osacompile; nothing is installed. Run it again after moving the
// FinShark folder, the vault or Node. A rebuilt app may need its folder access granted again.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { vaultLayout } from "../vault/layout.ts";
import { appleScriptSource } from "./applescript.ts";

const BUNDLE_ID = "local.finshark.app";

function fail(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}

if (process.platform !== "darwin") fail("FinShark.app is for macOS.");
if (Number(process.versions.node.split(".")[0]) !== 24) fail(`Run this with Node 24 (this is ${process.versions.node}); \`nvm use\` first.`);
const vault = process.env["FINSHARK_VAULT"];
if (!vault) fail("Set FINSHARK_VAULT to the vault the app should open, e.g. FINSHARK_VAULT=~/FinShark-vault npm run make-app");
const vaultRoot = path.resolve(vault);
if (!existsSync(vaultLayout(vaultRoot).infoFile)) fail(`${vaultRoot} is not a FinShark vault (no vault.json).`);

const args = process.argv.slice(2);
const outFlag = args.indexOf("--out");
const out = path.resolve(outFlag >= 0 && args[outFlag + 1] ? args[outFlag + 1]! : "/Applications/FinShark.app");
if (!out.endsWith(".app")) fail("--out must end in .app");

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const source = appleScriptSource({
  repoRoot,
  nodeBinDir: path.dirname(process.execPath),
  vaultRoot,
  logFile: path.join(os.homedir(), "Library", "Logs", "FinShark.log"),
});

const tmp = mkdtempSync(path.join(os.tmpdir(), "finshark-app-"));
try {
  const script = path.join(tmp, "FinShark.applescript");
  writeFileSync(script, source);
  rmSync(out, { recursive: true, force: true });
  // -s: stay-open applet (it runs while FinShark runs, and quitting it stops FinShark).
  execFileSync("/usr/bin/osacompile", ["-s", "-o", out, script], { stdio: "inherit" });
  // osacompile names the program "applet" and sets no bundle identifier, so macOS would ask
  // "applet" for folder access. Name it FinShark, give it an identifier, and sign it again
  // (ad hoc, as osacompile does): the grant stays tied to this app's exact signature.
  const contents = path.join(out, "Contents");
  renameSync(path.join(contents, "MacOS", "applet"), path.join(contents, "MacOS", "FinShark"));
  const plist = path.join(contents, "Info.plist");
  for (const [key, value] of [
    ["CFBundleExecutable", "FinShark"],
    ["CFBundleIdentifier", BUNDLE_ID],
    ["CFBundleDisplayName", "FinShark"],
  ] as const) {
    execFileSync("/usr/bin/plutil", ["-replace", key, "-string", value, plist]);
  }
  execFileSync("/usr/bin/codesign", ["--force", "--sign", "-", out]);
  execFileSync("/usr/bin/codesign", ["--verify", "--strict", out]);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`\nMade ${out}\nIt opens ${vaultRoot}. Double-click it to start FinShark; quit it to stop FinShark.\n`);
