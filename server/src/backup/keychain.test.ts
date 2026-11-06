import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { KeychainKeyStore, type RunSecurity } from "./keychain.ts";
import { generateVaultKey, KeyError } from "./keys.ts";

describe("KeychainKeyStore", () => {
  it("passes the key on standard input, never as an argument", async () => {
    const calls: { args: string[]; stdin: string }[] = [];
    let stored: string | null = null;
    const run: RunSecurity = async (args, stdin) => {
      calls.push({ args, stdin });
      if (args[0] === "-i") {
        stored = /-w "([^"]+)"/.exec(stdin)![1]!;
        return { code: 0, stdout: "", stderr: "" };
      }
      return stored === null ? { code: 44, stdout: "", stderr: "not found" } : { code: 0, stdout: `${stored}\n`, stderr: "" };
    };
    const store = new KeychainKeyStore({ run });
    const { identity } = await generateVaultKey();
    await store.save("vault-1", identity);
    expect(await store.load("vault-1")).toBe(identity);
    for (const c of calls) expect(c.args.join(" ")).not.toContain(identity);
    expect(calls[0]!.stdin).toContain(`-s "FinShark backup" -a "vault-1"`);
  });

  it("returns null when there is no key, and fails if the key did not stick", async () => {
    const run: RunSecurity = async () => ({ code: 44, stdout: "", stderr: "" });
    const store = new KeychainKeyStore({ run });
    expect(await store.load("vault-1")).toBeNull();
    const { identity } = await generateVaultKey();
    await expect(store.save("vault-1", identity)).rejects.toThrow(KeyError);
  });

  it("refuses values that could change the command", async () => {
    const store = new KeychainKeyStore({ run: async () => ({ code: 0, stdout: "", stderr: "" }) });
    await expect(store.load('x" -s "other')).rejects.toThrow(KeyError);
    await expect(store.save("vault-1", 'AGE-SECRET-KEY-1A" -w "B')).rejects.toThrow(KeyError);
  });

  // Against a real, throwaway keychain file; never the login keychain.
  it.runIf(process.platform === "darwin")("round trips through a real keychain", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "finshark-keychain-"));
    const keychain = path.join(dir, "test.keychain-db");
    execFileSync("/usr/bin/security", ["create-keychain", "-p", "test", keychain]);
    try {
      execFileSync("/usr/bin/security", ["unlock-keychain", "-p", "test", keychain]);
      const store = new KeychainKeyStore({ keychain });
      const { identity } = await generateVaultKey();
      expect(await store.load("vault-1")).toBeNull();
      await store.save("vault-1", identity);
      expect(await store.load("vault-1")).toBe(identity);
      await store.remove("vault-1");
      expect(await store.load("vault-1")).toBeNull();
    } finally {
      execFileSync("/usr/bin/security", ["delete-keychain", keychain]);
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
