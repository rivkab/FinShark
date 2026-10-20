import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type {
  DocumentDetailDto,
  DocumentDto,
  DocumentPageDto,
  DocumentStatus,
  Language,
  TextLayerDto,
  UploadResponse,
} from "@finshark/shared";
import { importDocument, type ImportOptions } from "../../documents/import.ts";
import { getTextLayer, extractWithPdfjs } from "../../documents/text-layer.ts";
import { isIsoDate } from "../../facts/validate.ts";
import { resolveInVault } from "../../vault/layout.ts";
import {
  badRequest,
  HttpError,
  idParam,
  jsonBody,
  notFound,
  optEnum,
  reqInt,
  type ApiContext,
  type Json,
} from "./common.ts";

type Row = Record<string, unknown>;

function docDto(ctx: ApiContext, r: Row): DocumentDto {
  const id = Number(r["id"]);
  return {
    id,
    sha256: String(r["sha256"]),
    originalFilename: String(r["original_filename"]),
    byteSize: Number(r["byte_size"]),
    pageCount: r["page_count"] === null ? null : Number(r["page_count"]),
    importedAt: String(r["imported_at"]),
    docType: (r["doc_type"] as string | null) ?? null,
    institutionId: r["institution_id"] === null ? null : Number(r["institution_id"]),
    language: (r["language"] as Language | null) ?? null,
    issuedOn: (r["issued_on"] as string | null) ?? null,
    periodStart: (r["period_start"] as string | null) ?? null,
    periodEnd: (r["period_end"] as string | null) ?? null,
    taxYear: r["tax_year"] === null ? null : Number(r["tax_year"]),
    identityKey: (r["identity_key"] as string | null) ?? null,
    status: r["status"] as DocumentStatus,
    accountIds: (ctx.db.prepare("SELECT account_id FROM document_accounts WHERE document_id = ? ORDER BY account_id").all(id) as Row[]).map((x) =>
      Number(x["account_id"]),
    ),
    factCount: Number(
      (ctx.db.prepare("SELECT COUNT(DISTINCT fact_id) AS n FROM fact_sources WHERE document_id = ?").get(id) as Row)["n"],
    ),
  };
}

function pagesOf(ctx: ApiContext, id: number): DocumentPageDto[] {
  return (ctx.db.prepare("SELECT * FROM document_pages WHERE document_id = ? ORDER BY page_no").all(id) as Row[]).map((p) => ({
    pageNo: Number(p["page_no"]),
    widthPt: Number(p["width_pt"]),
    heightPt: Number(p["height_pt"]),
    rotation: Number(p["rotation"]) as DocumentPageDto["rotation"],
    textSource: p["text_source"] as DocumentPageDto["textSource"],
  }));
}

function getDocRow(ctx: ApiContext, id: number): Row {
  const r = ctx.db.prepare("SELECT * FROM documents WHERE id = ?").get(id) as Row | undefined;
  if (!r) throw notFound("Document");
  return r;
}

function detail(ctx: ApiContext, id: number): DocumentDetailDto {
  return { ...docDto(ctx, getDocRow(ctx, id)), pages: pagesOf(ctx, id) };
}

function dateField(v: unknown, k: string): string | null {
  if (v === null) return null;
  if (typeof v !== "string" || !isIsoDate(v)) throw badRequest(`${k} must be a date (YYYY-MM-DD) or null.`);
  return v;
}

function checkInstitution(ctx: ApiContext, id: number): number {
  if (!ctx.db.prepare("SELECT 1 FROM institutions WHERE id = ?").get(id)) throw badRequest(`No such institution: ${id}`);
  return id;
}
function checkDocType(ctx: ApiContext, id: string): string {
  if (!ctx.db.prepare("SELECT 1 FROM terms WHERE id = ? AND taxonomy_id = 'doc_type'").get(id)) {
    throw badRequest(`Not a document type: ${id}`);
  }
  return id;
}

function safeFilename(raw: string | undefined): string {
  let name = "document.pdf";
  if (raw !== undefined && raw !== "") {
    let decoded: string;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      throw badRequest("X-Filename is not valid URI-encoded text.");
    }
    const base = path.basename(decoded.replace(/\\/g, "/")).replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 200);
    if (base !== "" && base !== "." && base !== "..") name = base;
  }
  return name;
}

function importOptionsFromQuery(ctx: ApiContext, q: Json): ImportOptions {
  const out: ImportOptions = {};
  const str = (k: string): string | undefined => {
    const v = q[k];
    if (v === undefined) return undefined;
    if (typeof v !== "string") throw badRequest(`${k} must be given once.`);
    return v;
  };
  const inst = str("institutionId");
  if (inst !== undefined) out.institutionId = checkInstitution(ctx, Number(inst));
  const lang = optEnum<Language>(q, "language", ["en", "he"]);
  if (lang !== undefined) out.language = lang;
  const docType = str("docType");
  if (docType !== undefined) out.docType = checkDocType(ctx, docType);
  const identityKey = str("identityKey");
  if (identityKey !== undefined) out.identityKey = identityKey;
  for (const k of ["issuedOn", "periodStart", "periodEnd"] as const) {
    const v = str(k);
    if (v !== undefined) out[k] = dateField(v, k)!;
  }
  const ty = str("taxYear");
  if (ty !== undefined) {
    if (!/^\d{4}$/.test(ty)) throw badRequest("taxYear must be a 4-digit year.");
    out.taxYear = Number(ty);
  }
  return out;
}

export function registerDocumentRoutes(app: FastifyInstance, ctx: ApiContext): void {
  // Raw PDF bodies (no multipart plugin). The filename travels URI-encoded in X-Filename.
  app.addContentTypeParser("application/pdf", { parseAs: "buffer", bodyLimit: ctx.maxUploadBytes }, (_req, body, done) => {
    done(null, body);
  });

  app.post("/api/documents", { bodyLimit: ctx.maxUploadBytes }, async (req, reply) => {
    if (!Buffer.isBuffer(req.body)) {
      throw new HttpError(415, "unsupported_media_type", "Send the PDF as the raw request body with Content-Type: application/pdf.");
    }
    const header = req.headers["x-filename"];
    const filename = safeFilename(Array.isArray(header) ? header[0] : header);
    const opts = importOptionsFromQuery(ctx, req.query as Json);

    const dir = path.join(ctx.layout.inboxDir, `.upload-${ctx.newId()}`);
    await fsp.mkdir(dir, { recursive: true });
    let r;
    try {
      const src = path.join(dir, filename);
      await fsp.writeFile(src, req.body);
      r = await importDocument({ db: ctx.db, layout: ctx.layout, now: ctx.now, ...(ctx.extractText ? { extractText: ctx.extractText } : {}) }, src, opts);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
    if (r.status === "duplicate") {
      return reply.code(200).send({ status: "duplicate", existingDocumentId: r.existingDocumentId, sha256: r.sha256 } satisfies UploadResponse);
    }
    return reply.code(201).send({
      status: "imported",
      documentId: r.documentId,
      sha256: r.sha256,
      pageCount: r.pageCount,
      possibleDuplicateOf: r.possibleDuplicateOf,
      possibleRevisionOf: r.possibleRevisionOf,
    } satisfies UploadResponse);
  });

  app.get("/api/documents", async () => ({
    documents: (ctx.db.prepare("SELECT * FROM documents WHERE status <> 'removed' ORDER BY id DESC").all() as Row[]).map((r) => docDto(ctx, r)),
  }));

  app.get("/api/documents/:id", async (req) => detail(ctx, idParam(req)));

  app.get("/api/documents/:id/file", async (req, reply) => {
    const row = getDocRow(ctx, idParam(req));
    const file = resolveInVault(ctx.layout, String(row["stored_path"]));
    let size: number;
    try {
      size = (await fsp.stat(file)).size;
    } catch {
      throw new HttpError(404, "file_missing", "The stored file for this document is missing.");
    }
    return reply
      .type("application/pdf")
      .header("Content-Length", size)
      .header("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(String(row["original_filename"]))}`)
      .header("Cache-Control", "private, max-age=3600")
      .send(fs.createReadStream(file));
  });

  app.get("/api/documents/:id/text-layer", async (req): Promise<TextLayerDto> => {
    const row = getDocRow(ctx, idParam(req));
    const sha256 = String(row["sha256"]);
    const layer = await getTextLayer(ctx.layout, sha256, resolveInVault(ctx.layout, String(row["stored_path"])), ctx.extractText ?? extractWithPdfjs);
    return {
      sha256,
      pages: layer.pages.map((p) => ({
        pageNo: p.pageNo,
        widthPt: p.widthPt,
        heightPt: p.heightPt,
        rotation: p.rotation,
        textSource: p.textSource,
        items: p.items,
      })),
    };
  });

  app.patch("/api/documents/:id", async (req) => {
    const id = idParam(req);
    getDocRow(ctx, id);
    const o = jsonBody(req);
    const sets: string[] = [];
    const vals: (string | number | null)[] = [];
    const set = (col: string, v: string | number | null) => {
      sets.push(`${col} = ?`);
      vals.push(v);
    };
    if ("institutionId" in o) set("institution_id", o["institutionId"] === null ? null : checkInstitution(ctx, reqInt(o, "institutionId")));
    if ("docType" in o) {
      const v = o["docType"];
      if (v !== null && typeof v !== "string") throw badRequest("docType must be a string or null.");
      set("doc_type", v === null ? null : checkDocType(ctx, v));
    }
    if ("language" in o) set("language", o["language"] === null ? null : optEnum<Language>(o, "language", ["en", "he"])!);
    for (const [key, col] of [["issuedOn", "issued_on"], ["periodStart", "period_start"], ["periodEnd", "period_end"]] as const) {
      if (key in o) set(col, dateField(o[key], key));
    }
    if ("taxYear" in o) {
      const v = o["taxYear"];
      if (v !== null && (typeof v !== "number" || !Number.isInteger(v) || v < 1900 || v > 2200)) throw badRequest("taxYear must be a year or null.");
      set("tax_year", v as number | null);
    }
    if ("identityKey" in o) {
      const v = o["identityKey"];
      if (v !== null && typeof v !== "string") throw badRequest("identityKey must be a string or null.");
      set("identity_key", v as string | null);
    }
    if ("status" in o) {
      const s = optEnum(o, "status", ["inbox", "reviewed"] as const);
      if (s === undefined) throw badRequest("status must be inbox or reviewed.");
      set("status", s);
    }
    if (sets.length === 0) throw badRequest("Nothing to update.");
    ctx.db.prepare(`UPDATE documents SET ${sets.join(", ")} WHERE id = ?`).run(...vals, id);
    return detail(ctx, id);
  });

  app.post("/api/documents/:id/accounts", async (req) => {
    const id = idParam(req);
    getDocRow(ctx, id);
    const accountId = reqInt(jsonBody(req), "accountId");
    if (!ctx.db.prepare("SELECT 1 FROM accounts WHERE id = ?").get(accountId)) throw badRequest(`No such account: ${accountId}`);
    ctx.db.prepare("INSERT OR IGNORE INTO document_accounts (document_id, account_id) VALUES (?, ?)").run(id, accountId);
    // A document with no institution takes its account's.
    ctx.db
      .prepare("UPDATE documents SET institution_id = (SELECT institution_id FROM accounts WHERE id = ?) WHERE id = ? AND institution_id IS NULL")
      .run(accountId, id);
    return detail(ctx, id);
  });
}
