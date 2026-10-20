import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makePdf } from "../testing/pdf-fixture.ts";
import { importDocument, type ImportDeps } from "./import.ts";
import { extractPeriod, fillMissingPeriods, parseDayFirstDate, parseEnglishRange } from "./period.ts";
import type { ExtractFn, TextItem } from "./text-layer.ts";
import { makeTestVault, writeSource, type TestVault } from "./test-helpers.ts";

// Items are [text, x0, y0, x1, y1] with the PDF origin at the bottom left.
const item = ([str, x0, y0, x1, y1]: [string, number, number, number, number]): TextItem => ({ str, x0, y0, x1, y1, dir: "ltr" });
const layerOf = (...items: [string, number, number, number, number][]) => ({
  pages: [{ pageNo: 1, widthPt: 612, heightPt: 792, rotation: 0 as const, textSource: "native" as const, textSha256: null, items: items.map(item) }],
});

describe("parseEnglishRange", () => {
  it("reads the common statement period formats", () => {
    expect(parseEnglishRange("September 1-30, 2026")).toEqual(["2026-09-01", "2026-09-30"]);
    expect(parseEnglishRange("Sep 1 - Sep 30, 2026")).toEqual(["2026-09-01", "2026-09-30"]);
    expect(parseEnglishRange("Dec 15, 2025 - Jan 14, 2026")).toEqual(["2025-12-15", "2026-01-14"]);
    expect(parseEnglishRange("Dec 15 - Jan 14, 2026")).toEqual(["2025-12-15", "2026-01-14"]);
    expect(parseEnglishRange("09/01/2026 - 09/30/2026")).toEqual(["2026-09-01", "2026-09-30"]);
  });
  it("refuses impossible dates, backwards ranges and other text", () => {
    expect(parseEnglishRange("February 1-30, 2026")).toBeNull();
    expect(parseEnglishRange("Sep 30 - Sep 1, 2026")).toBeNull();
    expect(parseEnglishRange("Thank you for banking with us")).toBeNull();
  });
  it("reads day-first dates", () => {
    expect(parseDayFirstDate("14/04/2026")).toBe("2026-04-14");
    expect(parseDayFirstDate("31.12.2025")).toBe("2025-12-31");
    expect(parseDayFirstDate("31/02/2025")).toBeNull();
  });
});

describe("extractPeriod", () => {
  it("reads 'Statement Period' with the dates below the label", () => {
    const p = extractPeriod(layerOf(["Statement Period", 400, 540, 470, 550], ["September 1-30, 2026", 400, 528, 500, 537], ["September 2026", 130, 528, 230, 537]));
    expect(p).toMatchObject({ periodStart: "2026-09-01", periodEnd: "2026-09-30", taxYear: 2026 });
    expect(p?.source).toMatchObject({ rule: "statement_period", pageNo: 1, quotedText: "September 1-30, 2026" });
  });
  it("reads 'STATEMENT PERIOD' with the dates to the right", () => {
    const p = extractPeriod(layerOf(["STATEMENT PERIOD", 100, 500, 180, 510], ["Sep 1 - Sep 30, 2026", 190, 500, 290, 510]));
    expect(p).toMatchObject({ periodStart: "2026-09-01", periodEnd: "2026-09-30" });
  });
  it("leaves the tax year empty when the period spans two years", () => {
    const p = extractPeriod(layerOf(["Statement Period", 400, 540, 470, 550], ["Dec 15, 2025 - Jan 14, 2026", 400, 528, 500, 537]));
    expect(p).toMatchObject({ periodStart: "2025-12-15", periodEnd: "2026-01-14", taxYear: null });
  });
  it("reads a Hebrew period whichever way round the dates come", () => {
    const p = extractPeriod(layerOf(["תקופה", 548, 647, 576, 658], ["14/10/2026", 532, 631, 576, 642], ["-", 514, 631, 518, 642], ["14/04/2026", 458, 631, 504, 642], ["תאריך", 553, 608, 576, 619]));
    expect(p).toMatchObject({ periodStart: "2026-04-14", periodEnd: "2026-10-14", taxYear: 2026 });
    expect(p?.source.rule).toBe("hebrew_period");
  });
  it("reads an annual report only when its year-end date confirms the year", () => {
    const items: [string, number, number, number, number][] = [["לשנת", 121, 731, 156, 750], ["2025", 90, 731, 118, 750]];
    expect(extractPeriod(layerOf(...items))).toBeNull();
    const p = extractPeriod(layerOf(...items, ["31/12/2025", 11, 748, 54, 759]));
    expect(p).toMatchObject({ periodStart: "2025-01-01", periodEnd: "2025-12-31", taxYear: 2025 });
    expect(extractPeriod(layerOf(...items, ["31/12/2024", 11, 748, 54, 759]))).toBeNull();
  });
  it("guesses nothing from stray dates", () => {
    expect(extractPeriod(layerOf(["31/12/2025", 10, 10, 50, 20], ["2025", 60, 10, 80, 20], ["Sep 1", 90, 10, 110, 20]))).toBeNull();
    expect(extractPeriod({ pages: [] })).toBeNull();
  });
});

describe("period at import and backfill", () => {
  let v: TestVault;
  let deps: ImportDeps;
  const statement: ExtractFn = async () => ({
    textFingerprint: "x",
    pages: layerOf(["Statement Period", 400, 540, 470, 550], ["September 1-30, 2026", 400, 528, 500, 537]).pages,
  });
  const pdf = (name: string) => writeSource(v.dir, name, makePdf([{ texts: [{ text: name, x: 10, y: 10 }] }]));
  beforeEach(async () => {
    v = await makeTestVault();
    deps = { db: v.db, layout: v.layout, now: () => new Date("2026-10-14T12:00:00Z"), extractText: statement };
  });
  afterEach(async () => {
    await v.cleanup();
  });
  const row = (id: number) => v.db.prepare("SELECT period_start, period_end, tax_year, metadata FROM documents WHERE id = ?").get(id) as Record<string, unknown>;

  it("fills the dates on import, records the source, and lets given values win", async () => {
    const a = await importDocument(deps, await pdf("a.pdf"), {});
    const b = await importDocument(deps, await pdf("b.pdf"), { taxYear: 2020, periodStart: "2020-01-01", periodEnd: "2020-12-31" });
    if (a.status !== "imported" || b.status !== "imported") throw new Error("import failed");
    expect(row(a.documentId)).toMatchObject({ period_start: "2026-09-01", period_end: "2026-09-30", tax_year: 2026 });
    expect(JSON.parse(String(row(a.documentId)["metadata"])).periodSource).toMatchObject({ rule: "statement_period", pageNo: 1 });
    expect(row(b.documentId)).toMatchObject({ period_start: "2020-01-01", period_end: "2020-12-31", tax_year: 2020, metadata: "{}" });
  });

  it("backfills only what is empty", async () => {
    const a = await importDocument(deps, await pdf("a.pdf"), {});
    if (a.status !== "imported") throw new Error("import failed");
    v.db.prepare("UPDATE documents SET period_start = NULL, period_end = NULL, tax_year = NULL, metadata = '{}' WHERE id = ?").run(a.documentId);
    v.db.prepare("UPDATE documents SET tax_year = 2019 WHERE id = ?").run(a.documentId);
    expect(await fillMissingPeriods(deps)).toBe(1);
    expect(row(a.documentId)).toMatchObject({ period_start: "2026-09-01", period_end: "2026-09-30", tax_year: 2019 });
    expect(await fillMissingPeriods(deps)).toBe(0);
  });
});
