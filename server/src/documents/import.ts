import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { documentRelativePath, resolveInVault, type VaultLayout } from "../vault/layout.ts";
import { sha256File } from "./hash.ts";
import { detectLanguage } from "./language.ts";
import { extractPeriod, periodFill } from "./period.ts";
import { extractWithPdfjs, getTextLayer, type ExtractFn } from "./text-layer.ts";

export interface ImportDeps {
  db: DatabaseSync;
  layout: VaultLayout;
  now: () => Date;
  /** Override the text extractor (tests). */
  extractText?: ExtractFn;
}

export interface ImportOptions {
  institutionId?: number;
  language?: "en" | "he";
  docType?: string;
  identityKey?: string;
  issuedOn?: string;
  periodStart?: string;
  periodEnd?: string;
  taxYear?: number;
}

export type ImportResult =
  | { status: "duplicate"; existingDocumentId: number; sha256: string }
  | {
      status: "imported";
      documentId: number;
      sha256: string;
      storedPath: string;
      pageCount: number;
      /** Other documents with the same normalized text (different bytes). */
      possibleDuplicateOf: number[];
      /** Non-removed documents with the same identity_key (different bytes). */
      possibleRevisionOf: number[];
    };

export class ImportError extends Error {}

const PDF_MAGIC = Buffer.from("%PDF-");

async function assertPdf(sourcePath: string): Promise<void> {
  const st = await fs.stat(sourcePath);
  if (!st.isFile()) throw new ImportError(`Not a regular file: ${sourcePath}`);
  const fh = await fs.open(sourcePath, "r");
  try {
    const head = Buffer.alloc(PDF_MAGIC.length);
    const { bytesRead } = await fh.read(head, 0, head.length, 0);
    if (bytesRead < PDF_MAGIC.length || !head.equals(PDF_MAGIC)) {
      throw new ImportError(`Unsupported file type: ${path.basename(sourcePath)} is not a PDF (missing %PDF- header)`);
    }
  } finally {
    await fh.close();
  }
}

async function fsyncDir(dir: string): Promise<void> {
  const fh = await fs.open(dir, "r");
  try {
    await fh.sync();
  } finally {
    await fh.close();
  }
}

/**
 * Copy `src` to `dest` atomically (temp file in the same directory, fsync, rename,
 * fsync directory), verifying the copied bytes hash to `expectedSha`. The result is read-only.
 */
async function storeFile(src: string, dest: string, expectedSha: string): Promise<void> {
  const dir = path.dirname(dest);
  await fs.mkdir(dir, { recursive: true });

  // An orphan from an earlier crash with identical content can be reused as is.
  try {
    if ((await sha256File(dest)) === expectedSha) {
      await fs.chmod(dest, 0o444);
      return;
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }

  const tmp = path.join(dir, `.${path.basename(dest)}.${randomBytes(6).toString("hex")}.tmp`);
  const input = await fs.open(src, "r");
  let output: fs.FileHandle | undefined;
  try {
    output = await fs.open(tmp, "wx", 0o600);
    const hash = createHash("sha256");
    const buf = Buffer.alloc(1024 * 1024);
    for (;;) {
      const { bytesRead } = await input.read(buf, 0, buf.length, null);
      if (bytesRead === 0) break;
      hash.update(buf.subarray(0, bytesRead));
      await output.write(buf, 0, bytesRead);
    }
    if (hash.digest("hex") !== expectedSha) {
      throw new ImportError(`Source file changed while importing: ${src}`);
    }
    await output.sync();
    await output.close();
    output = undefined;
    await fs.chmod(tmp, 0o444);
    await fs.rename(tmp, dest);
    await fsyncDir(dir);
  } catch (e) {
    await output?.close().catch(() => {});
    await fs.rm(tmp, { force: true });
    throw e;
  } finally {
    await input.close();
  }
}

function idsOf(rows: unknown[]): number[] {
  return rows.map((r) => Number((r as { id: number | bigint }).id));
}

/**
 * DESIGN §3 steps 1-4 and 7: hash, store, text layer, fingerprint, duplicate and
 * revision hints. The file is stored first, the rows inserted afterwards in one
 * transaction (DESIGN §7: a crash leaves an orphan file, never a dangling row).
 */
export async function importDocument(
  deps: ImportDeps,
  sourcePath: string,
  opts: ImportOptions = {},
): Promise<ImportResult> {
  const { db, layout, now } = deps;

  await assertPdf(sourcePath);
  const sha256 = await sha256File(sourcePath);

  const existing = db.prepare("SELECT id FROM documents WHERE sha256 = ?").get(sha256) as { id: number } | undefined;
  if (existing) return { status: "duplicate", existingDocumentId: Number(existing.id), sha256 };

  // Extract before storing so an unreadable PDF leaves nothing behind.
  const text = await getTextLayer(layout, sha256, sourcePath, deps.extractText ?? extractWithPdfjs);

  const importedAt = now();
  const storedPath = documentRelativePath(sha256, importedAt.getUTCFullYear(), "pdf");
  await storeFile(sourcePath, resolveInVault(layout, storedPath), sha256);
  const byteSize = (await fs.stat(resolveInVault(layout, storedPath))).size;

  const insertDoc = db.prepare(
    `INSERT INTO documents (sha256, stored_path, original_filename, byte_size, mime, page_count, imported_at,
       doc_type, institution_id, language, issued_on, period_start, period_end, tax_year,
       identity_key, text_fingerprint, status, metadata)
     VALUES (?, ?, ?, ?, 'application/pdf', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'inbox', ?)`,
  );
  const insertPage = db.prepare(
    `INSERT INTO document_pages (document_id, page_no, width_pt, height_pt, rotation, text_source, text_sha256)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  db.exec("BEGIN IMMEDIATE");
  try {
    const raced = db.prepare("SELECT id FROM documents WHERE sha256 = ?").get(sha256) as { id: number } | undefined;
    if (raced) {
      db.exec("ROLLBACK");
      return { status: "duplicate", existingDocumentId: Number(raced.id), sha256 };
    }

    const possibleDuplicateOf =
      text.textFingerprint === null
        ? []
        : idsOf(
            db
              .prepare("SELECT id FROM documents WHERE text_fingerprint = ? AND status <> 'removed' ORDER BY id")
              .all(text.textFingerprint),
          );
    const possibleRevisionOf =
      opts.identityKey === undefined
        ? []
        : idsOf(
            db
              .prepare("SELECT id FROM documents WHERE identity_key = ? AND status <> 'removed' ORDER BY id")
              .all(opts.identityKey),
          );

    // Dates the caller did not give are read from the text; the source is kept for checking.
    const given = { period_start: opts.periodStart ?? null, period_end: opts.periodEnd ?? null, tax_year: opts.taxYear ?? null };
    const found = extractPeriod(text);
    const fill = found ? periodFill(given, found) : null;
    const metadata = fill && found ? { periodSource: found.source } : {};

    const res = insertDoc.run(
      sha256,
      storedPath,
      path.basename(sourcePath),
      byteSize,
      text.pages.length,
      importedAt.toISOString(),
      opts.docType ?? null,
      opts.institutionId ?? null,
      opts.language ?? detectLanguage(text),
      opts.issuedOn ?? null,
      given.period_start ?? fill?.period_start ?? null,
      given.period_end ?? fill?.period_end ?? null,
      given.tax_year ?? fill?.tax_year ?? null,
      opts.identityKey ?? null,
      text.textFingerprint,
      JSON.stringify(metadata),
    );
    const documentId = Number(res.lastInsertRowid);
    for (const p of text.pages) {
      insertPage.run(documentId, p.pageNo, p.widthPt, p.heightPt, p.rotation, p.textSource, p.textSha256);
    }
    db.exec("COMMIT");

    return {
      status: "imported",
      documentId,
      sha256,
      storedPath,
      pageCount: text.pages.length,
      possibleDuplicateOf,
      possibleRevisionOf,
    };
  } catch (e) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw e;
  }
}

/**
 * Record that `newId` supersedes `oldId` (document link only; fact handling comes later).
 * Refuses self-reference, unknown documents and cycles.
 */
export function markSupersedes(db: DatabaseSync, newId: number, oldId: number): void {
  if (newId === oldId) throw new Error("A document cannot supersede itself");
  const get = db.prepare("SELECT id, supersedes_document_id AS sup FROM documents WHERE id = ?");
  for (const id of [newId, oldId]) {
    if (!get.get(id)) throw new Error(`No such document: ${id}`);
  }
  // Walk the chain from oldId; reaching newId would create a cycle.
  let cur = (get.get(oldId) as { sup: number | null }).sup;
  const seen = new Set<number>();
  while (cur !== null && cur !== undefined && !seen.has(Number(cur))) {
    if (Number(cur) === newId) throw new Error(`Document ${oldId} already (transitively) supersedes ${newId}`);
    seen.add(Number(cur));
    cur = (get.get(Number(cur)) as { sup: number | null } | undefined)?.sup ?? null;
  }
  db.prepare("UPDATE documents SET supersedes_document_id = ? WHERE id = ?").run(oldId, newId);
}
