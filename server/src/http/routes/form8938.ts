// Form 8938 report for a tax year (DESIGN D21). All money leaves as MoneyDto; no bigint reaches JSON.
import type { FastifyInstance } from "fastify";
import {
  formatAmount,
  type Form8938ConversionDto,
  type Form8938MaximumDto,
  type Form8938ReportDto,
  type Form8938RowDto,
  type Form8938ScenarioDto,
  type Form8938TaxItemsDto,
  type Form8938ValueDto,
  type MoneyDto,
} from "@finshark/shared";
import { form8938Report, loadForm8938Input, type AccountValue, type Form8938Row, type Paired, type ScenarioResult, type TaxItems } from "../../query/index.ts";
import { reportYear, type ApiContext, type Json } from "./common.ts";

const money = (minor: bigint, currency: string): MoneyDto => ({ minor: minor.toString(), currency, formatted: formatAmount({ minor, currency }) });
const usd = (minor: bigint): MoneyDto => money(minor, "USD");
const pair = <A, B>(p: Paired<A>, f: (a: A) => B): { counted: B; withUnresolved: B } => ({ counted: f(p.counted), withUnresolved: f(p.withUnresolved) });

function valueDto(v: AccountValue & { status: Form8938ValueDto["status"] }, currency: string): Form8938ValueDto {
  return {
    native: v.minor === null ? null : money(v.minor, currency),
    usd: v.usdMinor === null ? null : usd(v.usdMinor),
    source: v.source,
    date: v.date,
    factIds: v.factIds,
    status: v.status,
  };
}

function taxItemsDto(t: TaxItems, currency: string): Form8938TaxItemsDto {
  return {
    groups: t.groups.map((g) => ({
      genericConceptId: g.genericConceptId,
      currency: g.currency,
      periods: g.periods.map((p) => ({
        periodStart: p.periodStart,
        periodEnd: p.periodEnd,
        value: p.valueMinor === null ? null : money(p.valueMinor, currency),
        conceptIds: p.conceptIds,
        factIds: p.factIds,
        disagreeing: p.disagreeing && p.disagreeing.map((d) => ({ amount: money(d.minor, currency), factIds: d.factIds })),
      })),
      total: g.totalMinor === null ? null : money(g.totalMinor, currency),
      complete: g.complete,
      gaps: g.gaps,
      overlaps: g.overlaps,
      factIds: g.factIds,
    })),
    excluded: t.excluded,
    noTaxItems: t.noTaxItems,
  };
}

function rowDto(r: Form8938Row): Form8938RowDto {
  const m = r.maximum.measure;
  const maximum: Form8938MaximumDto = {
    ...valueDto(r.maximum, r.currency),
    approximation: r.maximum.approximation,
    missingDates: m.missing,
    coverageKnown: m.coverageKnown,
    conflicts: m.conflicts.map((c) => ({ date: c.date, values: c.values.map((v) => ({ amount: money(v.minor, r.currency), factIds: v.factIds })) })),
  };
  const conversion: Form8938ConversionDto =
    r.conversion.kind === "rate" ? { kind: "rate", rate: r.conversion.rate, rateDate: r.conversion.rateDate, rateId: r.conversion.rateId } : r.conversion;
  return {
    accountId: r.accountId,
    displayName: r.displayName,
    country: r.country,
    currency: r.currency,
    treatment: r.treatment,
    counted: r.counted,
    conversion,
    maximum,
    yearEnd: valueDto(r.yearEnd, r.currency),
    details: r.details,
    taxItems: r.taxItems && taxItemsDto(r.taxItems, r.currency),
  };
}

function scenarioDto(s: ScenarioResult): Form8938ScenarioDto {
  return {
    thresholds: { yearEnd: usd(s.thresholds.yearEndUsdMinor), anyTime: usd(s.thresholds.anyTimeUsdMinor) },
    yearEnd: s.yearEnd,
    sumOfMaxima: s.sumOfMaxima,
    singleDate: s.singleDate,
    verdict: s.verdict,
  };
}

export function registerForm8938Routes(app: FastifyInstance, ctx: ApiContext): void {
  app.get("/api/form8938", async (req) => {
    const year = reportYear(ctx, (req.query as Json)["year"]);
    const r = form8938Report(loadForm8938Input(ctx.db, year));
    return {
      year: r.year,
      filingStatus: r.filingStatus,
      abroad: r.abroad,
      applied: r.applied,
      verdict: r.verdict,
      reasons: r.reasons,
      status: r.status,
      taxItemsStatus: r.taxItemsStatus,
      scenarios: { us: scenarioDto(r.scenarios.us), abroad: scenarioDto(r.scenarios.abroad) },
      totals: {
        yearEnd: pair(r.totals.yearEndUsdMinor, usd),
        sumOfMaxima: pair(r.totals.sumOfMaximaUsdMinor, usd),
        singleDate: pair(r.totals.singleDate, (ds) => ds.map((d) => ({ date: d.date, usd: usd(d.usdMinor), missingAccountIds: d.missingAccountIds }))),
      },
      rows: r.rows.map(rowDto),
      notReportable: r.notReportable,
      notInScope: r.notInScope,
      partIV: r.partIV,
    } satisfies Form8938ReportDto;
  });
}
