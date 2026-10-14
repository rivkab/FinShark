import { describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { makePdf, sampleStatementPdf } from "./pdf-fixture.ts";

describe("pdf fixtures", () => {
  it("produces a PDF that pdf.js reads with text at the given positions", async () => {
    const task = getDocument({ data: sampleStatementPdf(), verbosity: 0 });
    const doc = await task.promise;
    expect(doc.numPages).toBe(1);
    const { items } = await (await doc.getPage(1)).getTextContent();
    const balance = items.find((i) => "str" in i && i.str === "$83,421.17");
    expect(balance && "transform" in balance ? balance.transform.slice(4) : null).toEqual([400, 600]);
    await task.destroy();
  });

  it("is deterministic", () => {
    const page = { texts: [{ text: "x", x: 1, y: 2 }] };
    expect(makePdf([page])).toEqual(makePdf([page]));
  });

  it("rejects non-ASCII text", () => {
    expect(() => makePdf([{ texts: [{ text: "₪5", x: 0, y: 0 }] }])).toThrow();
  });
});
