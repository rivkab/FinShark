import { describe, expect, it } from "vitest";
import type { FactDto } from "@finshark/shared";
import { balanceRows, compactAmount, pointDetail, pointHref } from "./accountChart.ts";
import type { SeriesPoint } from "./balanceSeries.ts";

describe("compactAmount", () => {
  it("compacts in whole units without Number arithmetic", () => {
    expect(compactAmount(0n, "ILS")).toBe("0");
    expect(compactAmount(4_000_000n, "ILS")).toBe("₪40k");
    expect(compactAmount(120_000_000n, "USD")).toBe("$1.2M");
    expect(compactAmount(-500_000n, "USD")).toBe("-$5k");
    expect(compactAmount(99_900n, "USD")).toBe("$999");
    expect(compactAmount(99_999_950n, "USD")).toBe("$1M");
    expect(compactAmount(250_000_000_000n, "USD")).toBe("$2.5B");
    expect(compactAmount(1_234_500n, "USD")).toBe("$12k");
  });
});

function fact(id: number, sources: { documentId: number; documentName: string; pageNo: number | null }[]): FactDto {
  return { id, conceptLabelEn: "Ending balance", sources } as unknown as FactDto;
}
function point(facts: FactDto[], conflict = false): SeriesPoint {
  return { date: "2026-03-31", minor: 100n, formatted: "$1.00", facts, conflict };
}

describe("point helpers", () => {
  const withSource = fact(5, [{ documentId: 9, documentName: "March.pdf", pageNo: 2 }]);
  const attested = fact(6, []);
  it("links to the document, the fact, or the fact for a conflict", () => {
    expect(pointHref(point([withSource]))).toBe("#/documents/9?fact=5");
    expect(pointHref(point([attested]))).toBe("#/facts/6");
    expect(pointHref(point([withSource], true))).toBe("#/facts/5");
  });
  it("describes a point", () => {
    expect(pointDetail(point([withSource, fact(7, [{ documentId: 10, documentName: "B.pdf", pageNo: 1 }])]))).toBe(
      "31 Mar 2026 · Ending balance · March.pdf, B.pdf · 2 sources",
    );
    expect(pointDetail(point([attested], true))).toBe("31 Mar 2026 · Ending balance · attested · conflict");
  });
  it("lists rows newest first with every source", () => {
    const older = { ...point([attested]), date: "2026-02-28" };
    const rows = balanceRows([older, point([withSource])]);
    expect(rows.map((r) => r.date)).toEqual(["2026-03-31", "2026-02-28"]);
    expect(rows[0]!.sources[0]).toMatchObject({ documentName: "March.pdf", pageNo: 2 });
    expect(rows[1]!.sources[0]).toMatchObject({ documentName: null, href: "#/facts/6" });
  });
});
