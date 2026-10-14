import { describe, expect, it } from "vitest";
import { CURRENCY_EXPONENT, formatAmount, MoneyParseError, parseAmount, toDecimalString } from "./money.ts";

const usd = (s: string) => parseAmount(s, "USD").minor;
const ils = (s: string) => parseAmount(s, "ILS").minor;

describe("money", () => {
  it("knows USD and ILS exponents", () => {
    expect(CURRENCY_EXPONENT.USD).toBe(2);
    expect(CURRENCY_EXPONENT.ILS).toBe(2);
  });
});

describe("parseAmount", () => {
  it("parses plain, grouped and decimal amounts", () => {
    expect(usd("0")).toBe(0n);
    expect(usd("5")).toBe(500n);
    expect(usd("5.1")).toBe(510n);
    expect(usd("1204.33")).toBe(120433n);
    expect(usd("83,421.17")).toBe(8342117n);
    expect(usd("$83,421.17")).toBe(8342117n);
    expect(usd("1,000,000")).toBe(100000000n);
    expect(usd("0.05")).toBe(5n);
  });
  it("is exact beyond Number's safe range", () => {
    expect(usd("90,071,992,547,409.93")).toBe(9007199254740993n);
    expect(usd("123,456,789,012,345,678.99")).toBe(12345678901234567899n);
  });
  it("handles negatives: minus, parentheses, minus before the symbol", () => {
    expect(usd("-1,204.33")).toBe(-120433n);
    expect(usd("(1,204.33)")).toBe(-120433n);
    expect(usd("($1,204.33)")).toBe(-120433n);
    expect(usd("-$1,204.33")).toBe(-120433n);
    expect(usd("$-1,204.33")).toBe(-120433n);
    expect(usd("−1.00")).toBe(-100n);
  });
  it("accepts symbols, codes, whitespace and bidi marks", () => {
    expect(ils("₪42,318.55")).toBe(4231855n);
    expect(ils("42,318.55 ₪")).toBe(4231855n);
    expect(ils("  42,318.55 ILS ")).toBe(4231855n);
    expect(usd("USD 83,421.17")).toBe(8342117n);
    expect(usd(" 83,421.17 ")).toBe(8342117n);
  });
  it("handles Hebrew-context strings with bidi marks", () => {
    expect(ils("‏42,318.55 ₪")).toBe(4231855n);
    expect(ils("‫‏₪42,318.55‎‬")).toBe(4231855n);
    expect(ils("‪(42,318.55)‬ ₪")).toBe(-4231855n);
    expect(ils("‏-42,318.55‎ ₪")).toBe(-4231855n);
  });
  it.each([
    "",
    " ",
    "abc",
    "1.234,56",
    "1,234,56",
    "12,34",
    "1,2345",
    "0,500",
    "1.234.567",
    "83,421.177",
    "1.",
    ".5",
    "1 234",
    "12 34",
    "$83,421.17 $1,204.33",
    "83,421.17 1,204.33",
    "$$5",
    "--5",
    "-(5)",
    "(-5)",
    "(5",
    "5)",
    "5-",
    "1e3",
    "+5",
    "0x10",
    "$ 5 USD",
    "$5 USD",
    "5%",
  ])("rejects %j", (s) => {
    expect(() => parseAmount(s, "USD")).toThrow(MoneyParseError);
  });
  it("rejects a marker that disagrees with the currency", () => {
    expect(() => parseAmount("₪5", "USD")).toThrow(/does not match/);
    expect(() => parseAmount("$5", "ILS")).toThrow(/does not match/);
    expect(() => parseAmount("EUR 5", "USD")).toThrow(/does not match/);
  });
  it("rejects an unknown currency", () => {
    for (const c of ["XXX", "toString", ""]) {
      try {
        parseAmount("5", c);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(MoneyParseError);
        expect((e as MoneyParseError).code).toBe("unknown_currency");
      }
    }
  });
});

describe("formatAmount", () => {
  it("formats by currency", () => {
    expect(formatAmount({ minor: 8342117n, currency: "USD" })).toBe("$83,421.17");
    expect(formatAmount({ minor: 4231855n, currency: "ILS" })).toBe("₪42,318.55");
    expect(formatAmount({ minor: 5n, currency: "USD" })).toBe("$0.05");
    expect(formatAmount({ minor: 0n, currency: "USD" })).toBe("$0.00");
    expect(formatAmount({ minor: -120433n, currency: "USD" })).toBe("-$1,204.33");
    expect(formatAmount({ minor: 12345678901234567899n, currency: "USD" })).toBe("$123,456,789,012,345,678.99");
  });
  it("rejects an unknown currency", () => {
    expect(() => formatAmount({ minor: 1n, currency: "XXX" })).toThrow(MoneyParseError);
  });
  it("round-trips through parseAmount", () => {
    for (const minor of [0n, 1n, 99n, 100n, 8342117n, -8342117n, 9007199254740993n]) {
      for (const currency of ["USD", "ILS"]) {
        expect(parseAmount(formatAmount({ minor, currency }), currency).minor).toBe(minor);
        expect(parseAmount(toDecimalString({ minor, currency }), currency).minor).toBe(minor);
      }
    }
  });
});
