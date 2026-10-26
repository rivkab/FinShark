import { describe, expect, it } from "vitest";
import { overlapFraction, textInBox, textItemRect, toTextBoxes, type TextBox } from "./text-in-box.ts";

// Helvetica-ish boxes: width = 6 * chars at size 10, height 10, baseline y.
function box(str: string, x: number, y: number, w = str.length * 6, h = 10): TextBox {
  return { str, rect: [x, y, x + w, y + h] };
}
/** Same, from x0..x1 (server-style item). */
const span = (str: string, x0: number, y0: number, x1: number, y1 = y0 + 10): TextBox => ({ str, rect: [x0, y0, x1, y1] });

const items: TextBox[] = [
  box("Ending balance", 72, 600),
  box("$83,421.17", 400, 600),
  box("Interest paid", 72, 580),
  box("$1,204.33", 400, 580),
];

describe("overlapFraction", () => {
  it("computes the inner area fraction", () => {
    expect(overlapFraction([0, 0, 10, 10], [0, 0, 5, 10])).toBe(0.5);
    expect(overlapFraction([0, 0, 10, 10], [20, 20, 30, 30])).toBe(0);
    expect(overlapFraction([0, 0, 10, 10], [-5, -5, 50, 50])).toBe(1);
  });
  it("uses the center for zero-area items", () => {
    expect(overlapFraction([5, 5, 5, 5], [0, 0, 10, 10])).toBe(1);
    expect(overlapFraction([15, 5, 15, 5], [0, 0, 10, 10])).toBe(0);
  });
});

describe("textInBox", () => {
  it("returns the item under the box", () => {
    expect(textInBox(items, [395, 596, 470, 615])).toBe("$83,421.17");
  });
  it("needs at least 50% of an item inside the box", () => {
    expect(textInBox(items, [400, 596, 440, 615])).toBe("$83,421.17");
    expect(textInBox(items, [400, 596, 420, 615])).toBe("");
    expect(textInBox(items, [395, 604, 470, 650])).toBe("$83,421.17");
    expect(textInBox(items, [395, 607, 470, 650])).toBe("");
    const two = [span("in", 0, 0, 10), span("out", 6, 0, 16)];
    expect(textInBox(two, [0, 0, 10, 10])).toBe("in");
    expect(textInBox(two, [0, 0, 11, 10])).toBe("in out");
  });
  it("orders top-to-bottom then left-to-right, regardless of input order", () => {
    const shuffled = [items[3]!, items[1]!, items[2]!, items[0]!];
    expect(textInBox(shuffled, [0, 570, 612, 620])).toBe("Ending balance $83,421.17 Interest paid $1,204.33");
    const abc = [span("c", 50, 100, 60), span("b", 20, 100, 30), span("a", 20, 200, 30)];
    expect(textInBox(abc, [100, 300, 0, 0])).toBe("a b c");
  });
  it("treats items with slightly different baselines as one line", () => {
    expect(textInBox([box("42", 130, 601), box("Total", 72, 600)], [0, 590, 300, 620])).toBe("Total 42");
  });
  it("joins touching numeric pieces without spaces", () => {
    const parts = [box("$", 400, 600, 6), box("83", 406, 600, 12), box(",421", 418, 600, 24), box(".17", 442, 600, 18)];
    expect(textInBox(parts, [390, 595, 480, 615])).toBe("$83,421.17");
    const split = [span("$", 400, 600, 406), span("83,4", 406, 600, 424), span("21.17", 424.2, 600, 450)];
    expect(textInBox(split, [395, 595, 460, 615])).toBe("$83,421.17");
  });
  it("joins only when the gap is at most 0.35 x line height", () => {
    // line height 10: gap 3.5 joins, gap 3.6 does not
    expect(textInBox([span("12", 0, 0, 12), span("34", 15.5, 0, 27.5)], [0, 0, 100, 10])).toBe("1234");
    expect(textInBox([span("12", 0, 0, 12), span("34", 15.6, 0, 27.6)], [0, 0, 100, 10])).toBe("12 34");
  });
  it("keeps separate numbers apart when there is a gap", () => {
    const parts = [box("2025", 100, 600, 24), box("12", 150, 600, 12)];
    expect(textInBox(parts, [90, 595, 200, 615])).toBe("2025 12");
  });
  it("does not glue words to numbers or words to words", () => {
    expect(textInBox([box("Account", 72, 600, 42), box("4821", 118, 600, 24)], [60, 595, 200, 615])).toBe("Account 4821");
    expect(textInBox([box("Ending", 72, 600, 36), box("balance", 108, 600, 42)], [60, 595, 200, 615])).toBe("Ending balance");
  });
  it("keeps separate columns apart", () => {
    const cols = [span("Ending", 72, 600, 110), span("balance", 114, 600, 160), span("12", 300, 600, 312), span("34", 340, 600, 352)];
    expect(textInBox(cols, [60, 595, 400, 615])).toBe("Ending balance 12 34");
  });
  it("accepts a box given in any corner order and ignores empty items", () => {
    expect(textInBox([...items, box(" ", 400, 600, 3)], [470, 615, 395, 596])).toBe("$83,421.17");
  });
  it("returns an empty string for an empty selection", () => {
    expect(textInBox(items, [0, 0, 10, 10])).toBe("");
  });
  it("counts text drawn twice in the same place once (faux bold)", () => {
    const doubled = [span("157764.73", 109.078, 361.284, 152.938, 370.27), span("157764.73", 109.652, 361.284, 153.512, 370.269)];
    expect(textInBox(doubled, [100, 355, 160, 375])).toBe("157764.73");
  });
  it("keeps repeated strings that are in different places", () => {
    const two = [box("100", 72, 600), box("100", 200, 600)];
    expect(textInBox(two, [0, 590, 400, 620])).toBe("100 100");
  });
  it("handles Hebrew text as ordinary strings", () => {
    expect(textInBox([box("יתרה", 300, 500, 30), box("₪42,318", 200, 500, 40)], [150, 495, 400, 520])).toBe("₪42,318 יתרה");
  });
});

describe("textItemRect", () => {
  it("unrotated item", () => {
    expect(textItemRect({ str: "x", transform: [11, 0, 0, 11, 72, 600], width: 50, height: 11 })).toEqual([72, 600, 122, 611]);
  });
  it("90 degree rotated text", () => {
    const r = textItemRect({ str: "x", transform: [0, 11, -11, 0, 100, 200], width: 50, height: 11 });
    expect(r).toEqual([89, 200, 100, 250]);
  });
  it("toTextBoxes drops empty strings", () => {
    const out = toTextBoxes([
      { str: "", transform: [1, 0, 0, 1, 0, 0], width: 0, height: 0 },
      { str: "a", transform: [10, 0, 0, 10, 5, 5], width: 5, height: 10 },
    ]);
    expect(out).toEqual([{ str: "a", rect: [5, 5, 10, 15] }]);
  });
});
