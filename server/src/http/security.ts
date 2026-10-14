// Localhost security hooks (DESIGN §9). Each rule is a separate, individually
// testable Fastify hook factory. No CORS headers are ever sent.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest, onRequestHookHandler, onSendHookHandler } from "fastify";

export const SESSION_COOKIE = "fs_session";
export const CSRF_HEADER = "x-finshark-csrf";
export const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export const CONTENT_SECURITY_POLICY =
  "default-src 'self'; connect-src 'self'; img-src 'self' blob: data:; worker-src 'self' blob:; " +
  "style-src 'self' 'unsafe-inline'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Content-Security-Policy": CONTENT_SECURITY_POLICY,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
};

/** Paths reachable without a session cookie. */
export const PUBLIC_PATHS = new Set(["/auth", "/launch-required"]);

export interface Session {
  id: string;
  csrfToken: string;
  personId: string | null;
  createdAt: number;
}

export class SessionStore {
  private readonly sessions = new Map<string, Session>();
  private readonly newId: () => string;
  private readonly now: () => number;
  constructor(newId: () => string, now: () => number) {
    this.newId = newId;
    this.now = now;
  }
  create(): Session {
    const session: Session = { id: this.newId(), csrfToken: this.newId(), personId: null, createdAt: this.now() };
    this.sessions.set(session.id, session);
    return session;
  }
  get(id: string | undefined): Session | undefined {
    return id === undefined ? undefined : this.sessions.get(id);
  }
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Constant-time string equality (hashes first so lengths never leak). */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const name = part.slice(0, i).trim();
    if (name && !(name in out)) out[name] = part.slice(i + 1).trim();
  }
  return out;
}

export function allowedHosts(port: number): string[] {
  return [`127.0.0.1:${port}`, `localhost:${port}`];
}

function deny(reply: FastifyReply, status: number, error: string) {
  return reply.code(status).send({ error });
}

/** Security headers on every response, including errors and 404s. */
export function securityHeadersHook(): onSendHookHandler {
  return async (_req, reply, payload) => {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) reply.header(k, v);
    return payload;
  };
}

/** DNS-rebinding defense: Host must be exactly 127.0.0.1:<port> or localhost:<port>. */
export function hostCheckHook(port: number): onRequestHookHandler {
  const allowed = new Set(allowedHosts(port));
  return async (req, reply) => {
    const host = req.headers.host;
    if (typeof host !== "string" || !allowed.has(host)) return deny(reply, 421, "bad_host");
  };
}

/** Never answer CORS: every OPTIONS request (cross-origin preflight or not) is refused. */
export function noCorsHook(): onRequestHookHandler {
  return async (req, reply) => {
    if (req.method === "OPTIONS") return deny(reply, 403, "cors_not_allowed");
  };
}

export function requestPath(req: FastifyRequest): string {
  const url = req.raw.url ?? "/";
  const q = url.indexOf("?");
  return q < 0 ? url : url.slice(0, q);
}

declare module "fastify" {
  interface FastifyRequest {
    session?: Session;
  }
}

/** Require a valid session cookie for everything except PUBLIC_PATHS. */
export function authHook(store: SessionStore): onRequestHookHandler {
  return async (req, reply) => {
    const session = store.get(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
    if (session) {
      req.session = session;
      return;
    }
    if (PUBLIC_PATHS.has(requestPath(req))) return;
    if (req.method === "GET" && (req.headers.accept ?? "").includes("text/html")) {
      return reply.code(401).type("text/html; charset=utf-8").send(LAUNCH_REQUIRED_HTML);
    }
    return deny(reply, 401, "unauthenticated");
  };
}

/** On any request carrying an Origin: it must be exactly this server's own origin. */
export function originCheckHook(): onRequestHookHandler {
  return async (req, reply) => {
    const origin = req.headers.origin;
    if (origin === undefined) return;
    // Host was already validated by hostCheckHook, so same-origin == http://<Host>.
    if (origin !== `http://${req.headers.host}`) return deny(reply, 403, "foreign_origin");
  };
}

/** Mutations need the per-session CSRF token from GET /api/session. */
export function csrfHook(): onRequestHookHandler {
  return async (req, reply) => {
    if (!MUTATING_METHODS.has(req.method)) return;
    const session = req.session;
    const sent = req.headers[CSRF_HEADER];
    if (!session || typeof sent !== "string" || !safeEqual(sent, session.csrfToken)) {
      return deny(reply, 403, "bad_csrf");
    }
  };
}

export const LAUNCH_REQUIRED_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>FinShark</title>
<meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family: system-ui, sans-serif; max-width: 32rem; margin: 4rem auto; padding: 0 1rem">
<h1>Please open the link from the launcher</h1>
<p>FinShark needs the personal link printed in the terminal (or opened automatically) when you start it.
Start FinShark again and use that link.</p>
</body></html>
`;
