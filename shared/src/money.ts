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

// ---------------------------------------------------------------- parsing and display
// All arithmetic is BigInt; money never passes through Number.

/** Thrown for any amount string that is not unambiguously one amount in the given currency. */
export class MoneyParseError extends Error {
  readonly code: "unknown_currency" | "bad_amount";
  constructor(code: "unknown_currency" | "bad_amount", message: string) {
    super(message);
    this.name = "MoneyParseError";
    this.code = code;
  }
}

const CURRENCY_SYMBOL: Readonly<Record<CurrencyCode, string>> = { USD: "$", ILS: "₪" };
const SYMBOL_CURRENCY: Readonly<Record<string, CurrencyCode>> = { $: "USD", "₪": "ILS" };

/** Bidi marks (LRM, RLM, LRE, RLE, PDF, LRO, RLO) that PDFs and Hebrew text put around numbers. */
const BIDI_MARKS = /[‎‏‪-‮]/g;

export function isKnownCurrency(currency: string): boolean {
  return Object.hasOwn(CURRENCY_EXPONENT, currency);
}

export function currencyExponent(currency: CurrencyCode): number {
  if (!isKnownCurrency(currency)) throw new MoneyParseError("unknown_currency", `Unknown currency: ${currency}`);
  return CURRENCY_EXPONENT[currency]!;
}

// A marker is a symbol ($, ₪) or a 3-letter code. At most one marker is allowed overall.
const MARKER = String.raw`(?:\$|₪|[A-Z]{3})`;
const NUMBER = String.raw`(?:[1-9]\d{0,2}(?:,\d{3})+|\d+)(?:\.\d+)?`;
const AMOUNT_RE = new RegExp(
  String.raw`^(?<open>\()?\s*(?<s1>[-−])?\s*(?:(?<pre>${MARKER})\s*)?(?<s2>[-−])?(?<num>${NUMBER})` +
    String.raw`(?:\s*(?<post>${MARKER}))?\s*(?<close>\))?(?:\s*(?<post2>${MARKER}))?$`,
  "u",
);

/**
 * Strictly parse a displayed amount such as "$83,421.17", "(1,204.33)", "-₪42,318.55" or
 * "‏42,318.55 ₪" into integer minor units. Accepts digits with "," thousands separators in
 * groups of three, an optional "." fraction of at most the currency's exponent digits, a
 * leading "-" or surrounding parentheses for negatives, one optional "$"/"₪"/currency-code
 * marker (which must agree with `currency`), surrounding whitespace and bidi marks.
 * Anything else (European "1.234,56", extra decimals, several numbers, ...) is rejected.
 */
export function parseAmount(input: string, currency: CurrencyCode): Money {
  const exp = currencyExponent(currency);
  const fail = (why: string): never => {
    throw new MoneyParseError("bad_amount", `Cannot read ${JSON.stringify(input)} as an amount in ${currency}: ${why}`);
  };

  const s = input.replace(BIDI_MARKS, "").trim();
  const m = AMOUNT_RE.exec(s);
  if (!m?.groups) return fail("not a single plain amount");
  const g = m.groups as Record<string, string | undefined>;
  const markers = [g["pre"], g["post"], g["post2"]].filter((x): x is string => x !== undefined);
  if (markers.length > 1) return fail("more than one currency marker");
  if ((g["open"] === undefined) !== (g["close"] === undefined)) return fail("unbalanced parentheses");
  if (g["s1"] !== undefined && g["s2"] !== undefined) return fail("two minus signs");
  const parens = g["open"] !== undefined;
  const minus = g["s1"] !== undefined || g["s2"] !== undefined;
  if (parens && minus) return fail("minus sign inside parentheses");

  const marker = markers[0];
  if (marker !== undefined) {
    const implied = SYMBOL_CURRENCY[marker] ?? marker;
    if (implied !== currency) return fail(`marker ${marker} does not match ${currency}`);
  }

  const [whole = "", frac = ""] = g["num"]!.replace(/,/g, "").split(".");
  if (frac.length > exp) return fail(`more than ${exp} decimal places`);
  const minor = BigInt(whole + frac.padEnd(exp, "0"));
  return { minor: parens || minus ? -minor : minor, currency };
}

/** Plain decimal string with exactly the currency's exponent digits: "83421.17", "-0.05". Re-parsable. */
export function toDecimalString(money: Money): string {
  const exp = currencyExponent(money.currency);
  const neg = money.minor < 0n;
  const digits = (neg ? -money.minor : money.minor).toString().padStart(exp + 1, "0");
  const whole = digits.slice(0, digits.length - exp);
  const frac = digits.slice(digits.length - exp);
  return `${neg ? "-" : ""}${whole}${exp > 0 ? `.${frac}` : ""}`;
}

/** Display form: "$83,421.17", "-₪42,318.55"; currencies without a symbol show "1,234.00 CODE". */
export function formatAmount(money: Money): string {
  const plain = toDecimalString(money);
  const neg = plain.startsWith("-");
  const [whole = "0", frac] = (neg ? plain.slice(1) : plain).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const body = frac === undefined ? grouped : `${grouped}.${frac}`;
  const symbol = CURRENCY_SYMBOL[money.currency];
  const text = symbol ? `${symbol}${body}` : `${body} ${money.currency}`;
  return neg ? `-${text}` : text;
}
