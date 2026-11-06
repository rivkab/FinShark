import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { appleScriptSource, asString } from "./applescript.ts";

const config = {
  repoRoot: "/Users/a b/Projects/FinShark",
  nodeBinDir: "/Users/a b/.nvm/versions/node/v24.22.0/bin",
  vaultRoot: '/Users/a b/My "vault"',
  logFile: "/Users/a b/Library/Logs/FinShark.log",
};

describe("FinShark.app script", () => {
  it("escapes paths as AppleScript strings", () => {
    expect(asString('a "b" \\c')).toBe('"a \\"b\\" \\\\c"');
  });

  it("bakes in the paths and passes them to the shell quoted", () => {
    const src = appleScriptSource(config);
    expect(src).toContain('property vaultRoot : "/Users/a b/My \\"vault\\""');
    expect(src).toContain("quoted form of vaultRoot");
    expect(src).toContain("exec node server/src/main.ts");
  });

  // The applet must not wait for the server: only the subshell is backgrounded, detached from the applet's pipes.
  it.runIf(process.platform === "darwin")("returns the server's pid straight away", () => {
    const src = appleScriptSource(config);
    const shell = /set cmd to (.*?)\n  set serverPid/s.exec(src)![1]!;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "finshark-applet-"));
    try {
      // Same command shape, with a sleeping "server" in place of npm and node.
      const cmd = shell
        .replace("npm run build -w web -- --logLevel warn && exec node server/src/main.ts", "exec sleep 30");
      const script = `property repoRoot : ${JSON.stringify(dir)}
property nodeBinDir : "/usr/bin"
property vaultRoot : ${JSON.stringify(dir)}
property logFile : ${JSON.stringify(path.join(dir, "log"))}
set cmd to ${cmd}
return do shell script cmd`;
      const started = Date.now();
      const pid = execFileSync("/usr/bin/osascript", ["-e", script], { encoding: "utf8" }).trim();
      expect(Date.now() - started).toBeLessThan(10_000);
      expect(pid).toMatch(/^\d+$/);
      expect(execFileSync("/bin/ps", ["-o", "command=", "-p", pid], { encoding: "utf8" }).trim()).toBe("sleep 30");
      process.kill(Number(pid));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // Checks the generated AppleScript compiles; does not run it.
  it.runIf(process.platform === "darwin")("compiles with osacompile", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "finshark-applet-"));
    try {
      const script = path.join(dir, "FinShark.applescript");
      fs.writeFileSync(script, appleScriptSource(config));
      execFileSync("/usr/bin/osacompile", ["-s", "-o", path.join(dir, "FinShark.app"), script]);
      expect(fs.existsSync(path.join(dir, "FinShark.app", "Contents", "Info.plist"))).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
