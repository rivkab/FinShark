import { describe, expect, it } from "vitest";
import { formatDay, formatDayShort } from "./displayDate.ts";

describe("displayDate", () => {
  it("formats ISO dates", () => {
    expect(formatDay("2026-09-30")).toBe("30 Sep 2026");
    expect(formatDay("2026-01-05")).toBe("5 Jan 2026");
    expect(formatDayShort("2026-09-25")).toBe("25 Sep");
  });
  it("returns unrecognised text unchanged", () => {
    expect(formatDay("soon")).toBe("soon");
    expect(formatDay("2026-13-01")).toBe("2026-13-01");
    expect(formatDayShort("")).toBe("");
  });
});
