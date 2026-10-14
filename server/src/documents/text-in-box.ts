// Pure helper: the text inside a user-drawn box. Dependency-free on purpose so it
// can be shared with the web UI. Coordinates are PDF user space (origin bottom-left).

export interface BoxedText {
  str: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** [x0, y0, x1, y1] in PDF points, unrotated. Corner order does not matter. */
export type BBox = readonly [number, number, number, number];

const NUMERIC_PIECE = /^(?:[$€£₪]|[$€£₪(+\-−]?[\d.,]+[%)]?)$/u;

function isNumericPiece(s: string): boolean {
  return NUMERIC_PIECE.test(s);
}

function fractionInside(item: BoxedText, box: { x0: number; y0: number; x1: number; y1: number }): number {
  const ix = Math.min(item.x1, box.x1) - Math.max(item.x0, box.x0);
  const iy = Math.min(item.y1, box.y1) - Math.max(item.y0, box.y0);
  const w = item.x1 - item.x0;
  const h = item.y1 - item.y0;
  if (w <= 0 || h <= 0) {
    // Degenerate item: fall back to its centre point.
    const cx = (item.x0 + item.x1) / 2;
    const cy = (item.y0 + item.y1) / 2;
    return cx >= box.x0 && cx <= box.x1 && cy >= box.y0 && cy <= box.y1 ? 1 : 0;
  }
  if (ix <= 0 || iy <= 0) return 0;
  return (ix * iy) / (w * h);
}

/**
 * Text of the items that are at least 50% (by area) inside `bbox`, ordered top to
 * bottom then left to right. Adjacent numeric pieces on a line (e.g. "83,4" "21.17"
 * or "$" "83,421.17") are joined without a space; everything else with one space.
 */
export function textInBox(items: readonly BoxedText[], bbox: BBox): string {
  const box = {
    x0: Math.min(bbox[0], bbox[2]),
    y0: Math.min(bbox[1], bbox[3]),
    x1: Math.max(bbox[0], bbox[2]),
    y1: Math.max(bbox[1], bbox[3]),
  };
  const inside = items.filter((i) => i.str.trim() !== "" && fractionInside(i, box) >= 0.5);

  // Group into lines by vertical position, top first.
  const sorted = [...inside].sort((a, b) => b.y1 + b.y0 - (a.y1 + a.y0));
  const lines: { mid: number; h: number; items: BoxedText[] }[] = [];
  for (const item of sorted) {
    const mid = (item.y0 + item.y1) / 2;
    const h = Math.max(item.y1 - item.y0, 1);
    const line = lines.find((l) => Math.abs(l.mid - mid) <= 0.5 * Math.min(l.h, h));
    if (line) line.items.push(item);
    else lines.push({ mid, h, items: [item] });
  }

  return lines
    .map((line) => {
      const row = line.items.sort((a, b) => a.x0 - b.x0);
      let out = "";
      let prev: BoxedText | undefined;
      for (const item of row) {
        const s = item.str.trim();
        if (prev) {
          const gap = item.x0 - prev.x1;
          const joined = isNumericPiece(prev.str.trim()) && isNumericPiece(s) && gap <= 0.35 * line.h;
          out += joined ? s : ` ${s}`;
        } else {
          out = s;
        }
        prev = item;
      }
      return out;
    })
    .join(" ");
}
