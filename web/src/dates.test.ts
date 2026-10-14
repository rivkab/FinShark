import { describe, expect, it } from "vitest";
import { prefillDates } from "./dates.ts";

const doc = { periodStart: "2025-04-01", periodEnd: "2025-06-30", issuedOn: "2025-07-05", taxYear: null };

describe("prefillDates", () => {
  it("instant concepts use the period end", () => {
    expect(prefillDates("instant", doc)).toEqual({ instantDate: "2025-06-30", periodStart: "", periodEnd: "" });
  });
  it("duration concepts use start..end", () => {
    expect(prefillDates("duration", doc)).toEqual({ instantDate: "", periodStart: "2025-04-01", periodEnd: "2025-06-30" });
  });
  it("falls back to the tax year, then the issue date", () => {
    const y = { periodStart: null, periodEnd: null, issuedOn: "2026-01-31", taxYear: 2025 };
    expect(prefillDates("instant", y).instantDate).toBe("2025-12-31");
    expect(prefillDates("duration", y)).toMatchObject({ periodStart: "2025-01-01", periodEnd: "2025-12-31" });
    expect(prefillDates("instant", { periodStart: null, periodEnd: null, issuedOn: "2026-01-31" }).instantDate).toBe("2026-01-31");
    expect(prefillDates("duration", { periodStart: null, periodEnd: null })).toEqual({ instantDate: "", periodStart: "", periodEnd: "" });
  });
  it("gives nothing for concepts without a period", () => {
    expect(prefillDates("none", doc)).toEqual({ instantDate: "", periodStart: "", periodEnd: "" });
    expect(prefillDates(undefined, doc).instantDate).toBe("");
  });
});
