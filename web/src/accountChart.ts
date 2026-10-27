import { currencyExponent, formatAmount } from "@finshark/shared";
import type { FactDto } from "@finshark/shared";
import { formatDay } from "./displayDate.ts";
import { hrefDocument, hrefFact } from "./route.ts";
import type { SeriesPoint } from "./balanceSeries.ts";

const UNITS: readonly { size: bigint; suffix: string }[] = [
  { size: 1_000n, suffix: "k" },
  { size: 1_000_000n, suffix: "M" },
  { size: 1_000_000_000n, suffix: "B" },
];

function symbolFor(currency: string): { prefix: string; suffix: string } {
  const sample = formatAmount({ minor: 0n, currency });
  const m = /^(\D*)\d/.exec(sample);
  if (m && m[1]) return { prefix: m[1], suffix: "" };
  return { prefix: "", suffix: ` ${currency}` };
}

function scaled(whole: bigint, i: number): string {
  const unit = UNITS[i]!;
  const tenths = (whole * 10n + unit.size / 2n) / unit.size;
  if (tenths < 100n) {
    const f = tenths % 10n;
    return `${tenths / 10n}${f === 0n ? "" : `.${f}`}${unit.suffix}`;
  }
  const r = (tenths + 5n) / 10n;
  if (r >= 1000n && i + 1 < UNITS.length) return scaled(whole, i + 1);
  return `${r}${unit.suffix}`;
}

/** An axis label: "₪40k", "$1.2M", "-$5k", "0". Whole currency units only; all arithmetic is bigint. */
export function compactAmount(minor: bigint, currency: string): string {
  const neg = minor < 0n;
  const abs = neg ? -minor : minor;
  const whole = abs / 10n ** BigInt(currencyExponent(currency));
  if (whole === 0n) return "0";
  const { prefix, suffix } = symbolFor(currency);
  let body: string;
  if (whole < 1000n) body = `${whole}`;
  else {
    let i = 0;
    while (i + 1 < UNITS.length && whole >= UNITS[i + 1]!.size) i++;
    body = scaled(whole, i);
  }
  return `${neg ? "-" : ""}${prefix}${body}${suffix}`;
}

/** Where a fact's number came from: the first source's document, or the fact itself (attested, no source). */
export function factEvidenceHref(fact: FactDto): string {
  const s = fact.sources[0];
  return s ? hrefDocument(s.documentId, fact.id) : hrefFact(fact.id);
}

/** Where clicking a chart point goes: a conflict goes to the fact page, where it is resolved. */
export function pointHref(point: Pick<SeriesPoint, "facts" | "conflict">): string {
  const first = point.facts[0]!;
  return point.conflict ? hrefFact(first.id) : factEvidenceHref(first);
}

/** Distinct source document names across a point's facts, in order. */
export function sourceNames(point: Pick<SeriesPoint, "facts">): string[] {
  const names: string[] = [];
  for (const f of point.facts) for (const s of f.sources) if (!names.includes(s.documentName)) names.push(s.documentName);
  return names;
}

/** Tooltip lines for a point, joined with " · ". */
export function pointDetail(point: SeriesPoint): string {
  const parts = [formatDay(point.date), point.facts[0]!.conceptLabelEn];
  const names = sourceNames(point);
  if (names.length > 0) parts.push(names.join(", "));
  else parts.push("attested");
  if (point.facts.length > 1) parts.push(`${point.facts.length} sources`);
  if (point.conflict) parts.push("conflict");
  return parts.join(" · ");
}

export interface BalanceRowSource {
  factId: number;
  documentId: number | null;
  documentName: string | null;
  pageNo: number | null;
  href: string;
}
export interface BalanceRow {
  key: string;
  date: string;
  formatted: string;
  conflict: boolean;
  sources: BalanceRowSource[];
}

/** Table rows, newest first (conflicting values on one date: larger first, as the series sorts ascending). */
export function balanceRows(points: readonly SeriesPoint[]): BalanceRow[] {
  return points
    .map((p): BalanceRow => ({
      key: `${p.date}|${p.minor}`,
      date: p.date,
      formatted: p.formatted,
      conflict: p.conflict,
      sources: p.facts.flatMap((f): BalanceRowSource[] =>
        f.sources.length === 0
          ? [{ factId: f.id, documentId: null, documentName: null, pageNo: null, href: hrefFact(f.id) }]
          : f.sources.map((s) => ({
              factId: f.id,
              documentId: s.documentId,
              documentName: s.documentName,
              pageNo: s.pageNo,
              href: hrefDocument(s.documentId, f.id),
            })),
      ),
    }))
    .reverse();
}
