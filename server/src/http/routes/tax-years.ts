// Per-year tax settings and Form 8938 account classification (DESIGN D21).
import type { FastifyInstance, FastifyRequest } from "fastify";
import { FILING_STATUSES, US_8938_TERM_IDS, type FilingStatus, type TaxYearDto, type Us8938ClassificationDto, type Us8938TermId } from "@finshark/shared";
import { getTaxYear, setTaxYear, setUs8938Term, us8938TermFor } from "../../db/tax-years.ts";
import { badRequest, idParam, jsonBody, notFound, reqInt, type ApiContext } from "./common.ts";

function yearParam(req: FastifyRequest): number {
  const raw = (req.params as Record<string, string>)["year"] ?? "";
  if (!/^\d{4}$/.test(raw) || Number(raw) < 2000 || Number(raw) > 2100) throw badRequest("year must be a four-digit year, 2000 to 2100.");
  return Number(raw);
}

export function registerTaxYearRoutes(app: FastifyInstance, ctx: ApiContext): void {
  const { db } = ctx;

  const taxYearDto = (year: number): TaxYearDto => {
    const r = getTaxYear(db, year);
    return { year, filingStatus: r?.filingStatus ?? null, abroad8938: r?.abroad8938 ?? null, updatedAt: r?.updatedAt ?? null };
  };

  app.get("/api/tax-years/:year", async (req) => taxYearDto(yearParam(req)));

  app.put("/api/tax-years/:year", async (req) => {
    const year = yearParam(req);
    const o = jsonBody(req);
    const fs = o["filingStatus"];
    if (fs === undefined || (fs !== null && (typeof fs !== "string" || !FILING_STATUSES.includes(fs as FilingStatus)))) {
      throw badRequest(`filingStatus is required: null or one of ${FILING_STATUSES.join(", ")}.`);
    }
    const ab = o["abroad8938"];
    if (ab !== null && typeof ab !== "boolean") throw badRequest("abroad8938 is required: true, false or null.");
    setTaxYear(db, ctx.now(), year, { filingStatus: fs as FilingStatus | null, abroad8938: ab });
    return taxYearDto(year);
  });

  app.put("/api/accounts/:id/us-8938", async (req, reply) => {
    const accountId = idParam(req);
    if (!db.prepare("SELECT 1 FROM accounts WHERE id = ?").get(accountId)) throw notFound("Account");
    const o = jsonBody(req);
    const year = reqInt(o, "year");
    if (year < 2000 || year > 2100) throw badRequest("year must be a four-digit year, 2000 to 2100.");
    const termId = o["termId"];
    if (termId === undefined || (termId !== null && (typeof termId !== "string" || !US_8938_TERM_IDS.includes(termId as Us8938TermId)))) {
      throw badRequest(`termId is required: null or one of ${US_8938_TERM_IDS.join(", ")}.`);
    }
    const rawReason = o["reason"];
    if (rawReason !== undefined && rawReason !== null && typeof rawReason !== "string") throw badRequest("reason must be a string or null.");
    const reason = typeof rawReason === "string" && rawReason.trim() !== "" ? rawReason.trim() : null;
    if (termId === "us_8938/not_reportable") {
      if (reason === null) throw badRequest("reason is required when an account is not reportable.");
    } else if (rawReason !== undefined && rawReason !== null) {
      throw badRequest("reason is only allowed for us_8938/not_reportable (use null).");
    }
    setUs8938Term(db, accountId, year, termId as Us8938TermId | null, reason);
    const t = us8938TermFor(db, accountId, year);
    const body: Us8938ClassificationDto | null = t && { year, ...t };
    return reply.header("content-type", "application/json").send(JSON.stringify(body));
  });
}
