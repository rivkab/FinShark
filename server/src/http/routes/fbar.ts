// FBAR report for a calendar year (DESIGN D18).
import type { FastifyInstance } from "fastify";
import { formatAmount, type FbarReportDto, type MoneyDto } from "@finshark/shared";
import { fbarReport, loadFbarInput, type FbarRow } from "../../query/index.ts";
import { badRequest, type ApiContext, type Json } from "./common.ts";

const money = (minor: bigint, currency: string): MoneyDto => ({ minor: minor.toString(), currency, formatted: formatAmount({ minor, currency }) });
const usd = (minor: bigint): MoneyDto => money(minor, "USD");

function rowDto(r: FbarRow): FbarReportDto["rows"][number] {
  const m = r.measure;
  return {
    accountId: r.accountId,
    displayName: r.displayName,
    country: r.country,
    currency: r.currency,
    status: m.status,
    max: m.max && { amount: money(m.max.minor, r.currency), date: m.max.date, factIds: m.max.factIds },
    usd: r.usdMinor === null ? null : usd(r.usdMinor),
    conversion:
      r.conversion === null
        ? null
        : r.conversion.kind === "rate"
          ? { kind: "rate", rate: r.conversion.rate, rateDate: r.conversion.rateDate }
          : r.conversion,
    coverageKnown: m.coverageKnown,
    missing: m.missing,
    conflicts: m.conflicts.map((c) => ({ date: c.date, values: c.values.map((v) => ({ amount: money(v.minor, r.currency), factIds: v.factIds })) })),
    excluded: m.excluded,
    factIds: m.derivation.factIds,
  };
}

export function registerFbarRoutes(app: FastifyInstance, ctx: ApiContext): void {
  app.get("/api/fbar", async (req) => {
    const raw = (req.query as Json)["year"];
    let year = ctx.now().getUTCFullYear() - 1; // FBARs are filed for the year just ended
    if (raw !== undefined) {
      if (typeof raw !== "string" || !/^\d{4}$/.test(raw) || Number(raw) < 2000 || Number(raw) > 2100) throw badRequest("year must be a four-digit year, 2000 to 2100.");
      year = Number(raw);
    }
    const r = fbarReport(loadFbarInput(ctx.db, year));
    return {
      year: r.year,
      status: r.status,
      verdict: r.verdict,
      threshold: usd(r.thresholdUsdMinor),
      knownAggregate: usd(r.knownAggregateUsdMinor),
      rows: r.rows.map(rowDto),
      notInScope: r.notInScope,
      tests: {
        sumOfMaxima: r.tests.sumOfMaxima,
        singleDate: {
          verdict: r.tests.singleDate.verdict,
          exceededOn: r.tests.singleDate.exceededOn,
          dates: r.tests.singleDate.dates.map((d) => ({ date: d.date, usd: usd(d.usdMinor), missingAccountIds: d.missingAccountIds })),
        },
      },
    } satisfies FbarReportDto;
  });
}
