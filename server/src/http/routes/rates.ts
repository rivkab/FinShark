// Exchange rates: import a Treasury CSV, list what is stored.
import type { FastifyInstance } from "fastify";
import type { ExchangeRateDto, ImportRatesResponse } from "@finshark/shared";
import { importTreasuryRates } from "../../currency/index.ts";
import { HttpError, optStr, type ApiContext, type Json } from "./common.ts";

/** A year of quarterly rates for every country is well under 1 MB; this is generous. */
const MAX_CSV_BYTES = 5 * 1024 * 1024;

export function registerRateRoutes(app: FastifyInstance, ctx: ApiContext): void {
  app.addContentTypeParser("text/csv", { parseAs: "string", bodyLimit: MAX_CSV_BYTES }, (_req, body, done) => {
    done(null, body);
  });

  app.post("/api/exchange-rates/import", { bodyLimit: MAX_CSV_BYTES }, async (req, reply) => {
    if (typeof req.body !== "string") {
      throw new HttpError(415, "unsupported_media_type", "Send the CSV as the raw request body with Content-Type: text/csv.");
    }
    const note = optStr(req.query as Json, "note")?.trim() || null;
    const r = importTreasuryRates({ db: ctx.db, now: ctx.now }, req.body, note);
    return reply.code(201).send(r satisfies ImportRatesResponse);
  });

  app.get("/api/exchange-rates", async () => {
    const rows = ctx.db.prepare("SELECT * FROM exchange_rates ORDER BY source_id, quote, rate_date DESC").all() as Record<string, unknown>[];
    return {
      rates: rows.map(
        (r): ExchangeRateDto => ({
          id: Number(r["id"]),
          sourceId: String(r["source_id"]),
          base: String(r["base"]),
          quote: String(r["quote"]),
          rate: String(r["rate"]),
          rateDate: String(r["rate_date"]),
          note: (r["note"] as string | null) ?? null,
          importedAt: String(r["imported_at"]),
        }),
      ),
    };
  });
}
