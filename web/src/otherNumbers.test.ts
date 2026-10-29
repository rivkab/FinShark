import { describe, expect, it } from "vitest";
import type { ConceptDto, FactDto } from "@finshark/shared";
import { otherNumbers } from "./otherNumbers.ts";

const concepts: Pick<ConceptDto, "id" | "genericConceptId">[] = [
  { id: "balance.ending", genericConceptId: null },
  { id: "il.pension.accrued_savings", genericConceptId: "balance.ending" },
  { id: "interest.earned", genericConceptId: null },
];

const fact = (id: number, over: Partial<FactDto> = {}): FactDto =>
  ({
    id,
    conceptId: "interest.earned",
    accountId: 1,
    instantDate: null,
    periodStart: "2025-01-01",
    periodEnd: "2025-01-31",
    valueMinor: "1234",
    currency: "USD",
    status: "verified",
    sources: [],
    ...over,
  }) as FactDto;

describe("otherNumbers", () => {
  it("excludes balances, other accounts and rejected/superseded facts", () => {
    const rows = otherNumbers(
      1,
      [
        fact(1),
        fact(2, { conceptId: "balance.ending", instantDate: "2025-01-31", periodStart: null, periodEnd: null }),
        fact(3, { conceptId: "il.pension.accrued_savings" }),
        fact(4, { accountId: 2 }),
        fact(5, { status: "rejected" }),
        fact(6, { status: "superseded" }),
        fact(7, { status: "proposed" }),
      ],
      concepts,
    );
    expect(rows.map((r) => r.fact.id)).toEqual([7, 1]);
    expect(rows.map((r) => r.conflict)).toEqual([true, false]);
  });

  it("sorts newest first, undated last, ties by id descending", () => {
    const rows = otherNumbers(
      1,
      [
        fact(1, { periodEnd: "2025-01-31" }),
        fact(2, { periodStart: "2025-02-01", periodEnd: "2025-02-28" }),
        fact(3, { periodStart: null, periodEnd: null }),
        fact(4, { periodStart: null, periodEnd: null, instantDate: "2025-03-15" }),
        fact(5, { periodEnd: "2025-01-31" }),
      ],
      concepts,
    );
    expect(rows.map((r) => r.fact.id)).toEqual([4, 2, 5, 1, 3]);
  });

  it("formats periods and builds evidence links", () => {
    const rows = otherNumbers(
      1,
      [
        fact(1, { sources: [{ documentId: 9, documentName: "jan.pdf", pageNo: 2 } as FactDto["sources"][number]] }),
        fact(2, { periodStart: null, periodEnd: null, instantDate: "2025-03-15" }),
      ],
      concepts,
    );
    const byId = new Map(rows.map((r) => [r.fact.id, r]));
    expect(byId.get(1)!.period).toBe("1 Jan 2025 to 31 Jan 2025");
    expect(byId.get(1)!.sources[0]!.documentName).toBe("jan.pdf");
    expect(byId.get(1)!.sources[0]!.href).toContain("9");
    expect(byId.get(2)!.period).toBe("15 Mar 2025");
    expect(byId.get(2)!.sources[0]!.documentId).toBeNull();
  });
});
