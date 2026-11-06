// API routes. Endpoint list and payload types: shared/src/api.ts.
import type { FastifyInstance } from "fastify";
import { MUTATING_METHODS, requestPath } from "../security.ts";
import { apiErrorHandler, actorId, type ApiContext } from "./common.ts";
import { registerBackupRoutes } from "./backups.ts";
import { registerDocumentRoutes } from "./documents.ts";
import { registerFbarRoutes } from "./fbar.ts";
import { registerFactRoutes } from "./facts.ts";
import { registerRateRoutes } from "./rates.ts";
import { registerReferenceRoutes } from "./reference.ts";

export { DEFAULT_MAX_UPLOAD_BYTES, type ApiContext } from "./common.ts";

/** Paths that may mutate before anyone has chosen "who is using FinShark" (bootstrap). */
const NO_PERSON_NEEDED = new Set(["/api/people", "/api/session/person"]);

/** Roles and rename are also used on the "Who's using FinShark?" screen, before anyone is chosen. */
const PERSON_EDIT_PATH = /^\/api\/people\/\d{1,15}\/(roles|name)$/;

export function registerApiRoutes(app: FastifyInstance, ctx: ApiContext): void {
  app.setErrorHandler(apiErrorHandler);
  // Every mutation is attributed to a person (DESIGN D1): 409 choose_person otherwise.
  app.addHook("preHandler", async (req) => {
    if (MUTATING_METHODS.has(req.method) && !NO_PERSON_NEEDED.has(requestPath(req)) && !PERSON_EDIT_PATH.test(requestPath(req))) actorId(req);
  });
  // A successful change to the vault starts the "10 minutes after the last change" backup (D20).
  // Backups and the session are not changes to the vault's contents.
  app.addHook("onResponse", async (req, reply) => {
    const p = requestPath(req);
    if (MUTATING_METHODS.has(req.method) && reply.statusCode < 400 && !p.startsWith("/api/backups") && !p.startsWith("/api/session")) {
      ctx.backups?.markChanged();
    }
  });
  registerReferenceRoutes(app, ctx);
  registerDocumentRoutes(app, ctx);
  registerFactRoutes(app, ctx);
  registerRateRoutes(app, ctx);
  registerFbarRoutes(app, ctx);
  registerBackupRoutes(app, ctx);
}
