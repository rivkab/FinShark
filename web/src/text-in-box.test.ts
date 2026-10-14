import { describe, expect, it } from "vitest";
import { overlapFraction, textInBox, textItemRect, toTextBoxes, type TextBox } from "./text-in-box.ts";

// Helvetica-ish boxes: width = 6 * chars at size 10, height 10, baseline y.
function box(str: string, x: number, y: number, w = str.length * 6, h = 10): TextBox {
  return { str, rect: [x, y, x + w, y + h] };
}

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
    // "$83,421.17" spans x 400..460; box covers 400..440 = 2/3 -> in; 400..420 = 1/3 -> out
    expect(textInBox(items, [400, 596, 440, 615])).toBe("$83,421.17");
    expect(textInBox(items, [400, 596, 420, 615])).toBe("");
    // vertically: item y 600..610
    expect(textInBox(items, [395, 604, 470, 650])).toBe("$83,421.17");
    expect(textInBox(items, [395, 607, 470, 650])).toBe("");
  });
  it("orders top-to-bottom then left-to-right, regardless of input order", () => {
    const shuffled = [items[3]!, items[1]!, items[2]!, items[0]!];
    expect(textInBox(shuffled, [0, 570, 612, 620])).toBe("Ending balance $83,421.17 Interest paid $1,204.33");
  });
  it("treats items with slightly different baselines as one line", () => {
    const a = box("Total", 72, 600);
    const b = box("42", 130, 601);
    expect(textInBox([b, a], [0, 590, 300, 620])).toBe("Total 42");
  });
  it("joins touching numeric pieces without spaces", () => {
    const parts = [box("$", 400, 600, 6), box("83", 406, 600, 12), box(",421", 418, 600, 24), box(".17", 442, 600, 18)];
    expect(textInBox(parts, [390, 595, 480, 615])).toBe("$83,421.17");
  });
  it("keeps separate numbers apart when there is a gap", () => {
    const parts = [box("2025", 100, 600, 24), box("12", 150, 600, 12)];
    expect(textInBox(parts, [90, 595, 200, 615])).toBe("2025 12");
  });
  it("does not glue words to numbers", () => {
    const parts = [box("Account", 72, 600, 42), box("4821", 118, 600, 24)];
    expect(textInBox(parts, [60, 595, 200, 615])).toBe("Account 4821");
  });
  it("accepts a box given in any corner order and ignores empty items", () => {
    expect(textInBox([...items, box(" ", 400, 600, 3)], [470, 615, 395, 596])).toBe("$83,421.17");
  });
  it("returns an empty string for an empty selection", () => {
    expect(textInBox(items, [0, 0, 10, 10])).toBe("");
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
