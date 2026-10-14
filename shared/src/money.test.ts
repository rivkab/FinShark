import { describe, expect, it } from "vitest";
import { CURRENCY_EXPONENT } from "./money.ts";

describe("money", () => {
  it("knows USD and ILS exponents", () => {
    expect(CURRENCY_EXPONENT.USD).toBe(2);
    expect(CURRENCY_EXPONENT.ILS).toBe(2);
  });
});
