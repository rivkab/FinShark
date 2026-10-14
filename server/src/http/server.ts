import type { FastifyInstance } from "fastify";
import type { ExtractFn } from "../documents/text-layer.ts";
import type { Vault } from "../vault/vault.ts";
import { buildApp } from "./app.ts";
import { DEFAULT_MAX_UPLOAD_BYTES, registerApiRoutes } from "./routes/index.ts";

export interface ServerDeps {
  vault: Pick<Vault, "db" | "layout">;
  port: number;
  token: string;
  now: () => Date;
  /** Unique ids (temp names); crypto.randomUUID in production. */
  newId: () => string;
  randomId?: () => string;
  staticDir?: string;
  maxUploadBytes?: number;
  extractText?: ExtractFn;
}

/** The app with all security hooks, the people check and the API routes wired to a vault. */
export function buildServer(deps: ServerDeps): FastifyInstance {
  const { db, layout } = deps.vault;
  const isPerson = db.prepare("SELECT 1 FROM people WHERE id = ?");
  return buildApp({
    port: deps.port,
    token: deps.token,
    now: () => deps.now().getTime(),
    ...(deps.randomId ? { randomId: deps.randomId } : {}),
    ...(deps.staticDir ? { staticDir: deps.staticDir } : {}),
    isValidPerson: (id) => /^\d{1,15}$/.test(id) && isPerson.get(Number(id)) !== undefined,
    registerRoutes: (app) =>
      registerApiRoutes(app, {
        db,
        layout,
        now: deps.now,
        newId: deps.newId,
        maxUploadBytes: deps.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES,
        extractText: deps.extractText,
      }),
  });
}
