// Test-only: a verified balance.ending fact for account 1, in ILS, without touching a database.
import type { Fact } from "../facts/types.ts";

let nextId = 1;

export function balanceFact(date: string, minor: bigint | null, over: Partial<Fact> = {}): Fact {
  return {
    id: nextId++,
    conceptId: "balance.ending",
    accountId: 1,
    personId: null,
    valueMinor: minor,
    valueDecimal: null,
    valueText: null,
    currency: "ILS",
    instantDate: date,
    periodStart: null,
    periodEnd: null,
    taxYear: null,
    dimensions: {},
    status: "verified",
    origin: "manual",
    extractionRunId: null,
    supersedesFactId: null,
    derivation: null,
    note: null,
    createdAt: "2026-01-01T00:00:00Z",
    createdBy: null,
    verifiedAt: null,
    verifiedBy: null,
    ...over,
  };
}
