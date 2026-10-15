// Label and picker helpers (DESIGN §14 D3). Pure functions, unit-tested.
import type { AccountDto, AccountType, ConceptDto, Language } from "@finshark/shared";

/** English label for an account type (UI chrome is English, DESIGN D3). */
export const ACCOUNT_TYPE_LABEL: Readonly<Record<AccountType, string>> = {
  checking: "Checking",
  savings: "Savings",
  deposit: "Fixed deposit / CD",
  investment: "Investment / brokerage",
  pension: "Pension",
  provident_fund: "Provident fund (kupat gemel)",
  keren_hishtalmut: "Keren hishtalmut",
  credit_card: "Credit card",
  loan: "Loan",
  mortgage: "Mortgage",
  insurance: "Insurance",
  other: "Other",
};

/** Hebrew label when the surrounding context is Hebrew and a Hebrew label exists, otherwise English. */
export function pickLabel(en: string, he: string | null | undefined, lang: Language | null | undefined): string {
  return lang === "he" && he ? he : en;
}

/**
 * Label for a concept shown next to an account or document in `contextLang`.
 * Jurisdiction concepts follow their jurisdiction (IL -> Hebrew, US -> English); generic ones follow the context.
 */
export function conceptLabel(c: Pick<ConceptDto, "labelEn" | "labelHe" | "jurisdiction">, contextLang: Language | null | undefined): string {
  if (c.jurisdiction === "IL") return pickLabel(c.labelEn, c.labelHe, "he");
  if (c.jurisdiction === "US") return c.labelEn;
  return pickLabel(c.labelEn, c.labelHe, contextLang);
}

/** Picker display: English first, Hebrew beside it for Israeli concepts. */
export function conceptPickerParts(c: Pick<ConceptDto, "labelEn" | "labelHe" | "jurisdiction">): { en: string; he: string | null } {
  return { en: c.labelEn, he: c.jurisdiction === "IL" && c.labelHe ? c.labelHe : null };
}

function norm(s: string): string {
  return s.toLowerCase().normalize("NFC").trim();
}

/** Non-deprecated concepts whose English label, Hebrew label or id contain every word of the query. */
export function filterConcepts<T extends Pick<ConceptDto, "id" | "labelEn" | "labelHe" | "deprecatedBy">>(concepts: readonly T[], query: string): T[] {
  const words = norm(query).split(/\s+/).filter(Boolean);
  const hits = concepts.filter((c) => {
    if (c.deprecatedBy) return false;
    const hay = norm(`${c.labelEn} ${c.labelHe ?? ""} ${c.id}`);
    return words.every((w) => hay.includes(w));
  });
  const q = norm(query);
  if (!q) return hits;
  const rank = (c: T) => (norm(c.labelEn).startsWith(q) || norm(c.labelHe ?? "").startsWith(q) ? 0 : 1);
  return hits
    .map((c, i) => ({ c, i }))
    .sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i)
    .map((x) => x.c);
}

/** Account name in its own language; the other-language name is secondary. */
export function accountNames(a: Pick<AccountDto, "displayName" | "altName">): { name: string; alt: string | null } {
  return { name: a.displayName, alt: a.altName && a.altName !== a.displayName ? a.altName : null };
}

export function languageForCountry(country: string): Language {
  return country.trim().toUpperCase() === "IL" ? "he" : "en";
}

export function currencyForCountry(country: string): string {
  return country.trim().toUpperCase() === "IL" ? "ILS" : "USD";
}

export interface AccountGroups<T> {
  preferred: T[];
  others: T[];
}

/** Accounts of the document's institution first. With no institution everything is "preferred". */
export function groupAccounts<T extends Pick<AccountDto, "institutionId">>(accounts: readonly T[], institutionId: number | null): AccountGroups<T> {
  if (institutionId === null) return { preferred: [...accounts], others: [] };
  return {
    preferred: accounts.filter((a) => a.institutionId === institutionId),
    others: accounts.filter((a) => a.institutionId !== institutionId),
  };
}
