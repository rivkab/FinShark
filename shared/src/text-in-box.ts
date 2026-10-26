// The text under a user-drawn box. Pure and dependency-free: the web UI uses it to
// show what a box covers, the server uses it to recompute `quoted_text` (never trust
// client text). Coordinates are unrotated PDF points, origin bottom-left.

import { normalizeRect, type PdfRect } from "./pdf-geometry.ts";

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

/** A piece of a number: a lone currency sign, or digits/separators with optional sign, parens or percent. */
const NUMERIC_PIECE = /^(?:[$€£₪¥]|[$€£₪¥(+\-−]?[\d.,]+[%)]?)$/u;

/** Pieces closer than this fraction of the line height count as touching. */
const JOIN_GAP = 0.35;

/** Same string drawn over itself (faux bold): rects overlapping at least this much are one item. */
const DUPLICATE_OVERLAP = 0.8;

const isNumericPiece = (s: string): boolean => NUMERIC_PIECE.test(s);

/** Drops items that repeat an earlier item's string at (almost) the same place. */
function dropOverdrawn<T extends { str: string; x0: number; x1: number; cy: number; h: number }>(items: T[]): T[] {
  const kept: T[] = [];
  for (const it of items) {
    const dup = kept.some((k) => {
      if (k.str !== it.str) return false;
      const w = Math.min(k.x1, it.x1) - Math.max(k.x0, it.x0);
      const narrower = Math.min(k.x1 - k.x0, it.x1 - it.x0);
      const sameLine = Math.abs(k.cy - it.cy) <= Math.max(k.h, it.h) / 2;
      return sameLine && (narrower <= 0 ? w >= 0 : w / narrower >= DUPLICATE_OVERLAP);
    });
    if (!dup) kept.push(it);
  }
  return kept;
}

/**
 * Text of the items that are at least `minOverlap` (default 50%, by area) inside `box`.
 * Ordered top to bottom, then left to right. Items whose vertical centers are within
 * half the taller item's height share a line. On a line, two numeric pieces are joined
 * without a space only when nearly touching (gap <= 0.35 x line height), so "2025 12"
 * stays two tokens; everything else is joined with one space. Lines are joined with
 * a single space. An item drawn twice in the same place (faux bold) counts once.
 */
export function textInBox(items: readonly TextBox[], box: PdfRect, minOverlap = 0.5): string {
  const b = normalizeRect(box);
  const candidates = items
    .filter((i) => i.str.trim().length > 0 && overlapFraction(normalizeRect(i.rect), b) >= minOverlap)
    .map((i) => {
      const r = normalizeRect(i.rect);
      return { str: i.str.trim(), x0: r[0], x1: r[2], cy: (r[1] + r[3]) / 2, h: Math.max(r[3] - r[1], 1) };
    })
    .sort((p, q) => q.cy - p.cy || p.x0 - q.x0);
  const hit = dropOverdrawn(candidates);

  const lines: { cy: number; h: number; items: typeof hit }[] = [];
  for (const item of hit) {
    const line = lines.find((l) => Math.abs(l.cy - item.cy) <= Math.max(l.h, item.h) / 2);
    if (line) {
      line.items.push(item);
      line.h = Math.max(line.h, item.h);
    } else {
      lines.push({ cy: item.cy, h: item.h, items: [item] });
    }
  }
  lines.sort((p, q) => q.cy - p.cy);

  return lines
    .map((line) => {
      const row = [...line.items].sort((p, q) => p.x0 - q.x0);
      let out = "";
      let prev: (typeof row)[number] | undefined;
      for (const it of row) {
        if (!prev) out = it.str;
        else {
          const touching = it.x0 - prev.x1 <= JOIN_GAP * line.h;
          out += touching && isNumericPiece(prev.str) && isNumericPiece(it.str) ? it.str : ` ${it.str}`;
        }
        prev = it;
      }
      return out;
    })
    .join(" ");
}
