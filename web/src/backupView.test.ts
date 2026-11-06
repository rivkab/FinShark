import { describe, expect, it } from "vitest";
import { backupCheck, formatBytes } from "./backupView.ts";

describe("formatBytes", () => {
  it("rounds to a readable unit", () => {
    expect([formatBytes(512), formatBytes(4_200), formatBytes(42_000_000), formatBytes(1_500_000_000)]).toEqual(["512 B", "4.2 KB", "42 MB", "1.5 GB"]);
  });
});

describe("backupCheck", () => {
  it("does not alarm about an unverified backup when this Mac has no key", () => {
    expect(backupCheck({ verifyOk: true }, false).label).toBe("Verified");
    expect(backupCheck({ verifyOk: false }, true).tone).toBe("danger");
    expect(backupCheck({ verifyOk: null }, true)).toEqual({ tone: "warning", label: "Not yet verified" });
    expect(backupCheck({ verifyOk: null }, false)).toEqual({ tone: "muted", label: "Not verified on this Mac" });
  });
});
