import { describe, expect, it } from "vitest";
import {
  makeViewportTransform,
  normalizeRect,
  pdfRectToViewport,
  viewportSize,
  viewportToPdfRect,
  type PageRotation,
  type PdfRect,
} from "./pdf-geometry.ts";

const page = { width: 612, height: 792 };
const rotations: PageRotation[] = [0, 90, 180, 270];

function close(a: number[], b: number[]) {
  expect(a).toHaveLength(b.length);
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 9));
}

describe("normalizeRect", () => {
  it("orders corners", () => {
    expect(normalizeRect([10, 20, 5, 2])).toEqual([5, 2, 10, 20]);
    expect(normalizeRect([1, 2, 3, 4])).toEqual([1, 2, 3, 4]);
  });
});

describe("pdfRectToViewport", () => {
  const rect: PdfRect = [72, 600, 172, 620];
  it("rotation 0: flips y, scales", () => {
    close(pdfRectToViewport(rect, makeViewportTransform(page, 1, 0)), [72, 172, 172, 192]);
    close(pdfRectToViewport(rect, makeViewportTransform(page, 2, 0)), [144, 344, 344, 384]);
  });
  it("rotation 90: x maps to Y, y maps to X", () => {
    close(pdfRectToViewport(rect, makeViewportTransform(page, 1, 90)), [600, 72, 620, 172]);
  });
  it("rotation 180", () => {
    close(pdfRectToViewport(rect, makeViewportTransform(page, 1, 180)), [440, 600, 540, 620]);
  });
  it("rotation 270: X = h - y, Y = w - x", () => {
    close(pdfRectToViewport(rect, makeViewportTransform(page, 1, 270)), [172, 440, 192, 540]);
  });
  it("whole page fills the rendered viewport for every rotation", () => {
    for (const r of rotations) {
      const size = viewportSize(page, 1.5, r);
      const v = pdfRectToViewport([0, 0, page.width, page.height], makeViewportTransform(page, 1.5, r));
      close(v, [0, 0, size.width, size.height]);
    }
  });
});

describe("viewportToPdfRect", () => {
  it("round-trips for all rotations and scales", () => {
    const rects: PdfRect[] = [
      [72, 600, 172, 620],
      [0, 0, 612, 792],
      [300.25, 100.5, 301.75, 111.125],
    ];
    for (const r of rotations)
      for (const s of [0.5, 1, 1.33, 2.5])
        for (const rect of rects) {
          const t = makeViewportTransform(page, s, r);
          close(viewportToPdfRect(pdfRectToViewport(rect, t), t), rect);
        }
  });
  it("normalizes a rectangle dragged in any direction", () => {
    const t = makeViewportTransform(page, 1, 0);
    close(viewportToPdfRect([172, 192, 72, 172], t), [72, 600, 172, 620]);
    close(viewportToPdfRect([72, 172, 172, 192], t), [72, 600, 172, 620]);
  });
  it("is independent of zoom", () => {
    close(viewportToPdfRect([144, 344, 344, 384], makeViewportTransform(page, 2, 0)), [72, 600, 172, 620]);
  });
  it("handles rotated pages", () => {
    close(viewportToPdfRect([600, 72, 620, 172], makeViewportTransform(page, 1, 90)), [72, 600, 172, 620]);
    close(viewportToPdfRect([172, 440, 192, 540], makeViewportTransform(page, 1, 270)), [72, 600, 172, 620]);
  });
  it("accepts a transform with arbitrary offsets", () => {
    const t: [number, number, number, number, number, number] = [1.5, 0, 0, -1.5, 10, 1198];
    close(viewportToPdfRect(pdfRectToViewport([10, 20, 30, 40], t), t), [10, 20, 30, 40]);
  });
  it("rejects a singular transform", () => {
    expect(() => viewportToPdfRect([0, 0, 1, 1], [0, 0, 0, 0, 0, 0])).toThrow();
  });
});

describe("viewportSize", () => {
  it("swaps for 90/270", () => {
    expect(viewportSize(page, 2, 0)).toEqual({ width: 1224, height: 1584 });
    expect(viewportSize(page, 2, 90)).toEqual({ width: 1584, height: 1224 });
    expect(viewportSize(page, 1, 270)).toEqual({ width: 792, height: 612 });
  });
});
