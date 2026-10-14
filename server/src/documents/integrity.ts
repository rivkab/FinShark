import fs from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { documentRelativePath, resolveInVault, type VaultLayout } from "../vault/layout.ts";
import { sha256File } from "./hash.ts";

export interface DocumentIntegrityReport {
  ok: boolean;
  checked: number;
  missingFiles: { documentId: number; storedPath: string }[];
  hashMismatches: { documentId: number; storedPath: string; expected: string; actual: string }[];
  /** Files under documents/ that no row refers to (including leftover temp files). */
  orphanFiles: string[];
  /** Rows whose stored_path is not documents/<year>/<sha[0:2]>/<sha>.<ext>. */
  badStoredPaths: { documentId: number; storedPath: string; expected: string }[];
}

async function* walk(dir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
    throw e;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

export async function checkDocuments(deps: { db: DatabaseSync; layout: VaultLayout }): Promise<DocumentIntegrityReport> {
  const { db, layout } = deps;
  const rows = db
    .prepare("SELECT id, sha256, stored_path, imported_at FROM documents ORDER BY id")
    .all() as { id: number; sha256: string; stored_path: string; imported_at: string }[];

  const report: DocumentIntegrityReport = {
    ok: true,
    checked: rows.length,
    missingFiles: [],
    hashMismatches: [],
    orphanFiles: [],
    badStoredPaths: [],
  };

  const known = new Set<string>();
  for (const row of rows) {
    const documentId = Number(row.id);
    const storedPath = row.stored_path;
    known.add(storedPath);

    // The year is the import year and the extension the file type; both are taken
    // from the row (falling back to imported_at / pdf) when the path is malformed.
    const m = /\/(\d{4})\/[^/]*\/[^/]*\.([A-Za-z0-9]+)$/.exec(storedPath);
    const year = m ? Number(m[1]) : new Date(row.imported_at).getUTCFullYear();
    const expected = documentRelativePath(row.sha256, Number.isFinite(year) ? year : 0, m?.[2] ?? "pdf");
    const conforms = expected === storedPath;
    if (!conforms) report.badStoredPaths.push({ documentId, storedPath, expected });

    let abs: string;
    try {
      abs = resolveInVault(layout, storedPath);
    } catch {
      if (conforms) report.badStoredPaths.push({ documentId, storedPath, expected });
      continue;
    }
    try {
      const actual = await sha256File(abs);
      if (actual !== row.sha256) {
        report.hashMismatches.push({ documentId, storedPath, expected: row.sha256, actual });
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") report.missingFiles.push({ documentId, storedPath });
      else throw e;
    }
  }

  for await (const file of walk(layout.documentsDir)) {
    const rel = path.relative(layout.root, file).split(path.sep).join("/");
    if (!known.has(rel)) report.orphanFiles.push(rel);
  }
  report.orphanFiles.sort();

  report.ok =
    report.missingFiles.length === 0 &&
    report.hashMismatches.length === 0 &&
    report.orphanFiles.length === 0 &&
    report.badStoredPaths.length === 0;
  return report;
}
