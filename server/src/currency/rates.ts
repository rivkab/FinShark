// Store and look up exchange rates (DESIGN §5). Rates are data: never fetched, never guessed.
import type { DatabaseSync } from "node:sqlite";
import { Decimal } from "decimal.js";
import { parseTreasuryCsv, type TreasuryRate } from "./treasury.ts";

export const TREASURY_SOURCE = "us_treasury_reporting";

export interface ImportRatesResult {
  added: number;
  /** Already stored with the same rate. */
  unchanged: number;
  /** Stored with a different rate; left as is and reported, never overwritten. */
  conflicts: { quote: string; rateDate: string; stored: string; incoming: string }[];
  skippedCurrencies: number;
}

export interface StoredRate {
  id: number;
  sourceId: string;
  base: string;
  quote: string;
  rate: string;
  rateDate: string;
  sourceDocumentId: number | null;
  note: string | null;
}

export function importTreasuryRates(
  deps: { db: DatabaseSync; now: () => Date },
  csv: string,
  note: string | null = null,
): ImportRatesResult {
  const parsed = parseTreasuryCsv(csv);
  const result: ImportRatesResult = { added: 0, unchanged: 0, conflicts: [], skippedCurrencies: parsed.skippedCurrencies };
  const find = deps.db.prepare("SELECT rate FROM exchange_rates WHERE source_id = ? AND base = ? AND quote = ? AND rate_date = ?");
  const insert = deps.db.prepare(
    "INSERT INTO exchange_rates (source_id, base, quote, rate, rate_date, note, imported_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const importedAt = deps.now().toISOString();
  deps.db.exec("BEGIN");
  try {
    for (const r of parsed.rates as TreasuryRate[]) {
      const stored = find.get(TREASURY_SOURCE, r.base, r.quote, r.rateDate) as { rate: string } | undefined;
      if (!stored) {
        insert.run(TREASURY_SOURCE, r.base, r.quote, r.rate, r.rateDate, note, importedAt);
        result.added++;
      } else if (new Decimal(stored.rate).eq(r.rate)) result.unchanged++;
      else result.conflicts.push({ quote: r.quote, rateDate: r.rateDate, stored: stored.rate, incoming: r.rate });
    }
    deps.db.exec("COMMIT");
  } catch (e) {
    deps.db.exec("ROLLBACK");
    throw e;
  }
  return result;
}

/**
 * The rate published for exactly `rateDate`, or null. There is deliberately no "nearest date"
 * fallback (DESIGN §5): a missing rate makes the conversion missing and the result incomplete.
 * `base`/`quote` as stored; call with ("USD", "ILS") for ILS per 1 USD.
 */
export function findRate(db: DatabaseSync, sourceId: string, base: string, quote: string, rateDate: string): StoredRate | null {
  const r = db
    .prepare("SELECT * FROM exchange_rates WHERE source_id = ? AND base = ? AND quote = ? AND rate_date = ?")
    .get(sourceId, base, quote, rateDate) as Record<string, unknown> | undefined;
  if (!r) return null;
  return {
    id: Number(r["id"]),
    sourceId: String(r["source_id"]),
    base: String(r["base"]),
    quote: String(r["quote"]),
    rate: String(r["rate"]),
    rateDate: String(r["rate_date"]),
    sourceDocumentId: r["source_document_id"] === null ? null : Number(r["source_document_id"]),
    note: (r["note"] as string | null) ?? null,
  };
}
