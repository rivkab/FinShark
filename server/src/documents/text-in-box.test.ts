import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sampleStatementPdf } from "../testing/pdf-fixture.ts";
import { getTextLayer } from "./text-layer.ts";
import { textInBox, type BoxedText } from "./text-in-box.ts";
import { makeTestVault, writeSource, type TestVault } from "./test-helpers.ts";

const item = (str: string, x0: number, y0: number, x1: number, y1 = y0 + 10): BoxedText => ({ str, x0, y0, x1, y1 });

describe("textInBox", () => {
  let v: TestVault;
  beforeEach(async () => {
    v = await makeTestVault();
  });
  afterEach(async () => {
    await v.cleanup();
  });

  it("reads the ending balance from the sample statement", async () => {
    const src = await writeSource(v.dir, "s.pdf", sampleStatementPdf());
    const layer = await getTextLayer(v.layout, "d".repeat(64), src);
    const items = layer.pages[0]!.items;
    expect(textInBox(items, [395, 595, 480, 615])).toBe("$83,421.17");
    expect(textInBox(items, [395, 570, 480, 615])).toBe("$83,421.17 $1,204.33");
    expect(textInBox(items, [0, 0, 10, 10])).toBe("");
  });

  it("joins numeric pieces split across items without spaces", () => {
    const items = [item("$", 400, 600, 406), item("83,4", 406, 600, 424), item("21.17", 424.2, 600, 450)];
    expect(textInBox(items, [395, 595, 460, 615])).toBe("$83,421.17");
  });

  it("keeps separate columns and words apart", () => {
    const items = [item("Ending", 72, 600, 110), item("balance", 114, 600, 160), item("12", 300, 600, 312), item("34", 340, 600, 352)];
    expect(textInBox(items, [60, 595, 400, 615])).toBe("Ending balance 12 34");
  });

  it("requires at least half of an item's area inside the box", () => {
    const items = [item("in", 0, 0, 10, 10), item("out", 6, 0, 16, 10)];
    expect(textInBox(items, [0, 0, 10, 10])).toBe("in");
    expect(textInBox(items, [0, 0, 11, 10])).toBe("in out");
  });

  it("orders top to bottom, then left to right, and accepts any corner order", () => {
    const items = [item("c", 50, 100, 60), item("b", 20, 100, 30), item("a", 20, 200, 30)];
    expect(textInBox(items, [100, 300, 0, 0])).toBe("a b c");
  });
});
