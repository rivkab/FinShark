// Same-origin API client. Mutations attach the per-session CSRF token (DESIGN §9).

export interface SessionInfo {
  csrfToken: string;
  personId: string | null;
}

let csrfToken: string | null = null;

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function fetchSession(): Promise<SessionInfo> {
  const res = await fetch("/api/session", { credentials: "same-origin" });
  if (!res.ok) throw new ApiError(res.status, "session unavailable");
  const info = (await res.json()) as SessionInfo;
  csrfToken = info.csrfToken;
  return info;
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

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
  if (!res.ok) throw new ApiError(res.status, `${method} ${path} failed (${res.status})`);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export function setActingPerson(personId: string): Promise<{ personId: string }> {
  return apiFetch("/api/session/person", { method: "POST", body: { personId } });
}
