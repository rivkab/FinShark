import type { FastifyInstance } from "fastify";
import type { FactDetailDto, FactStatus, PdfRect } from "@finshark/shared";
import {
  correctFact,
  createAttestation,
  getFactWithHistory,
  listFacts,
  listReviewQueue,
  proposeManualFact,
  rejectFact,
  reopenFact,
  verifyFact,
  type FactChanges,
  type FactConflict,
} from "../../facts/index.ts";
import {
  actorId,
  badRequest,
  HttpError,
  idParam,
  jsonBody,
  nullableInt,
  nullableStr,
  optInt,
  optStr,
  reqInt,
  reqStr,
  type ApiContext,
  type Json,
} from "./common.ts";
import { eventToDto, factToDto } from "./dto.ts";

function dimensionsOf(o: Json): Record<string, unknown> | null | undefined {
  const d = o["dimensions"];
  if (d === undefined || d === null) return d as null | undefined;
  if (typeof d !== "object" || Array.isArray(d)) throw badRequest("dimensions must be an object.");
  return d as Record<string, unknown>;
}

/** Fields shared by proposals, attestations and corrections. Absent stays absent. */
function commonFields(o: Json) {
  const out: {
    currency?: string | null;
    instantDate?: string | null;
    periodStart?: string | null;
    periodEnd?: string | null;
    taxYear?: number | null;
    dimensions?: Record<string, unknown> | null;
    accountId?: number | null;
    personId?: number | null;
    note?: string | null;
  } = {};
  const put = <K extends keyof typeof out>(k: K, v: (typeof out)[K] | undefined) => {
    if (v !== undefined) out[k] = v;
  };
  put("currency", nullableStr(o, "currency"));
  put("instantDate", nullableStr(o, "instantDate"));
  put("periodStart", nullableStr(o, "periodStart"));
  put("periodEnd", nullableStr(o, "periodEnd"));
  put("taxYear", nullableInt(o, "taxYear"));
  put("dimensions", dimensionsOf(o));
  put("accountId", nullableInt(o, "accountId"));
  put("personId", nullableInt(o, "personId"));
  put("note", nullableStr(o, "note"));
  return out;
}

function conflictError(c: FactConflict): HttpError {
  return new HttpError(
    409,
    "conflict",
    `Another verified fact has a different value for the same concept, account, person and period. Resolve it before verifying fact ${c.factId}.`,
    { conflicts: c.conflictingWith.map(factToDto) },
  );
}

const STATUSES = ["proposed", "verified", "rejected", "superseded"] as const;

export function registerFactRoutes(app: FastifyInstance, ctx: ApiContext): void {
  const deps = { db: ctx.db, now: ctx.now };
  const proposeDeps = { ...deps, layout: ctx.layout, ...(ctx.extractText ? { extractText: ctx.extractText } : {}) };

  app.post("/api/facts", async (req, reply) => {
    const actor = actorId(req);
    const o = jsonBody(req);
    const bbox = o["bbox"];
    if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every((n) => typeof n === "number")) {
      throw badRequest("bbox must be an array of four numbers [x0, y0, x1, y1].");
    }
    const view = await proposeManualFact(proposeDeps, actor, {
      documentId: reqInt(o, "documentId"),
      pageNo: reqInt(o, "pageNo"),
      bbox: bbox as PdfRect,
      conceptId: reqStr(o, "conceptId"),
      value: reqStr(o, "value"),
      ...commonFields(o),
    });
    return reply.code(201).send({ fact: factToDto(view), valueMatchesSource: view.valueMatchesSource });
  });

  app.post("/api/attestations", async (req, reply) => {
    const actor = actorId(req);
    const o = jsonBody(req);
    const { note: _note, ...rest } = commonFields(o);
    const view = createAttestation(deps, actor, {
      conceptId: reqStr(o, "conceptId"),
      value: reqStr(o, "value"),
      note: optStr(o, "note") ?? "",
      ...rest,
    });
    return reply.code(201).send({ fact: factToDto(view) });
  });

  app.get("/api/review-queue", async () => ({ items: listReviewQueue(ctx.db).map(factToDto) }));

  app.get("/api/facts", async (req) => {
    const q = req.query as Record<string, unknown>;
    const one = (k: string): string | undefined => {
      const v = q[k];
      if (v === undefined) return undefined;
      if (typeof v !== "string") throw badRequest(`${k} must be given once.`);
      return v;
    };
    const intQ = (k: string): number | undefined => {
      const v = one(k);
      if (v === undefined) return undefined;
      if (!/^\d{1,15}$/.test(v)) throw badRequest(`${k} must be an id.`);
      return Number(v);
    };
    const status = one("status");
    if (status !== undefined && !(STATUSES as readonly string[]).includes(status)) {
      throw badRequest(`status must be one of: ${STATUSES.join(", ")}.`);
    }
    const concept = one("concept");
    const account = intQ("account");
    const document = intQ("document");
    const facts = listFacts(ctx.db, {
      ...(status !== undefined ? { status: status as FactStatus } : {}),
      ...(concept !== undefined ? { conceptId: concept } : {}),
      ...(account !== undefined ? { accountId: account } : {}),
      ...(document !== undefined ? { documentId: document } : {}),
    });
    return { facts: facts.map(factToDto) };
  });

  app.get("/api/facts/:id", async (req): Promise<FactDetailDto> => {
    const h = getFactWithHistory(ctx.db, idParam(req));
    return {
      fact: factToDto(h.view),
      events: h.events.map(eventToDto),
      supersedes: h.supersedes.map(factToDto),
      supersededBy: h.supersededBy.map(factToDto),
    };
  });

  app.post("/api/facts/:id/verify", async (req) => {
    const r = verifyFact(deps, actorId(req), idParam(req));
    if (!r.ok) throw conflictError(r.conflict);
    return { fact: factToDto(r.view), corroboratedBy: r.corroboratedBy };
  });

  app.post("/api/facts/:id/correct", async (req, reply) => {
    const actor = actorId(req);
    const o = jsonBody(req);
    const changes: FactChanges = { ...commonFields(o) };
    const conceptId = optStr(o, "conceptId");
    if (conceptId !== undefined) changes.conceptId = conceptId;
    const value = optStr(o, "value");
    if (value !== undefined) changes.value = value;
    if (o["verify"] !== undefined) {
      if (typeof o["verify"] !== "boolean") throw badRequest("verify must be true or false.");
      changes.verify = o["verify"];
    }
    const r = correctFact(deps, actor, idParam(req), changes);
    if (!r.ok) throw conflictError(r.conflict);
    return reply.code(201).send({ fact: factToDto(r.view), superseded: factToDto(r.superseded), corroboratedBy: r.corroboratedBy });
  });

  app.post("/api/facts/:id/reject", async (req) => {
    const view = rejectFact(deps, actorId(req), idParam(req), optStr(jsonBody(req), "reason") ?? "");
    return { fact: factToDto(view) };
  });

  app.post("/api/facts/:id/reopen", async (req) => ({ fact: factToDto(reopenFact(deps, actorId(req), idParam(req))) }));
}
