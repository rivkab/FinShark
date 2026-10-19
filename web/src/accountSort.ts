// Sorting for the accounts table. Pure and unit-tested.
import type { AccountDto, PersonDto } from "@finshark/shared";
import { ACCOUNT_TYPE_LABEL } from "./labels.ts";

export type AccountSortKey = "name" | "institution" | "type" | "owners" | "country";
export type SortDir = "asc" | "desc";

// Names can be Hebrew or English; compare by the user's locale with numbers in order.
const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

/** The text a column is sorted by; null (nothing recorded) always sorts last. */
export function sortText(a: AccountDto, key: AccountSortKey, people: readonly Pick<PersonDto, "id" | "displayName">[]): string | null {
  switch (key) {
    case "name":
      return a.displayName;
    case "institution":
      return a.institutionName;
    case "type":
      return a.accountType ? ACCOUNT_TYPE_LABEL[a.accountType] : null;
    case "country":
      return a.country;
    case "owners": {
      const names = a.owners
        .map((o) => people.find((p) => p.id === o.personId)?.displayName ?? `#${o.personId}`)
        .sort(collator.compare);
      return names.length === 0 ? null : names.join(", ");
    }
  }
}

/** A sorted copy. Ties fall back to name, then id, so the order is stable. Blanks stay last in both directions. */
export function sortAccounts(
  accounts: readonly AccountDto[],
  key: AccountSortKey,
  dir: SortDir,
  people: readonly Pick<PersonDto, "id" | "displayName">[],
): AccountDto[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...accounts].sort((x, y) => {
    const a = sortText(x, key, people);
    const b = sortText(y, key, people);
    if (a === null && b !== null) return 1;
    if (a !== null && b === null) return -1;
    const c = a !== null && b !== null ? collator.compare(a, b) * sign : 0;
    return c !== 0 ? c : collator.compare(x.displayName, y.displayName) || x.id - y.id;
  });
}
