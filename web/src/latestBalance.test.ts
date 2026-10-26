import { describe, expect, it } from "vitest";
import type { FactDto } from "@finshark/shared";
import { latestBalances } from "./latestBalance.ts";

const fact = (id: number, over: Partial<FactDto>): FactDto =>
  ({ id, conceptId: "balance.ending", accountId: 1, instantDate: "2025-01-31", status: "verified", ...over }) as FactDto;

describe("latestBalances", () => {
  it("picks the newest date per account", () => {
    const m = latestBalances([fact(1, {}), fact(2, { instantDate: "2025-03-31" }), fact(3, { accountId: 2 })]);
    expect(m.get(1)!.id).toBe(2);
    expect(m.get(2)!.id).toBe(3);
  });
  it("skips rejected and superseded facts and other concepts", () => {
    const m = latestBalances([
      fact(1, {}),
      fact(2, { instantDate: "2025-03-31", status: "rejected" }),
      fact(3, { instantDate: "2025-04-30", status: "superseded" }),
      fact(4, { instantDate: "2025-05-31", conceptId: "other" }),
    ]);
    expect(m.get(1)!.id).toBe(1);
  });
  it("keeps proposed facts and breaks date ties by id", () => {
    const m = latestBalances([fact(1, {}), fact(2, { status: "proposed" })]);
    expect(m.get(1)!.id).toBe(2);
  });
});
