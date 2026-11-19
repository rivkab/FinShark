import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listFacts, listReviewQueue } from "../facts/queries.ts";
import { vaultLayout } from "../vault/layout.ts";
import { openVault, readVaultInfo } from "../vault/vault.ts";
import { DEV_SEED_NOW, DEV_VAULT_ID, formatMinor, seedDevVault } from "./seed.ts";

describe("formatMinor", () => {
  it("formats minor units with thousands separators", () => {
    expect(formatMinor(0n)).toBe("0.00");
    expect(formatMinor(5n)).toBe("0.05");
    expect(formatMinor(123_456_789n)).toBe("1,234,567.89");
    expect(formatMinor(-100_000n)).toBe("-1,000.00");
  });
});

describe("seedDevVault", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "finshark-seed-test-"));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function seed(name: string) {
    const work = path.join(dir, `${name}-work`);
    await fs.mkdir(work);
    const root = path.join(dir, name);
    const summary = await seedDevVault(root, { now: DEV_SEED_NOW, vaultId: DEV_VAULT_ID, workDir: work });
    return { root, summary };
  }

  it("creates a development vault with every case the UI shows", async () => {
    const { root, summary } = await seed("a");
    expect(readVaultInfo(vaultLayout(root)).dev).toBe(true);
    expect(summary).toMatchObject({ people: 2, institutions: 5, accounts: 6 });
    expect(summary.facts.proposed).toBe(2);

    const v = openVault(root);
    try {
      const all = listFacts(v.db);
      expect(all.filter((f) => f.fact.status === "verified")).toHaveLength(summary.facts.verified);
      // Every recorded number quotes the text in its box, i.e. its source really shows it.
      for (const f of all.filter((f) => f.fact.origin === "manual")) expect(f.sources[0]?.quotedText).toBeTruthy();
      expect(listReviewQueue(v.db)).toHaveLength(2);
      const rate = v.db.prepare("SELECT rate FROM exchange_rates WHERE rate_date = '2025-12-31'").get() as { rate: string };
      expect(rate.rate).toBe("3.65");
    } finally {
      v.close();
    }
  }, 60_000);

  it("is deterministic", async () => {
    const a = await seed("a");
    const b = await seed("b");
    const dump = (root: string) => {
      const v = openVault(root);
      try {
        return JSON.stringify(listFacts(v.db), (_k, x: unknown) => (typeof x === "bigint" ? x.toString() : x));
      } finally {
        v.close();
      }
    };
    expect(dump(b.root)).toBe(dump(a.root));
  }, 120_000);
});
