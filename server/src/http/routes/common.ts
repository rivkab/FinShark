import type { FastifyReply, FastifyRequest } from "fastify";
import type { DatabaseSync } from "node:sqlite";
import type { ApiErrorBody } from "@finshark/shared";
import { FactError } from "../../facts/index.ts";
import { ImportError } from "../../documents/import.ts";
import type { ExtractFn } from "../../documents/text-layer.ts";
import type { VaultLayout } from "../../vault/layout.ts";

/** What every route module needs. Clock and ids are injected. */
export interface ApiContext {
  db: DatabaseSync;
  layout: VaultLayout;
  now: () => Date;
  /** Unique id for temp names (crypto.randomUUID in production). */
  newId: () => string;
  maxUploadBytes: number;
  /** Override the PDF text extractor (tests). */
  extractText?: ExtractFn | undefined;
}

export const DEFAULT_MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, "bad_request", message, details);
export const notFound = (what: string) => new HttpError(404, "not_found", `${what} not found`);

function body(status: number, error: string, message: string, details?: unknown): [number, ApiErrorBody] {
  return [status, { error, message, ...(details !== undefined ? { details } : {}) }];
}

/** Structured `{ error, message, details? }` for everything thrown inside the API scope. */
export function apiErrorHandler(err: unknown, _req: FastifyRequest, reply: FastifyReply) {
  let status: number;
  let payload: ApiErrorBody;
  if (err instanceof HttpError) {
    [status, payload] = body(err.status, err.code, err.message, err.details);
  } else if (err instanceof FactError) {
    if (err.code === "actor_required") [status, payload] = body(409, "choose_person", err.message);
    else if (err.code === "not_found") [status, payload] = body(404, "not_found", err.message, err.details);
    else if (err.code === "bad_state") [status, payload] = body(409, "bad_state", err.message, err.details);
    else [status, payload] = body(400, err.code, err.message, err.details);
  } else if (err instanceof ImportError) {
    [status, payload] = body(400, "not_a_pdf", err.message);
  } else if (typeof err === "object" && err !== null && "statusCode" in err && typeof (err as { statusCode: unknown }).statusCode === "number") {
    const e = err as { statusCode: number; code?: string; message: string };
    status = e.statusCode;
    const code = e.code === "FST_ERR_CTP_BODY_TOO_LARGE" ? "payload_too_large" : status === 415 ? "unsupported_media_type" : "bad_request";
    [status, payload] = body(status, code, e.message);
  } else {
    [status, payload] = body(500, "internal", "Unexpected error.");
    console.error(err);
  }
  return reply.code(status).send(payload);
}

// ---------------------------------------------------------------- request validation helpers

export type Json = Record<string, unknown>;

export function jsonBody(req: FastifyRequest): Json {
  const b = req.body;
  if (typeof b !== "object" || b === null || Array.isArray(b)) throw badRequest("A JSON object body is required.");
  return b as Json;
}

export function optionalJsonBody(req: FastifyRequest): Json {
  return req.body === undefined || req.body === null ? {} : jsonBody(req);
}

export function reqStr(o: Json, k: string): string {
  const v = o[k];
  if (typeof v !== "string" || v.trim() === "") throw badRequest(`${k} is required (a non-empty string).`);
  return v;
}

export function optStr(o: Json, k: string): string | undefined {
  const v = o[k];
  if (v === undefined) return undefined;
  if (typeof v !== "string") throw badRequest(`${k} must be a string.`);
  return v;
}

export function reqInt(o: Json, k: string): number {
  const v = o[k];
  if (typeof v !== "number" || !Number.isInteger(v)) throw badRequest(`${k} is required (an integer).`);
  return v;
}

export function optInt(o: Json, k: string): number | undefined {
  const v = o[k];
  if (v === undefined) return undefined;
  if (typeof v !== "number" || !Number.isInteger(v)) throw badRequest(`${k} must be an integer.`);
  return v;
}

/** undefined = absent, null = explicit null. */
export function nullableInt(o: Json, k: string): number | null | undefined {
  return o[k] === null ? null : optInt(o, k);
}
export function nullableStr(o: Json, k: string): string | null | undefined {
  return o[k] === null ? null : optStr(o, k);
}

export function optEnum<T extends string>(o: Json, k: string, allowed: readonly T[]): T | undefined {
  const v = o[k];
  if (v === undefined) return undefined;
  if (typeof v !== "string" || !allowed.includes(v as T)) throw badRequest(`${k} must be one of: ${allowed.join(", ")}.`);
  return v as T;
}

export function idParam(req: FastifyRequest, name = "id"): number {
  const raw = (req.params as Record<string, string>)[name] ?? "";
  if (!/^\d{1,15}$/.test(raw)) throw notFound("Resource");
  return Number(raw);
}

/** The person using FinShark (session), or 409 choose_person. */
export function actorId(req: FastifyRequest): number {
  const p = req.session?.personId;
  const n = p === null || p === undefined ? NaN : Number(p);
  if (!Number.isInteger(n)) throw new HttpError(409, "choose_person", "Choose who is using FinShark first.");
  return n;
}
