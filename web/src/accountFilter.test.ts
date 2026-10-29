import { describe, expect, it } from "vitest";
import type { AccountDto } from "@finshark/shared";
import { NO_FILTERS, NO_TYPE, filterAccounts, hasFilters } from "./accountFilter.ts";

function acct(id: number, p: Partial<AccountDto>): AccountDto {
  return {
    id, institutionId: 1, institutionName: "Bank", displayName: `Acct ${id}`, altName: null, country: "US", language: "en",
    nativeCurrency: "USD", openedOn: null, closedOn: null, statementCadence: null, accountType: null, notes: null, accountNumber: null,
    identifiers: [], owners: [], ...p,
  };
}
const ids = (l: AccountDto[]) => l.map((a) => a.id);
const today = "2026-10-29";

describe("filterAccounts", () => {
  const l = [
    acct(1, { institutionId: 1, accountType: "checking", owners: [{ personId: 1, role: "owner", share: null }] }),
    acct(2, { institutionId: 2, nativeCurrency: "ILS", closedOn: "2025-01-01" }),
    acct(3, { institutionId: 1, accountType: "checking", closedOn: "2027-01-01", owners: [{ personId: 2, role: "owner", share: null }] }),
  ];

  it("returns everything with no filters", () => {
    expect(ids(filterAccounts(l, NO_FILTERS, today))).toEqual([1, 2, 3]);
    expect(hasFilters(NO_FILTERS)).toBe(false);
  });

  it("filters by institution, owner and currency", () => {
    expect(ids(filterAccounts(l, { ...NO_FILTERS, institutionId: "1" }, today))).toEqual([1, 3]);
    expect(ids(filterAccounts(l, { ...NO_FILTERS, ownerId: "2" }, today))).toEqual([3]);
    expect(ids(filterAccounts(l, { ...NO_FILTERS, currency: "ILS" }, today))).toEqual([2]);
  });

  it("filters by type, including accounts with none set", () => {
    expect(ids(filterAccounts(l, { ...NO_FILTERS, type: "checking" }, today))).toEqual([1, 3]);
    expect(ids(filterAccounts(l, { ...NO_FILTERS, type: NO_TYPE }, today))).toEqual([2]);
  });

  it("treats an account as closed only once its closing date has passed", () => {
    expect(ids(filterAccounts(l, { ...NO_FILTERS, status: "open" }, today))).toEqual([1, 3]);
    expect(ids(filterAccounts(l, { ...NO_FILTERS, status: "closed" }, today))).toEqual([2]);
  });

  it("combines filters", () => {
    expect(ids(filterAccounts(l, { ...NO_FILTERS, institutionId: "1", ownerId: "1" }, today))).toEqual([1]);
  });
});
