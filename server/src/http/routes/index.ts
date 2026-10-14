// API routes. Endpoint list and payload types: shared/src/api.ts.
import type { FastifyInstance } from "fastify";
import { MUTATING_METHODS, requestPath } from "../security.ts";
import { apiErrorHandler, actorId, type ApiContext } from "./common.ts";
import { registerDocumentRoutes } from "./documents.ts";
import { registerFactRoutes } from "./facts.ts";
import { registerReferenceRoutes } from "./reference.ts";

export { DEFAULT_MAX_UPLOAD_BYTES, type ApiContext } from "./common.ts";

/** Paths that may mutate before anyone has chosen "who is using FinShark" (bootstrap). */
const NO_PERSON_NEEDED = new Set(["/api/people", "/api/session/person"]);

export function registerApiRoutes(app: FastifyInstance, ctx: ApiContext): void {
  app.setErrorHandler(apiErrorHandler);
  // Every mutation is attributed to a person (DESIGN D1): 409 choose_person otherwise.
  app.addHook("preHandler", async (req) => {
    if (MUTATING_METHODS.has(req.method) && !NO_PERSON_NEEDED.has(requestPath(req))) actorId(req);
  });
  registerReferenceRoutes(app, ctx);
  registerDocumentRoutes(app, ctx);
  registerFactRoutes(app, ctx);
}
