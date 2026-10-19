import { describe, expect, it } from "vitest";
import type { AccountDto } from "@finshark/shared";
import { sortAccounts } from "./accountSort.ts";

const people = [{ id: 1, displayName: "Dana" }, { id: 2, displayName: "Avi" }];

function acct(id: number, p: Partial<AccountDto>): AccountDto {
  return {
    id, institutionId: 1, institutionName: "Bank", displayName: `Acct ${id}`, altName: null, country: "US", language: "en",
    nativeCurrency: "USD", openedOn: null, closedOn: null, statementCadence: null, accountType: null, accountNumber: null,
    identifiers: [], owners: [], ...p,
  };
}
const ids = (l: AccountDto[]) => l.map((a) => a.id);

describe("sortAccounts", () => {
  it("sorts by name, case-insensitively and with numbers in order", () => {
    const l = [acct(1, { displayName: "b 10" }), acct(2, { displayName: "B 2" }), acct(3, { displayName: "a" })];
    expect(ids(sortAccounts(l, "name", "asc", people))).toEqual([3, 2, 1]);
    expect(ids(sortAccounts(l, "name", "desc", people))).toEqual([1, 2, 3]);
  });

  it("sorts by institution and country, breaking ties by name", () => {
    const l = [
      acct(1, { institutionName: "Leumi", country: "IL", displayName: "Z" }),
      acct(2, { institutionName: "Chase", country: "US", displayName: "Y" }),
      acct(3, { institutionName: "Chase", country: "IL", displayName: "A" }),
    ];
    expect(ids(sortAccounts(l, "institution", "asc", people))).toEqual([3, 2, 1]);
    expect(ids(sortAccounts(l, "country", "asc", people))).toEqual([3, 1, 2]);
  });

  it("sorts by type label and keeps accounts without a type last in both directions", () => {
    const l = [acct(1, {}), acct(2, { accountType: "savings" }), acct(3, { accountType: "checking" })];
    expect(ids(sortAccounts(l, "type", "asc", people))).toEqual([3, 2, 1]);
    expect(ids(sortAccounts(l, "type", "desc", people))).toEqual([2, 3, 1]);
  });

  it("sorts by owner names, accounts with no owner last", () => {
    const own = (...personIds: number[]) => personIds.map((personId) => ({ personId, role: "owner" as const, share: null }));
    const l = [acct(1, { owners: own(1) }), acct(2, {}), acct(3, { owners: own(1, 2) }), acct(4, { owners: own(2) })];
    // Avi < Avi, Dana < Dana
    expect(ids(sortAccounts(l, "owners", "asc", people))).toEqual([4, 3, 1, 2]);
  });

  it("does not change the input", () => {
    const l = [acct(2, { displayName: "b" }), acct(1, { displayName: "a" })];
    sortAccounts(l, "name", "asc", people);
    expect(ids(l)).toEqual([2, 1]);
  });
});
