// Text under a user-drawn box. Pure; no DOM, no pdf.js.
// A server-side version is being written separately and will be unified later.

import { normalizeRect, type PdfRect } from "@finshark/shared";

/** One text-layer item with its bounding box in unrotated PDF points. */
export interface TextBox {
  str: string;
  rect: PdfRect;
}

/** Minimal shape of a pdf.js TextItem that we need. */
export interface PdfJsTextItemLike {
  str: string;
  /** [a, b, c, d, e, f] in PDF user space. */
  transform: number[];
  width: number;
  height: number;
}

/** Bounding box (PDF points) of a pdf.js text item, including rotated text. */
export function textItemRect(item: PdfJsTextItemLike): PdfRect {
  const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = item.transform;
  const lenX = Math.hypot(a, b) || 1;
  const lenY = Math.hypot(c, d) || 1;
  const ux = (a / lenX) * item.width;
  const uy = (b / lenX) * item.width;
  const vx = (c / lenY) * item.height;
  const vy = (d / lenY) * item.height;
  const xs = [e, e + ux, e + vx, e + ux + vx];
  const ys = [f, f + uy, f + vy, f + uy + vy];
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

export function toTextBoxes(items: readonly PdfJsTextItemLike[]): TextBox[] {
  return items.filter((i) => i.str.length > 0).map((i) => ({ str: i.str, rect: textItemRect(i) }));
}

/** Fraction of `inner`'s area inside `outer`; zero-area items use their center point. */
export function overlapFraction(inner: PdfRect, outer: PdfRect): number {
  const w = inner[2] - inner[0];
  const h = inner[3] - inner[1];
  if (w <= 0 || h <= 0) {
    const cx = (inner[0] + inner[2]) / 2;
    const cy = (inner[1] + inner[3]) / 2;
    return cx >= outer[0] && cx <= outer[2] && cy >= outer[1] && cy <= outer[3] ? 1 : 0;
  }
  const iw = Math.min(inner[2], outer[2]) - Math.max(inner[0], outer[0]);
  const ih = Math.min(inner[3], outer[3]) - Math.max(inner[1], outer[1]);
  if (iw <= 0 || ih <= 0) return 0;
  return (iw * ih) / (w * h);
}

const CURRENCY = /^[$€£₪¥]$/;

/** Pieces of one number split by the PDF (e.g. "83", ",421", ".17") are joined without spaces. */
function joinsWithoutSpace(prev: string, next: string): boolean {
  if (CURRENCY.test(prev.trim())) return /^[\d(.,-]/.test(next);
  return /[\d,.]$/.test(prev) && /^[\d,.%)]/.test(next);
}

/**
 * Text of all items at least 50% inside `box`, ordered top-to-bottom then left-to-right.
 * Items on the same visual line (vertical centers within half an item height) are one line.
 */
export function textInBox(items: readonly TextBox[], box: PdfRect, minOverlap = 0.5): string {
  const b = normalizeRect(box);
  const hit = items
    .filter((i) => i.str.trim().length > 0 && overlapFraction(normalizeRect(i.rect), b) >= minOverlap)
    .map((i) => {
      const r = normalizeRect(i.rect);
      return { str: i.str, x0: r[0], x1: r[2], cy: (r[1] + r[3]) / 2, h: r[3] - r[1] };
    })
    .sort((p, q) => q.cy - p.cy || p.x0 - q.x0);

  // Group into lines.
  const lines: (typeof hit)[] = [];
  for (const item of hit) {
    const line = lines[lines.length - 1];
    const ref = line?.[0];
    if (line && ref && Math.abs(ref.cy - item.cy) <= Math.max(ref.h, item.h) / 2) line.push(item);
    else lines.push([item]);
  }
  return lines
    .map((line) => {
      line.sort((p, q) => p.x0 - q.x0);
      let out = "";
      let prevX1 = 0;
      for (const it of line) {
        const s = it.str.trim();
        // Numeric pieces only fuse when (nearly) touching, so "2025 12" stays two numbers.
        const touching = it.x0 - prevX1 <= it.h * 0.5;
        out += out === "" ? s : touching && joinsWithoutSpace(out, s) ? s : ` ${s}`;
        prevX1 = it.x1;
      }
      return out;
    })
    .join(" ");
}
