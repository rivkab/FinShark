import type { DatabaseSync } from "node:sqlite";
import { resolveInVault, type VaultLayout } from "../vault/layout.ts";
import { extractWithPdfjs, getTextLayer, type ExtractFn, type TextLayer } from "./text-layer.ts";

/** Share of Hebrew among all Hebrew and Latin letters at which a document counts as Hebrew. */
export const HEBREW_SHARE = 0.3;

/**
 * 'he' when Hebrew letters make up a clear share of the letters in the text layer, 'en' when
 * Latin letters dominate, null when there is no text to judge (scans). Counting letters rather
 * than reading order, so it does not depend on how the PDF stores right-to-left text.
 * Bilingual statements are common, hence the share rather than "any Hebrew".
 */
export function detectLanguage(layer: Pick<TextLayer, "pages">): "en" | "he" | null {
  let hebrew = 0;
  let latin = 0;
  for (const page of layer.pages) {
    for (const item of page.items) {
      for (const ch of item.str) {
        if (/\p{Script=Hebrew}/u.test(ch)) hebrew++;
        else if (/\p{Script=Latin}/u.test(ch)) latin++;
      }
    }
  }
  const letters = hebrew + latin;
  if (letters === 0) return null;
  return hebrew / letters >= HEBREW_SHARE ? "he" : "en";
}

/**
 * Sets the language of documents that have none, from their text layers. Never changes a
 * language that is set. Returns how many documents were filled in.
 */
export async function fillMissingLanguages(
  deps: { db: DatabaseSync; layout: VaultLayout; extractText?: ExtractFn },
): Promise<number> {
  const rows = deps.db
    .prepare("SELECT id, sha256, stored_path FROM documents WHERE language IS NULL AND status <> 'removed' ORDER BY id")
    .all() as { id: number; sha256: string; stored_path: string }[];
  let filled = 0;
  for (const r of rows) {
    const layer = await getTextLayer(deps.layout, r.sha256, resolveInVault(deps.layout, r.stored_path), deps.extractText ?? extractWithPdfjs);
    const language = detectLanguage(layer);
    if (language === null) continue;
    deps.db.prepare("UPDATE documents SET language = ? WHERE id = ? AND language IS NULL").run(language, r.id);
    filled++;
  }
  return filled;
}
