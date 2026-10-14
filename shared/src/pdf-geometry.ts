// Pure PDF geometry helpers (no dependencies).
//
// Stored boxes (DESIGN §2.5) are `[x0, y0, x1, y1]` in unrotated PDF points with the
// origin at the bottom-left of the page. On screen, pdf.js describes a rendered page
// with a 6-number viewport transform `[a, b, c, d, e, f]` (canvas-style matrix) that
// folds in scale, page rotation and the y-flip:
//
//   X = a*x + c*y + e
//   Y = b*x + d*y + f
//
// Taking that matrix as input keeps this module independent of pdf.js.

/** [x0, y0, x1, y1] in unrotated PDF points, origin bottom-left. */
export type PdfRect = [number, number, number, number];

/** [left, top, right, bottom] in viewport (CSS/canvas) pixels, origin top-left. */
export type ViewportRect = [number, number, number, number];

/** pdf.js `PageViewport.transform`. */
export type ViewportTransform = [number, number, number, number, number, number];

export type PageRotation = 0 | 90 | 180 | 270;

/** Reorder so x0 <= x1 and y0 <= y1. */
export function normalizeRect<T extends [number, number, number, number]>(rect: T): T {
  const [a, b, c, d] = rect;
  return [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)] as T;
}

function applyTransform(t: ViewportTransform, x: number, y: number): [number, number] {
  return [t[0] * x + t[2] * y + t[4], t[1] * x + t[3] * y + t[5]];
}

function invertTransform(t: ViewportTransform): ViewportTransform {
  const [a, b, c, d, e, f] = t;
  const det = a * d - b * c;
  if (det === 0 || !Number.isFinite(det)) throw new Error("Viewport transform is not invertible");
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

function mapRect(t: ViewportTransform, rect: [number, number, number, number]): [number, number, number, number] {
  const [ax, ay] = applyTransform(t, rect[0], rect[1]);
  const [bx, by] = applyTransform(t, rect[2], rect[3]);
  return normalizeRect([ax, ay, bx, by]);
}

/** Convert a rectangle drawn on the rendered page into unrotated PDF points (normalized). */
export function viewportToPdfRect(rect: ViewportRect, transform: ViewportTransform): PdfRect {
  return mapRect(invertTransform(transform), rect);
}

/** Convert a stored PDF-point rectangle into viewport pixels (normalized: left<=right, top<=bottom). */
export function pdfRectToViewport(rect: PdfRect, transform: ViewportTransform): ViewportRect {
  return mapRect(transform, rect);
}

/**
 * Build the same transform pdf.js's `PageViewport` produces for a page whose view box
 * is `[0, 0, width, height]` (unrotated points), at `scale` and `rotation` (clockwise,
 * the effective rotation = page /Rotate + user rotation). Mainly for tests and for
 * code that has no pdf.js viewport at hand.
 */
export function makeViewportTransform(
  page: { width: number; height: number },
  scale: number,
  rotation: PageRotation,
): ViewportTransform {
  const { width: w, height: h } = page;
  const s = scale;
  switch (rotation) {
    case 0:
      return [s, 0, 0, -s, 0, h * s];
    case 90:
      return [0, s, s, 0, 0, 0];
    case 180:
      return [-s, 0, 0, s, w * s, 0];
    case 270:
      return [0, -s, -s, 0, h * s, w * s];
  }
}

/** Size in viewport pixels of a page rendered with the given rotation and scale. */
export function viewportSize(
  page: { width: number; height: number },
  scale: number,
  rotation: PageRotation,
): { width: number; height: number } {
  const swap = rotation === 90 || rotation === 270;
  return { width: (swap ? page.height : page.width) * scale, height: (swap ? page.width : page.height) * scale };
}
