// Same-origin API client. Mutations attach the per-session CSRF token (DESIGN §9).
import type { ApiErrorBody, ConflictDetails, FactDto, ImportRatesResponse, UploadResponse } from "@finshark/shared";

export interface SessionInfo {
  csrfToken: string;
  personId: string | null;
}

let csrfToken: string | null = null;

export class ApiError extends Error {
  readonly status: number;
  /** The server's error code ("choose_person", "conflict", ...), when the body had one. */
  readonly code: string | null;
  readonly details: unknown;
  constructor(status: number, message: string, code: string | null = null, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
  /** Verified facts that block verification (409 conflict), else null. */
  get conflicts(): FactDto[] | null {
    if (this.code !== "conflict") return null;
    const d = this.details as Partial<ConflictDetails> | undefined;
    return Array.isArray(d?.conflicts) ? d.conflicts : null;
  }
}

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function fetchSession(): Promise<SessionInfo> {
  const res = await fetch("/api/session", { credentials: "same-origin" });
  if (!res.ok) throw new ApiError(res.status, "session unavailable");
  const info = (await res.json()) as SessionInfo;
  csrfToken = info.csrfToken;
  return info;
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

async function toError(res: Response, method: string, path: string): Promise<ApiError> {
  let body: Partial<ApiErrorBody> | null = null;
  try {
    body = (await res.json()) as Partial<ApiErrorBody>;
  } catch {
    // not JSON
  }
  const message = body?.message ?? `${method} ${path} failed (${res.status})`;
  return new ApiError(res.status, message, typeof body?.error === "string" ? body.error : null, body?.details);
}

/** fetch() for our own API: JSON in/out, CSRF header on mutations. */
export async function apiFetch<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers: Record<string, string> = { Accept: "application/json" };
  if (MUTATING.has(method)) {
    if (!csrfToken) await fetchSession();
    headers["X-FinShark-CSRF"] = csrfToken!;
  }
  const hasBody = init.body !== undefined;
  if (hasBody) headers["Content-Type"] = "application/json";
  const res = await fetch(path, {
    method,
    headers,
    credentials: "same-origin",
    ...(hasBody ? { body: JSON.stringify(init.body) } : {}),
  });
  if (!res.ok) throw await toError(res, method, path);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/** Upload one PDF as the raw request body. */
export async function uploadPdf(file: File): Promise<UploadResponse> {
  if (!csrfToken) await fetchSession();
  const path = "/api/documents";
  const res = await fetch(path, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/pdf",
      "X-Filename": encodeURIComponent(file.name),
      "X-FinShark-CSRF": csrfToken!,
    },
    credentials: "same-origin",
    body: file,
  });
  if (!res.ok) throw await toError(res, "POST", path);
  return (await res.json()) as UploadResponse;
}

/** Import a US Treasury Reporting Rates of Exchange CSV as the raw request body. */
export async function uploadRatesCsv(file: File, note: string): Promise<ImportRatesResponse> {
  if (!csrfToken) await fetchSession();
  const path = `/api/exchange-rates/import${note.trim() ? `?note=${encodeURIComponent(note.trim())}` : ""}`;
  const res = await fetch(path, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "text/csv", "X-FinShark-CSRF": csrfToken! },
    credentials: "same-origin",
    body: await file.text(),
  });
  if (!res.ok) throw await toError(res, "POST", path);
  return (await res.json()) as ImportRatesResponse;
}

export function setActingPerson(personId: string): Promise<{ personId: string }> {
  return apiFetch("/api/session/person", { method: "POST", body: { personId } });
}
