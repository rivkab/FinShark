// Backups (DESIGN D20): status, back up now, verify, setup, the key on this Mac, the second folder.
import type { FastifyInstance } from "fastify";
import type { BackupFileDto, BackupSetupResponse, BackupStatusDto } from "@finshark/shared";
import { BackupError } from "../../backup/service.ts";
import { HttpError, jsonBody, reqStr, type ApiContext } from "./common.ts";

function toHttp(e: unknown): unknown {
  if (e instanceof BackupError) return new HttpError(e.code === "not_found" ? 404 : 409, e.code, e.message);
  if (e instanceof HttpError) return e;
  // Disk and permission errors: say what happened rather than "Unexpected error". Local only.
  if (e instanceof Error) {
    console.error(e);
    return new HttpError(500, "backup_failed", `Backup error: ${e.message}`);
  }
  return e;
}

export function registerBackupRoutes(app: FastifyInstance, ctx: ApiContext): void {
  const service = () => {
    if (!ctx.backups) throw new HttpError(404, "not_found", "Backups are not available.");
    return ctx.backups;
  };
  const run = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (e) {
      throw toHttp(e);
    }
  };

  app.get("/api/backups", async () => (await service().status()) satisfies BackupStatusDto);

  app.post("/api/backups", async (_req, reply) => {
    const f = await run(() => service().backupNow());
    return reply.code(201).send(f satisfies BackupFileDto);
  });

  app.post("/api/backups/:name/verify", async (req) => {
    const name = (req.params as Record<string, string>)["name"] ?? "";
    return (await run(() => service().verify(name))) satisfies BackupFileDto;
  });

  app.post("/api/backups/setup", async (req, reply) => {
    const passphrase = reqStr(jsonBody(req), "passphrase");
    const r = await run(() => service().setup(passphrase));
    return reply.code(201).send(r satisfies BackupSetupResponse);
  });

  app.post("/api/backups/setup/confirm", async (req) => {
    const lastChars = reqStr(jsonBody(req), "lastChars");
    await run(() => service().confirm(lastChars));
    // The first backup starts right away; the page shows it running.
    void service().backupNow().catch(() => {});
    return (await service().status()) satisfies BackupStatusDto;
  });

  app.post("/api/backups/key", async (req) => {
    const o = jsonBody(req);
    const input = typeof o["identity"] === "string" ? { identity: reqStr(o, "identity") } : { passphrase: reqStr(o, "passphrase") };
    await run(() => service().importKey(input));
    return (await service().status()) satisfies BackupStatusDto;
  });

  app.put("/api/backups/second-folder", async (req) => {
    const o = jsonBody(req);
    const p = o["path"] === null ? null : reqStr(o, "path").trim();
    await run(() => service().setSecondDir(p));
    return (await service().status()) satisfies BackupStatusDto;
  });
}
