import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeRealVault, type RealTestVault } from "../testing/test-vault.ts";
import { findRate, importTreasuryRates, parseCsv, parseTreasuryCsv, RateParseError, TREASURY_SOURCE } from "./index.ts";

// Fake data in the shape of the Treasury download (only the columns we read, plus one extra).
const HEADER = "record_date,country,currency,country_currency_desc,exchange_rate,effective_date";
const csv = (...rows: string[]) => [HEADER, ...rows].join("\n");
const ILS_2024 = "2024-12-31,Israel,Shekel,Israel-Shekel,3.647,2024-12-31";
const ILS_2025 = "2025-12-31,Israel,Shekel,Israel-Shekel,3.21,2025-12-31";
const EURO = '2025-12-31,"Euro Zone",Euro,"Euro Zone-Euro",0.85,2025-12-31';

describe("parseCsv", () => {
  it("handles quotes, escaped quotes, CRLF and a BOM", () => {
    expect(parseCsv('﻿a,"b,c","d""e"\r\nf,g,h\r\n')).toEqual([
      ["a", "b,c", 'd"e'],
      ["f", "g", "h"],
    ]);
  });
  it("rejects an unterminated quote", () => {
    expect(() => parseCsv('a,"b')).toThrow(RateParseError);
  });
});

describe("parseTreasuryCsv", () => {
  it("keeps the published rate string exactly and counts currencies it does not know", () => {
    const r = parseTreasuryCsv(csv(ILS_2024, EURO));
    expect(r.rates).toEqual([{ base: "USD", quote: "ILS", rate: "3.647", rateDate: "2024-12-31" }]);
    expect(r.skippedCurrencies).toBe(1);
  });
  it("rejects a file with the wrong columns, a bad date, or a non-positive rate", () => {
    expect(() => parseTreasuryCsv("a,b\n1,2")).toThrow(/Missing column/);
    expect(() => parseTreasuryCsv(csv("12/31/2024,Israel,Shekel,Israel-Shekel,3.6,"))).toThrow(/bad date/);
    expect(() => parseTreasuryCsv(csv("2024-12-31,Israel,Shekel,Israel-Shekel,0,2024-12-31"))).toThrow(/positive/);
    expect(() => parseTreasuryCsv(csv("2024-12-31,Israel,Shekel,Israel-Shekel,abc,2024-12-31"))).toThrow(/bad exchange_rate/);
  });
});

describe("the display-name header style of the real download", () => {
  const real = [
    '"Record Date","Country - Currency Description","Exchange Rate","Effective Date"',
    '"2026-09-30","Israel-Shekel","3.074","2026-09-30"',
    '"2026-03-31","Israel-Shekel","3.165","2026-03-31"',
    '"2026-03-31","Israel-Shekel","2.807","2026-05-29"',
    '"2025-12-31","Israel-Shekel","3.191","2025-12-31"',
  ].join("\n");

  it("reads quoted display headers and keys a mid-quarter republication by its effective date", () => {
    expect(parseTreasuryCsv(real).rates.map((r) => [r.rateDate, r.rate])).toEqual([
      ["2026-09-30", "3.074"],
      ["2026-03-31", "3.165"],
      ["2026-05-29", "2.807"],
      ["2025-12-31", "3.191"],
    ]);
  });
  it("falls back to the record date when there is no effective date column", () => {
    const r = parseTreasuryCsv("record_date,country_currency_desc,exchange_rate\n2025-12-31,Israel-Shekel,3.191");
    expect(r.rates[0]!.rateDate).toBe("2025-12-31");
  });
});

describe("importTreasuryRates / findRate", () => {
  let v: RealTestVault;
  beforeEach(async () => {
    v = await makeRealVault();
  });
  afterEach(async () => {
    await v.cleanup();
  });
  const deps = () => ({ db: v.vault.db, now: v.now });

  it("stores rates and finds them by exact date", () => {
    const res = importTreasuryRates(deps(), csv(ILS_2024, ILS_2025, EURO), "downloaded 2026-01-05");
    expect(res).toMatchObject({ added: 2, unchanged: 0, conflicts: [], skippedCurrencies: 1 });
    const r = findRate(v.vault.db, TREASURY_SOURCE, "USD", "ILS", "2025-12-31");
    expect(r).toMatchObject({ rate: "3.21", note: "downloaded 2026-01-05" });
  });

  it("returns null for a date with no published rate, with no nearest-date fallback", () => {
    importTreasuryRates(deps(), csv(ILS_2025));
    expect(findRate(v.vault.db, TREASURY_SOURCE, "USD", "ILS", "2025-12-30")).toBeNull();
    expect(findRate(v.vault.db, TREASURY_SOURCE, "USD", "ILS", "2026-12-31")).toBeNull();
  });

  it("is idempotent, and treats 3.21 and 3.210 as the same rate", () => {
    importTreasuryRates(deps(), csv(ILS_2025));
    const again = importTreasuryRates(deps(), csv("2025-12-31,Israel,Shekel,Israel-Shekel,3.210,2025-12-31"));
    expect(again).toMatchObject({ added: 0, unchanged: 1, conflicts: [] });
  });

  it("reports a different rate for a stored date and keeps the stored one", () => {
    importTreasuryRates(deps(), csv(ILS_2025));
    const res = importTreasuryRates(deps(), csv("2025-12-31,Israel,Shekel,Israel-Shekel,3.30,2025-12-31", ILS_2024));
    expect(res.added).toBe(1);
    expect(res.conflicts).toEqual([{ quote: "ILS", rateDate: "2025-12-31", stored: "3.21", incoming: "3.30" }]);
    expect(findRate(v.vault.db, TREASURY_SOURCE, "USD", "ILS", "2025-12-31")!.rate).toBe("3.21");
  });

  it("imports nothing when a later row is invalid", () => {
    expect(() => importTreasuryRates(deps(), csv(ILS_2024, "bad,Israel,Shekel,Israel-Shekel,3.6,"))).toThrow(RateParseError);
    expect(findRate(v.vault.db, TREASURY_SOURCE, "USD", "ILS", "2024-12-31")).toBeNull();
  });
});
