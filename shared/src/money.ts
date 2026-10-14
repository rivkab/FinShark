/** ISO 4217 currency code, e.g. "USD", "ILS". */
export type CurrencyCode = string;

/**
 * A monetary amount in integer minor units (cents, agorot). Never a float.
 * bigint so that sums are exact regardless of size.
 */
export interface Money {
  readonly minor: bigint;
  readonly currency: CurrencyCode;
}

/** Number of minor-unit digits per currency. Extend as currencies are added. */
export const CURRENCY_EXPONENT: Readonly<Record<CurrencyCode, number>> = {
  USD: 2,
  ILS: 2,
};
