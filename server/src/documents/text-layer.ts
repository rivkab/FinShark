import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { VaultLayout } from "../vault/layout.ts";
import { sha256Text } from "./hash.ts";

/** Bump when extraction output changes; cached layers of other versions are ignored. */
export const TEXT_LAYER_VERSION = 1;

export interface TextItem {
  str: string;
  /** Box in unrotated PDF user space, points, origin bottom-left. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  dir: string;
}

export interface PageTextLayer {
  pageNo: number;
  widthPt: number;
  heightPt: number;
  rotation: 0 | 90 | 180 | 270;
  textSource: "native" | "none";
  /** sha256 of the normalized page text; null when the page has no text. */
  textSha256: string | null;
  items: TextItem[];
}

export interface TextLayer {
  version: number;
  sha256: string;
  /** sha256 of the normalized text of all pages; null when the document has no text. */
  textFingerprint: string | null;
  pages: PageTextLayer[];
}

export type ExtractFn = (pdfPath: string) => Promise<Pick<TextLayer, "textFingerprint" | "pages">>;

/** Collapse all whitespace runs to one space and trim. Nothing else is stripped. */
export function normalizeText(s: string): string {
  return s.replace(/\s+/gu, " ").trim();
}

const round = (n: number) => Math.round(n * 1000) / 1000;

function pdfjsPaths() {
  const require = createRequire(import.meta.url);
  const dir = path.dirname(require.resolve("pdfjs-dist/package.json"));
  return {
    cMapUrl: path.join(dir, "cmaps") + path.sep,
    standardFontDataUrl: path.join(dir, "standard_fonts") + path.sep,
    wasmUrl: path.join(dir, "wasm") + path.sep,
  };
}

/** Default extractor: pdf.js text layer, per-page geometry and positioned items. */
export const extractWithPdfjs: ExtractFn = async (pdfPath) => {
  const data = new Uint8Array(await fs.readFile(pdfPath));
  // isEvalSupported is honoured at runtime but missing from the v6 type declarations.
  const params: Parameters<typeof getDocument>[0] & { isEvalSupported: boolean } = {
    data,
    ...pdfjsPaths(),
    isEvalSupported: false,
    disableFontFace: true,
    verbosity: 0,
  };
  const task = getDocument(params);
  try {
    const doc = await task.promise;
    const pages: PageTextLayer[] = [];
    const pageTexts: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const [vx0 = 0, vy0 = 0, vx1 = 0, vy1 = 0] = page.view;
      const rot = (((page.rotate % 360) + 360) % 360) as 0 | 90 | 180 | 270;
      const content = await page.getTextContent();
      const items: TextItem[] = [];
      for (const it of content.items) {
        if (!("str" in it) || it.str === "") continue;
        const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = it.transform;
        const la = Math.hypot(a, b) || 1;
        const lc = Math.hypot(c, d) || 1;
        const height = it.height || lc;
        const ax = (a / la) * it.width;
        const ay = (b / la) * it.width;
        const ux = (c / lc) * height;
        const uy = (d / lc) * height;
        const xs = [e, e + ax, e + ux, e + ax + ux];
        const ys = [f, f + ay, f + uy, f + ay + uy];
        items.push({
          str: it.str,
          x0: round(Math.min(...xs)),
          y0: round(Math.min(...ys)),
          x1: round(Math.max(...xs)),
          y1: round(Math.max(...ys)),
          dir: it.dir,
        });
      }
      const text = normalizeText(items.map((i) => i.str).join(" "));
      pageTexts.push(text);
      pages.push({
        pageNo: n,
        widthPt: round(vx1 - vx0),
        heightPt: round(vy1 - vy0),
        rotation: rot,
        textSource: text === "" ? "none" : "native",
        textSha256: text === "" ? null : sha256Text(text),
        items,
      });
      page.cleanup();
    }
    const all = normalizeText(pageTexts.join(" "));
    return { textFingerprint: all === "" ? null : sha256Text(all), pages };
  } finally {
    await task.destroy();
  }
};

export function textCachePath(layout: VaultLayout, sha256: string): string {
  return path.join(layout.cacheDir, "text", `${sha256}.v${TEXT_LAYER_VERSION}.json`);
}

async function readCache(file: string, sha256: string): Promise<TextLayer | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8")) as TextLayer;
    if (parsed.version === TEXT_LAYER_VERSION && parsed.sha256 === sha256 && Array.isArray(parsed.pages)) {
      return parsed;
    }
  } catch {
    // missing or corrupt: regenerate
  }
  return null;
}

/**
 * Text layer for the PDF with the given content hash; served from
 * `<vault>/cache/text/<sha256>.v<N>.json` when present, otherwise extracted and cached.
 */
export async function getTextLayer(
  layout: VaultLayout,
  sha256: string,
  pdfPath: string,
  extract: ExtractFn = extractWithPdfjs,
): Promise<TextLayer> {
  const file = textCachePath(layout, sha256);
  const cached = await readCache(file, sha256);
  if (cached) return cached;

  const layer: TextLayer = { version: TEXT_LAYER_VERSION, sha256, ...(await extract(pdfPath)) };
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(layer));
  await fs.rename(tmp, file);
  return layer;
}
