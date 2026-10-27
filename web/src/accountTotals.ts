// Per-currency totals of the latest verified balances (CLAUDE.md: integer minor units, never converted,
// never including proposed values). Pure and unit-tested.
import { formatAmount, type AccountDto, type FactDto } from "@finshark/shared";

export interface CurrencyTotal {
  currency: string;
  /** Sum of the verified latest balances, formatted ("$83,421.17"); null when none is verified, so no "$0.00" is shown as a total. */
  formatted: string | null;
  /** Accounts in this currency whose latest balance is verified. */
  verifiedCount: number;
  /** Accounts in this currency (native currency, or a verified balance reported in it). */
  accountCount: number;
}

/**
 * One total per currency that appears among the latest balances, most accounts first, then by currency code.
 * Only verified balances with an exact amount are summed (BigInt); the counts tell how many
 * accounts that covers, so a partial total is never presented as complete.
 */
export function currencyTotals(
  accounts: readonly Pick<AccountDto, "id" | "nativeCurrency">[],
  latest: ReadonlyMap<number, Pick<FactDto, "status" | "currency" | "valueMinor">>,
): CurrencyTotal[] {
  const currencies = new Set<string>();
  for (const b of latest.values()) if (b.currency) currencies.add(b.currency);

  const totals = [...currencies].sort().map((currency) => {
    let minor = 0n;
    const verified = new Set<number>();
    const inCurrency = new Set(accounts.filter((a) => a.nativeCurrency === currency).map((a) => a.id));
    for (const [accountId, b] of latest) {
      if (b.status !== "verified" || b.currency !== currency || b.valueMinor === null) continue;
      minor += BigInt(b.valueMinor);
      verified.add(accountId);
      inCurrency.add(accountId);
    }
    return { currency, formatted: verified.size === 0 ? null : formatAmount({ minor, currency }), verifiedCount: verified.size, accountCount: inCurrency.size };
  });
  return totals.sort((a, b) => b.accountCount - a.accountCount);
}

/** "3 accounts" when all are covered, else "2 of 3 accounts". */
export function coverageNote(t: Pick<CurrencyTotal, "verifiedCount" | "accountCount">): string {
  return t.verifiedCount === t.accountCount
    ? `${t.verifiedCount} ${t.verifiedCount === 1 ? "account" : "accounts"}`
    : `${t.verifiedCount} of ${t.accountCount} accounts`;
}

/** The newest date among the balances, or null when there are none. */
export function newestBalanceDate(latest: ReadonlyMap<number, Pick<FactDto, "instantDate">>): string | null {
  let newest: string | null = null;
  for (const b of latest.values()) if (b.instantDate && (newest === null || b.instantDate > newest)) newest = b.instantDate;
  return newest;
}
