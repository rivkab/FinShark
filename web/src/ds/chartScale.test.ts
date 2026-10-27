import { describe, expect, it } from "vitest";
import { dayNumber, niceTicks, scaleX, scaleY, timeTicks } from "./chartScale.ts";

describe("niceTicks", () => {
  it("covers the range with round values and includes zero", () => {
    const t = niceTicks(1_000_00n, 4_821_055n);
    expect(t[0]).toBe(0n);
    expect(t.at(-1)! >= 4_821_055n).toBe(true);
    expect(t).toEqual([...t].sort((a, b) => (a < b ? -1 : 1)));
    expect(t[1]! - t[0]!).toBe(2_000_000n);
  });
  it("handles all-negative values", () => {
    const t = niceTicks(-950_000n, -120_000n);
    expect(t.at(-1)).toBe(0n);
    expect(t[0]! <= -950_000n).toBe(true);
  });
  it("handles mixed, equal, single and zero values", () => {
    const m = niceTicks(-300n, 700n);
    expect(m[0]! <= -300n && m.at(-1)! >= 700n && m.includes(0n)).toBe(true);
    const eq = niceTicks(5000n, 5000n);
    expect(eq[0]).toBe(0n);
    expect(eq.at(-1)! >= 5000n).toBe(true);
    expect(niceTicks(0n, 0n)).toEqual([0n, 100n]);
  });
  it("uses 1/2/5 steps", () => {
    expect(niceTicks(0n, 1_000n)).toEqual([0n, 500n, 1_000n]);
    expect(niceTicks(0n, 800n)).toEqual([0n, 200n, 400n, 600n, 800n]);
  });
});

describe("scaleY", () => {
  it("maps hi to top and lo to bottom in bigint", () => {
    expect(scaleY(100n, 0n, 100n, 260)).toBe(0);
    expect(scaleY(0n, 0n, 100n, 260)).toBe(260);
    expect(scaleY(50n, 0n, 100n, 260)).toBe(130);
  });
  it("is exact for values beyond Number precision", () => {
    const big = 9_007_199_254_740_993_000n;
    expect(scaleY(big / 2n, 0n, big, 200)).toBe(100);
  });
  it("centres a degenerate axis", () => {
    expect(scaleY(0n, 0n, 0n, 200)).toBe(100);
  });
});

describe("x scale", () => {
  it("counts days", () => {
    expect(dayNumber("1970-01-02")).toBe(1);
    expect(dayNumber("2025-03-01") - dayNumber("2025-02-01")).toBe(28);
  });
  it("is proportional to real dates", () => {
    expect(scaleX("2025-01-01", "2025-01-01", "2025-01-11", 100)).toBe(0);
    expect(scaleX("2025-01-04", "2025-01-01", "2025-01-11", 100)).toBe(30);
    expect(scaleX("2025-01-01", "2025-01-01", "2025-01-01", 100)).toBe(50);
  });
});

describe("timeTicks", () => {
  it("uses months for short spans", () => {
    const t = timeTicks("2025-01-15", "2025-05-20");
    expect(t.map((x) => x.label)).toEqual(["Feb 2025", "Mar 2025", "Apr 2025", "May 2025"]);
    expect(t[0]!.date).toBe("2025-02-01");
  });
  it("uses years for long spans", () => {
    expect(timeTicks("2020-06-01", "2025-06-01").map((x) => x.label)).toEqual(["2021", "2022", "2023", "2024", "2025"]);
  });
  it("thins crowded month ticks", () => {
    expect(timeTicks("2024-01-01", "2025-12-01").length).toBeLessThanOrEqual(8);
  });
});
