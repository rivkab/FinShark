import Fastify, { type FastifyInstance } from "fastify";
import {
  authHook,
  csrfHook,
  hostCheckHook,
  LAUNCH_REQUIRED_HTML,
  noCorsHook,
  originCheckHook,
  randomToken,
  safeEqual,
  securityHeadersHook,
  SESSION_COOKIE,
  SessionStore,
} from "./security.ts";
import { readStaticFile } from "./static.ts";

/** Everything the HTTP layer needs from the outside. Later wiring adds vault/db handles here. */
export interface AppDeps {
  /** The port the server will listen on (used for the Host check). */
  port: number;
  /** Per-launch secret from the launcher link. */
  token: string;
  /** Clock, injected for determinism. */
  now: () => number;
  /** Random id source (session ids, CSRF tokens); default: crypto.randomBytes. */
  randomId?: () => string;
  /** Directory with the built web app (web/dist); omit to serve no UI (dev uses Vite). */
  staticDir?: string;
  /** Optional check that a person id exists (wired to the people table later). */
  isValidPerson?: (id: string) => boolean;
  /** Add API routes. They sit behind all security hooks. */
  registerRoutes?: (app: FastifyInstance) => void | Promise<void>;
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  const sessions = new SessionStore(deps.randomId ?? randomToken, deps.now);

  app.addHook("onSend", securityHeadersHook());
  // Order matters: host -> CORS -> origin -> auth -> CSRF.
  app.addHook("onRequest", hostCheckHook(deps.port));
  app.addHook("onRequest", noCorsHook());
  app.addHook("onRequest", originCheckHook());
  app.addHook("onRequest", authHook(sessions));
  app.addHook("onRequest", csrfHook());

  app.get("/auth", async (req, reply) => {
    const { token } = req.query as { token?: unknown };
    if (typeof token !== "string" || !safeEqual(token, deps.token)) {
      return reply.code(401).type("text/html; charset=utf-8").send(LAUNCH_REQUIRED_HTML);
    }
    const session = sessions.create();
    return reply
      .header("Set-Cookie", `${SESSION_COOKIE}=${session.id}; Path=/; HttpOnly; SameSite=Strict`)
      .header("Cache-Control", "no-store")
      .redirect("/", 302);
  });

  app.get("/launch-required", async (_req, reply) => reply.type("text/html; charset=utf-8").send(LAUNCH_REQUIRED_HTML));

  app.get("/api/health", async () => ({ ok: true }));

  app.get("/api/session", async (req, reply) => {
    const s = req.session!;
    return reply.header("Cache-Control", "no-store").send({ csrfToken: s.csrfToken, personId: s.personId });
  });

  app.post("/api/session/person", async (req, reply) => {
    const body = req.body as { personId?: unknown } | null;
    const id = body?.personId;
    if (typeof id !== "string" || id.length === 0 || id.length > 64) return reply.code(400).send({ error: "bad_person" });
    if (deps.isValidPerson && !deps.isValidPerson(id)) return reply.code(400).send({ error: "unknown_person" });
    req.session!.personId = id;
    return { personId: id };
  });

  if (deps.registerRoutes) app.register(async (scope) => void (await deps.registerRoutes!(scope)));

  app.setNotFoundHandler(async (req, reply) => {
    const url = req.raw.url ?? "/";
    const pathOnly = url.split("?")[0] ?? "/";
    if (deps.staticDir && (req.method === "GET" || req.method === "HEAD") && !pathOnly.startsWith("/api/")) {
      const file = await readStaticFile(deps.staticDir, pathOnly);
      if (file) return reply.type(file.contentType).send(file.body);
    }
    return reply.code(404).send({ error: "not_found" });
  });

  return app;
}
