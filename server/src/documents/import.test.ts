import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makePdf, sampleStatementPdf } from "../testing/pdf-fixture.ts";
import { checkDocuments } from "./integrity.ts";
import { importDocument, markSupersedes, type ImportDeps } from "./import.ts";
import { extractWithPdfjs, getTextLayer, textCachePath, TEXT_LAYER_VERSION } from "./text-layer.ts";
import { makeTestVault, writeSource, type TestVault } from "./test-helpers.ts";

let v: TestVault;
let deps: ImportDeps;
const now = () => new Date("2026-10-14T12:00:00Z");

beforeEach(async () => {
  v = await makeTestVault();
  deps = { db: v.db, layout: v.layout, now };
});
afterEach(async () => {
  await v.cleanup();
});

function withComment(pdf: Uint8Array): Uint8Array {
  const s = Buffer.from(pdf).toString("latin1");
  return new Uint8Array(Buffer.from(s.replace(/%%EOF\n$/, "%x harmless\n%%EOF\n"), "latin1"));
}

describe("importDocument", () => {
  it("stores the file content-addressed, read-only, and records rows", async () => {
    const src = await writeSource(v.dir, "stmt.pdf", sampleStatementPdf());
    const r = await importDocument(deps, src, { identityKey: "ex|4821|2025|annual", language: "en", taxYear: 2025 });
    expect(r.status).toBe("imported");
    if (r.status !== "imported") return;
    expect(r.storedPath).toBe(`documents/2026/${r.sha256.slice(0, 2)}/${r.sha256}.pdf`);
    const abs = path.join(v.layout.root, r.storedPath);
    expect((await fs.stat(abs)).mode & 0o777).toBe(0o444);
    expect(await fs.readFile(abs)).toEqual(await fs.readFile(src));

    const doc = v.db.prepare("SELECT * FROM documents WHERE id = ?").get(r.documentId) as Record<string, unknown>;
    expect(doc).toMatchObject({
      sha256: r.sha256,
      stored_path: r.storedPath,
      original_filename: "stmt.pdf",
      mime: "application/pdf",
      page_count: 1,
      imported_at: "2026-10-14T12:00:00.000Z",
      identity_key: "ex|4821|2025|annual",
      language: "en",
      tax_year: 2025,
      status: "inbox",
    });
    expect(doc.text_fingerprint).toMatch(/^[0-9a-f]{64}$/);
    const pages = v.db.prepare("SELECT * FROM document_pages WHERE document_id = ?").all(r.documentId);
    expect(pages).toEqual([
      expect.objectContaining({ page_no: 1, width_pt: 612, height_pt: 792, rotation: 0, text_source: "native" }),
    ]);
    expect(r.possibleDuplicateOf).toEqual([]);
    expect(r.possibleRevisionOf).toEqual([]);
    expect((await checkDocuments(deps)).ok).toBe(true);
  });

  it("reports an exact duplicate without copying again", async () => {
    const src = await writeSource(v.dir, "a.pdf", sampleStatementPdf());
    const copy = await writeSource(v.dir, "b.pdf", sampleStatementPdf());
    const first = await importDocument(deps, src);
    const second = await importDocument(deps, copy);
    expect(first.status).toBe("imported");
    expect(second).toMatchObject({
      status: "duplicate",
      existingDocumentId: first.status === "imported" ? first.documentId : -1,
    });
    expect(v.db.prepare("SELECT count(*) AS n FROM documents").get()).toEqual({ n: 1 });
    const files: string[] = [];
    for (const e of await fs.readdir(v.layout.documentsDir, { recursive: true, withFileTypes: true })) {
      if (e.isFile()) files.push(e.name);
    }
    expect(files).toHaveLength(1);
  });

  it("flags same text with different bytes as a possible duplicate but still imports", async () => {
    const a = await writeSource(v.dir, "a.pdf", sampleStatementPdf());
    const b = await writeSource(v.dir, "b.pdf", withComment(sampleStatementPdf()));
    const first = await importDocument(deps, a);
    const second = await importDocument(deps, b);
    expect(second.status).toBe("imported");
    if (first.status !== "imported" || second.status !== "imported") return;
    expect(second.possibleDuplicateOf).toEqual([first.documentId]);
    expect(second.sha256).not.toBe(first.sha256);
  });

  it("flags an identity_key collision as a possible revision and does not set supersedes", async () => {
    const a = await writeSource(v.dir, "a.pdf", sampleStatementPdf());
    const b = await writeSource(v.dir, "b.pdf", sampleStatementPdf({ endingBalance: "$90,000.00" }));
    const first = await importDocument(deps, a, { identityKey: "k" });
    const second = await importDocument(deps, b, { identityKey: "k" });
    if (first.status !== "imported" || second.status !== "imported") throw new Error("expected imports");
    expect(second.possibleRevisionOf).toEqual([first.documentId]);
    expect(second.possibleDuplicateOf).toEqual([]);
    expect(v.db.prepare("SELECT supersedes_document_id AS s FROM documents WHERE id = ?").get(second.documentId)).toEqual({
      s: null,
    });

    markSupersedes(v.db, second.documentId, first.documentId);
    expect(v.db.prepare("SELECT supersedes_document_id AS s FROM documents WHERE id = ?").get(second.documentId)).toEqual({
      s: first.documentId,
    });
    expect(() => markSupersedes(v.db, first.documentId, second.documentId)).toThrow(/supersedes/);
    expect(() => markSupersedes(v.db, 1, 1)).toThrow();
    expect(() => markSupersedes(v.db, 1, 99)).toThrow(/No such document/);
  });

  it("ignores removed documents for revision hints", async () => {
    const a = await writeSource(v.dir, "a.pdf", sampleStatementPdf());
    const b = await writeSource(v.dir, "b.pdf", sampleStatementPdf({ last4: "9999" }));
    await importDocument(deps, a, { identityKey: "k" });
    v.db.exec("UPDATE documents SET status = 'removed'");
    const second = await importDocument(deps, b, { identityKey: "k" });
    expect(second.status === "imported" && second.possibleRevisionOf).toEqual([]);
  });

  it("rejects non-PDF files and stores nothing", async () => {
    const txt = await writeSource(v.dir, "notes.pdf", "hello, I am not a pdf");
    await expect(importDocument(deps, txt)).rejects.toThrow(/not a PDF/);
    expect(v.db.prepare("SELECT count(*) AS n FROM documents").get()).toEqual({ n: 0 });
    await expect(fs.readdir(v.layout.documentsDir)).resolves.toEqual([]);
  });

  it("marks a page without text as textSource none", async () => {
    const blank = makePdf([{ texts: [{ text: "Hello", x: 72, y: 700 }] }, { texts: [] }]);
    const src = await writeSource(v.dir, "blank.pdf", blank);
    const r = await importDocument(deps, src);
    if (r.status !== "imported") throw new Error("expected import");
    const pages = v.db
      .prepare("SELECT page_no, text_source, text_sha256 FROM document_pages WHERE document_id = ? ORDER BY page_no")
      .all(r.documentId);
    expect(pages).toEqual([
      { page_no: 1, text_source: "native", text_sha256: expect.stringMatching(/^[0-9a-f]{64}$/) },
      { page_no: 2, text_source: "none", text_sha256: null },
    ]);
  });

  it("does not treat two fully blank documents as text duplicates", async () => {
    const a = await writeSource(v.dir, "a.pdf", makePdf([{ texts: [] }]));
    const b = await writeSource(v.dir, "b.pdf", makePdf([{ texts: [], width: 300, height: 400 }]));
    await importDocument(deps, a);
    const second = await importDocument(deps, b);
    expect(second.status === "imported" && second.possibleDuplicateOf).toEqual([]);
  });

  it("reuses an identical orphan file left by a crash", async () => {
    const src = await writeSource(v.dir, "a.pdf", sampleStatementPdf());
    const first = await importDocument(deps, src);
    if (first.status !== "imported") throw new Error("expected import");
    v.db.exec("PRAGMA foreign_keys=OFF");
    v.db.exec("DELETE FROM document_pages; DELETE FROM documents");
    const again = await importDocument(deps, src);
    expect(again.status).toBe("imported");
    expect((await checkDocuments(deps)).ok).toBe(true);
  });
});

describe("text layer cache", () => {
  it("extracts once, then serves from the cache file without calling the extractor", async () => {
    const src = await writeSource(v.dir, "a.pdf", sampleStatementPdf());
    const spy = vi.fn(extractWithPdfjs);
    const first = await getTextLayer(v.layout, "a".repeat(64), src, spy);
    const second = await getTextLayer(v.layout, "a".repeat(64), src, spy);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    expect(textCachePath(v.layout, "a".repeat(64))).toBe(
      path.join(v.layout.cacheDir, "text", `${"a".repeat(64)}.v${TEXT_LAYER_VERSION}.json`),
    );
    await expect(fs.stat(textCachePath(v.layout, "a".repeat(64)))).resolves.toBeTruthy();
  });

  it("regenerates when the cache file is corrupt", async () => {
    const src = await writeSource(v.dir, "a.pdf", sampleStatementPdf());
    const sha = "b".repeat(64);
    const spy = vi.fn(extractWithPdfjs);
    await getTextLayer(v.layout, sha, src, spy);
    await fs.writeFile(textCachePath(v.layout, sha), "{not json");
    await getTextLayer(v.layout, sha, src, spy);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("reuses the cache across imports (importDocument does not re-extract)", async () => {
    const src = await writeSource(v.dir, "a.pdf", sampleStatementPdf());
    const spy = vi.fn(extractWithPdfjs);
    await importDocument({ ...deps, extractText: spy }, src);
    v.db.exec("PRAGMA foreign_keys=OFF");
    v.db.exec("DELETE FROM document_pages; DELETE FROM documents");
    await importDocument({ ...deps, extractText: spy }, src);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("extracts geometry and positioned items", async () => {
    const src = await writeSource(v.dir, "a.pdf", sampleStatementPdf());
    const layer = await getTextLayer(v.layout, "c".repeat(64), src);
    const page = layer.pages[0]!;
    expect(page).toMatchObject({ widthPt: 612, heightPt: 792, rotation: 0, textSource: "native" });
    const bal = page.items.find((i) => i.str === "$83,421.17")!;
    expect(bal.x0).toBeCloseTo(400, 1);
    expect(bal.y0).toBeLessThan(600.5);
    expect(bal.y1).toBeGreaterThan(600);
    expect(bal.x1).toBeGreaterThan(bal.x0);
  });
});

describe("checkDocuments", () => {
  async function importOne() {
    const src = await writeSource(v.dir, "a.pdf", sampleStatementPdf());
    const r = await importDocument(deps, src);
    if (r.status !== "imported") throw new Error("expected import");
    return { r, abs: path.join(v.layout.root, r.storedPath) };
  }

  it("detects a missing file", async () => {
    const { r, abs } = await importOne();
    await fs.rm(abs);
    const report = await checkDocuments(deps);
    expect(report.ok).toBe(false);
    expect(report.missingFiles).toEqual([{ documentId: r.documentId, storedPath: r.storedPath }]);
  });

  it("detects a modified file", async () => {
    const { r, abs } = await importOne();
    await fs.chmod(abs, 0o644);
    await fs.appendFile(abs, "tampered");
    const report = await checkDocuments(deps);
    expect(report.ok).toBe(false);
    expect(report.hashMismatches).toEqual([
      expect.objectContaining({ documentId: r.documentId, expected: r.sha256 }),
    ]);
  });

  it("detects orphan files", async () => {
    await importOne();
    const orphan = path.join(v.layout.documentsDir, "2026", "zz", "stray.pdf");
    await fs.mkdir(path.dirname(orphan), { recursive: true });
    await fs.writeFile(orphan, "x");
    const report = await checkDocuments(deps);
    expect(report.ok).toBe(false);
    expect(report.orphanFiles).toEqual(["documents/2026/zz/stray.pdf"]);
  });

  it("detects a stored_path that breaks the convention", async () => {
    const { r, abs } = await importOne();
    const wrong = `documents/2026/xx/${r.sha256}.pdf`;
    await fs.mkdir(path.dirname(path.join(v.layout.root, wrong)), { recursive: true });
    await fs.rename(abs, path.join(v.layout.root, wrong));
    v.db.prepare("UPDATE documents SET stored_path = ? WHERE id = ?").run(wrong, r.documentId);
    const report = await checkDocuments(deps);
    expect(report.ok).toBe(false);
    expect(report.badStoredPaths).toEqual([
      { documentId: r.documentId, storedPath: wrong, expected: r.storedPath },
    ]);
  });

  it("is clean for an empty vault with no documents directory", async () => {
    await fs.rm(v.layout.documentsDir, { recursive: true });
    expect(await checkDocuments(deps)).toMatchObject({ ok: true, checked: 0 });
  });
});
