import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FileKeyStore, KeyError, MemoryKeyStore, generateVaultKey, recipientOf, unwrapIdentity, wrapIdentityWithPassphrase } from "./keys.ts";
import { selectBackupsToDelete } from "./retention.ts";

describe("keys", () => {
  it("generates a matching identity/recipient pair", async () => {
    const k = await generateVaultKey();
    expect(k.identity).toMatch(/^AGE-SECRET-KEY-1/);
    expect(k.recipient).toMatch(/^age1/);
    expect(await recipientOf(k.identity)).toBe(k.recipient);
  });

  it("wraps and unwraps with a passphrase", async () => {
    const k = await generateVaultKey();
    const file = await wrapIdentityWithPassphrase(k.identity, "correct horse battery staple", { workFactor: 8 });
    expect(Buffer.from(file.subarray(0, 21)).toString()).toBe("age-encryption.org/v1");
    expect(await unwrapIdentity(file, "correct horse battery staple")).toBe(k.identity);
  });

  it("rejects a wrong passphrase", async () => {
    const k = await generateVaultKey();
    const file = await wrapIdentityWithPassphrase(k.identity, "right", { workFactor: 8 });
    await expect(unwrapIdentity(file, "wrong")).rejects.toThrow(KeyError);
  });

  it("key stores round trip", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "finshark-keys-"));
    try {
      for (const store of [new MemoryKeyStore(), new FileKeyStore(dir)]) {
        expect(await store.load("v1")).toBeNull();
        await store.save("v1", "AGE-SECRET-KEY-1X");
        expect(await store.load("v1")).toBe("AGE-SECRET-KEY-1X");
        await store.remove("v1");
        expect(await store.load("v1")).toBeNull();
      }
      await expect(new FileKeyStore(dir).save("../x", "k")).rejects.toThrow(KeyError);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("selectBackupsToDelete", () => {
  const at = (s: string, name = s) => ({ name, createdAt: new Date(s) });
  const now = new Date("2026-10-14T12:00:00Z"); // Wednesday

  it("keeps newest per day within the daily window", () => {
    const b = [at("2026-10-14T01:00:00Z", "a"), at("2026-10-14T09:00:00Z", "b"), at("2026-10-13T09:00:00Z", "c"), at("2026-10-12T09:00:00Z", "d")];
    expect(selectBackupsToDelete(b, { daily: 2, weekly: 0, monthly: 0 }, now)).toEqual(["a", "d"]);
  });

  it("keeps newest per ISO week (Monday start)", () => {
    // 2026-10-12 is Monday. Sun 10-11 belongs to the previous week.
    const b = [at("2026-10-11T09:00:00Z", "sun"), at("2026-10-05T09:00:00Z", "mon-prev"), at("2026-10-13T09:00:00Z", "tue"), at("2026-10-12T09:00:00Z", "mon")];
    expect(selectBackupsToDelete(b, { daily: 0, weekly: 2, monthly: 0 }, now)).toEqual(["mon", "mon-prev"]);
  });

  it("keeps newest per month and unions the rules", () => {
    const b = [
      at("2026-10-14T09:00:00Z", "today"),
      at("2026-09-30T09:00:00Z", "sep-late"),
      at("2026-09-02T09:00:00Z", "sep-early"),
      at("2026-08-15T09:00:00Z", "aug"),
      at("2026-06-15T09:00:00Z", "jun"),
    ];
    expect(selectBackupsToDelete(b, { daily: 1, weekly: 0, monthly: 3 }, now)).toEqual(["jun", "sep-early"]);
  });

  it("deletes everything outside all windows, keeps future-dated, handles empty", () => {
    expect(selectBackupsToDelete([], { daily: 7, weekly: 8, monthly: 24 }, now)).toEqual([]);
    const b = [at("2020-01-01T00:00:00Z", "old"), at("2027-01-01T00:00:00Z", "future")];
    expect(selectBackupsToDelete(b, { daily: 7, weekly: 8, monthly: 24 }, now)).toEqual(["old"]);
  });

  it("crosses year boundaries", () => {
    const jan = new Date("2027-01-05T00:00:00Z");
    const b = [at("2026-12-31T10:00:00Z", "dec31"), at("2026-12-01T10:00:00Z", "dec1")];
    expect(selectBackupsToDelete(b, { daily: 0, weekly: 0, monthly: 2 }, jan)).toEqual(["dec1"]);
    expect(selectBackupsToDelete(b, { daily: 0, weekly: 0, monthly: 1 }, jan)).toEqual(["dec1", "dec31"]);
  });
});
