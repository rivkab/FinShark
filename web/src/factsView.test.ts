import { describe, expect, it } from "vitest";
import type { FactDto } from "@finshark/shared";
import { visibleFacts } from "./factsView.ts";

const facts = (["verified", "proposed", "rejected", "superseded"] as const).map((status, i) => ({ id: i + 1, status }) as FactDto);

describe("visibleFacts", () => {
  it("hides deleted and replaced facts by default", () => {
    expect(visibleFacts(facts, false).map((f) => f.id)).toEqual([1, 2]);
  });
  it("shows every fact when asked", () => {
    expect(visibleFacts(facts, true).map((f) => f.id)).toEqual([1, 2, 3, 4]);
  });
});
