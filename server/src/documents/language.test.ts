import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makePdf, sampleStatementPdf } from "../testing/pdf-fixture.ts";
import { importDocument, type ImportDeps } from "./import.ts";
import { detectLanguage, fillMissingLanguages } from "./language.ts";
import type { ExtractFn, PageTextLayer } from "./text-layer.ts";
import { makeTestVault, writeSource, type TestVault } from "./test-helpers.ts";

const layerOf = (...texts: string[]): { pages: PageTextLayer[] } => ({
  pages: [
    {
      pageNo: 1,
      widthPt: 612,
      heightPt: 792,
      rotation: 0,
      textSource: "native",
      textSha256: null,
      items: texts.map((str) => ({ str, x0: 0, y0: 0, x1: 1, y1: 1, dir: "ltr" })),
    },
  ],
});

describe("detectLanguage", () => {
  it("says English for Latin text and Hebrew for Hebrew text", () => {
    expect(detectLanguage(layerOf("Account Statement", "Ending balance 1,234.56"))).toBe("en");
    expect(detectLanguage(layerOf("דוח תקופתי", "יתרה לסוף תקופה 1,234.56"))).toBe("he");
  });
  it("calls a bilingual document Hebrew when Hebrew is a clear share, English when it is a stray word", () => {
    expect(detectLanguage(layerOf("יתרה לסוף תקופה", "Ending balance"))).toBe("he");
    expect(detectLanguage(layerOf("Account Statement for the year ending December 31", "שקל"))).toBe("en");
  });
  it("ignores digits and punctuation, and returns null without letters", () => {
    expect(detectLanguage(layerOf("1,234.56", "---"))).toBeNull();
    expect(detectLanguage({ pages: [] })).toBeNull();
  });
});

describe("language at import and backfill", () => {
  let v: TestVault;
  let deps: ImportDeps;
  const hebrew: ExtractFn = async () => ({ textFingerprint: "x", pages: layerOf("דוח שנתי לחשבון").pages });
  beforeEach(async () => {
    v = await makeTestVault();
    deps = { db: v.db, layout: v.layout, now: () => new Date("2026-10-14T12:00:00Z") };
  });
  afterEach(async () => {
    await v.cleanup();
  });
  const lang = (id: number) => (v.db.prepare("SELECT language FROM documents WHERE id = ?").get(id) as { language: string | null }).language;

  it("detects the language on import unless one is given", async () => {
    const a = await importDocument(deps, await writeSource(v.dir, "a.pdf", sampleStatementPdf()), {});
    const b = await importDocument({ ...deps, extractText: hebrew }, await writeSource(v.dir, "b.pdf", makePdf([{ texts: [{ text: "x", x: 10, y: 10 }] }])), {});
    const c = await importDocument(deps, await writeSource(v.dir, "c.pdf", makePdf([{ texts: [{ text: "Hello", x: 10, y: 10 }] }])), { language: "he" });
    if (a.status !== "imported" || b.status !== "imported" || c.status !== "imported") throw new Error("import failed");
    expect(lang(a.documentId)).toBe("en");
    expect(lang(b.documentId)).toBe("he");
    expect(lang(c.documentId)).toBe("he");
  });

  it("fills in documents with no language and leaves set ones alone", async () => {
    const a = await importDocument(deps, await writeSource(v.dir, "a.pdf", sampleStatementPdf()), {});
    const b = await importDocument(deps, await writeSource(v.dir, "b.pdf", makePdf([{ texts: [{ text: "Hello", x: 10, y: 10 }] }])), { language: "he" });
    if (a.status !== "imported" || b.status !== "imported") throw new Error("import failed");
    v.db.prepare("UPDATE documents SET language = NULL WHERE id = ?").run(a.documentId);
    expect(await fillMissingLanguages(deps)).toBe(1);
    expect(lang(a.documentId)).toBe("en");
    expect(lang(b.documentId)).toBe("he");
    expect(await fillMissingLanguages(deps)).toBe(0);
  });
});
