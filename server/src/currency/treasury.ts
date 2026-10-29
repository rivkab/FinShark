// Parse the US Treasury "Reporting Rates of Exchange" CSV (fiscaldata.treasury.gov download).
// Rates are foreign currency units per 1 USD. Pure: no I/O, no clock.
//
// The download comes in two header styles: display names ("Record Date", "Country - Currency
// Description", "Exchange Rate", "Effective Date") and API names ("record_date",
// "country_currency_desc", ...). Both are read. A rate is stored under its *effective* date:
// Treasury sometimes republishes a quarter-end rate mid-quarter (same record date, later
// effective date), and the two must not collide.
import { Decimal } from "decimal.js";

/** Treasury's `country_currency_desc` -> ISO 4217, for the currencies the app knows (see CURRENCY_EXPONENT). */
const TREASURY_CURRENCY: Readonly<Record<string, string>> = {
  "Israel-Shekel": "ILS",
};

export interface TreasuryRate {
  /** 1 USD = `rate` units of `quote`. */
  base: "USD";
  quote: string;
  /** Exact decimal string, as published. */
  rate: string;
  /** The date the rate takes effect (the CSV's effective date; its record date if the file has none). */
  rateDate: string;
}

export interface TreasuryParseResult {
  rates: TreasuryRate[];
  /** Rows for currencies the app does not know yet; counted, never silently dropped. */
  skippedCurrencies: number;
}

export class RateParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateParseError";
  }
}

/** Minimal RFC 4180 reader: quoted fields, "" escapes, CRLF or LF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  if (quoted) throw new RateParseError("Unterminated quote in CSV");
  row.push(field);
  if (row.some((f) => f !== "")) rows.push(row);
  return rows;
}

/** "Country - Currency Description" -> "country_currency_description". */
const normalizeHeader = (h: string): string => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseTreasuryCsv(text: string): TreasuryParseResult {
  const [header, ...body] = parseCsv(text);
  if (!header) throw new RateParseError("The file is empty");
  const names = header.map(normalizeHeader);
  const col = (...aliases: string[]): number => {
    const i = names.findIndex((n) => aliases.includes(n));
    if (i < 0) throw new RateParseError(`Missing column "${aliases[0]}": is this the Treasury Reporting Rates of Exchange CSV?`);
    return i;
  };
  const iDesc = col("country_currency_desc", "country_currency_description");
  const iRate = col("exchange_rate");
  const iRecord = col("record_date");
  const iEffective = names.indexOf("effective_date");

  const rates: TreasuryRate[] = [];
  let skippedCurrencies = 0;
  body.forEach((r, n) => {
    const line = n + 2;
    const quote = TREASURY_CURRENCY[r[iDesc] ?? ""];
    if (!quote) {
      skippedCurrencies++;
      return;
    }
    const effective = iEffective < 0 ? "" : (r[iEffective] ?? "").trim();
    const rateDate = effective || (r[iRecord] ?? "").trim();
    if (!ISO_DATE.test(rateDate)) throw new RateParseError(`Line ${line}: bad date "${rateDate}"`);
    const raw = (r[iRate] ?? "").trim();
    let d: Decimal;
    try {
      d = new Decimal(raw);
    } catch {
      throw new RateParseError(`Line ${line}: bad exchange_rate "${raw}"`);
    }
    if (!d.isFinite() || !d.gt(0)) throw new RateParseError(`Line ${line}: exchange_rate must be positive, got "${raw}"`);
    rates.push({ base: "USD", quote, rate: raw, rateDate });
  });
  return { rates, skippedCurrencies };
}
