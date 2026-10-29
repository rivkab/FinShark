// Filtering for the accounts table. Pure and unit-tested.
import type { AccountDto } from "@finshark/shared";

/** An empty string means "any". For `type`, NO_TYPE selects accounts with no type recorded. */
export interface AccountFilters {
  institutionId: string;
  type: string;
  ownerId: string;
  currency: string;
  /** "open" or "closed", judged against `today` (YYYY-MM-DD). */
  status: string;
}

export const NO_TYPE = "none";
export const NO_FILTERS: AccountFilters = { institutionId: "", type: "", ownerId: "", currency: "", status: "" };

export function hasFilters(f: AccountFilters): boolean {
  return Object.values(f).some((v) => v !== "");
}

/** Accounts matching every set filter. An account is closed once its closing date has passed. */
export function filterAccounts(accounts: readonly AccountDto[], f: AccountFilters, today: string): AccountDto[] {
  return accounts.filter((a) => {
    if (f.institutionId !== "" && String(a.institutionId) !== f.institutionId) return false;
    if (f.type !== "" && (a.accountType ?? NO_TYPE) !== f.type) return false;
    if (f.ownerId !== "" && !a.owners.some((o) => String(o.personId) === f.ownerId)) return false;
    if (f.currency !== "" && a.nativeCurrency !== f.currency) return false;
    const closed = a.closedOn !== null && a.closedOn <= today;
    if (f.status === "open" && closed) return false;
    if (f.status === "closed" && !closed) return false;
    return true;
  });
}
