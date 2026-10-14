import { describe, expect, it } from "vitest";
import { accountNames, conceptLabel, conceptPickerParts, currencyForCountry, filterConcepts, groupAccounts, languageForCountry, pickLabel } from "./labels.ts";

const c = (id: string, labelEn: string, labelHe: string | null, jurisdiction: string | null = null, deprecatedBy: string | null = null) => ({
  id,
  labelEn,
  labelHe,
  jurisdiction,
  deprecatedBy,
});
const CONCEPTS = [
  c("balance.ending", "Ending balance", "יתרה לסוף תקופה"),
  c("il.pension.accrued_savings", "Pension accrued savings", "סך חיסכון צבור", "IL"),
  c("us.w2.box1_wages", "Form W-2, Box 1: Wages", null, "US"),
  c("old.thing", "Old ending thing", null, null, "balance.ending"),
];

describe("pickLabel / conceptLabel", () => {
  it("uses Hebrew only for Hebrew context with a Hebrew label", () => {
    expect(pickLabel("Ending balance", "יתרה", "he")).toBe("יתרה");
    expect(pickLabel("Ending balance", "יתרה", "en")).toBe("Ending balance");
    expect(pickLabel("Ending balance", null, "he")).toBe("Ending balance");
    expect(pickLabel("Ending balance", "יתרה", null)).toBe("Ending balance");
  });
  it("jurisdiction concepts ignore the context language", () => {
    expect(conceptLabel(CONCEPTS[1]!, "en")).toBe("סך חיסכון צבור");
    expect(conceptLabel(CONCEPTS[2]!, "he")).toBe("Form W-2, Box 1: Wages");
    expect(conceptLabel(CONCEPTS[0]!, "he")).toBe("יתרה לסוף תקופה");
    expect(conceptLabel(CONCEPTS[0]!, "en")).toBe("Ending balance");
  });
});

describe("concept picker", () => {
  it("shows Hebrew beside Israeli concepts only", () => {
    expect(conceptPickerParts(CONCEPTS[1]!)).toEqual({ en: "Pension accrued savings", he: "סך חיסכון צבור" });
    expect(conceptPickerParts(CONCEPTS[0]!).he).toBeNull();
  });
  it("filters on English, Hebrew and id, hides deprecated", () => {
    expect(filterConcepts(CONCEPTS, "").map((x) => x.id)).toEqual(["balance.ending", "il.pension.accrued_savings", "us.w2.box1_wages"]);
    expect(filterConcepts(CONCEPTS, "pension").map((x) => x.id)).toEqual(["il.pension.accrued_savings"]);
    expect(filterConcepts(CONCEPTS, "חיסכון").map((x) => x.id)).toEqual(["il.pension.accrued_savings"]);
    expect(filterConcepts(CONCEPTS, "יתרה").map((x) => x.id)).toEqual(["balance.ending"]);
    expect(filterConcepts(CONCEPTS, "W-2 wages").map((x) => x.id)).toEqual(["us.w2.box1_wages"]);
    expect(filterConcepts(CONCEPTS, "box1").map((x) => x.id)).toEqual(["us.w2.box1_wages"]);
    expect(filterConcepts(CONCEPTS, "old")).toEqual([]);
  });
  it("puts prefix matches first", () => {
    const list = [c("a", "Total ending", null), c("b", "Ending balance", null)];
    expect(filterConcepts(list, "ending").map((x) => x.id)).toEqual(["b", "a"]);
  });
});

describe("accounts and countries", () => {
  it("keeps the alt name secondary and hides it when identical", () => {
    expect(accountNames({ displayName: "בנק לאומי", altName: "Bank Leumi" })).toEqual({ name: "בנק לאומי", alt: "Bank Leumi" });
    expect(accountNames({ displayName: "Fidelity", altName: null })).toEqual({ name: "Fidelity", alt: null });
    expect(accountNames({ displayName: "X", altName: "X" }).alt).toBeNull();
  });
  it("defaults language and currency from country", () => {
    expect(languageForCountry("IL")).toBe("he");
    expect(languageForCountry("il")).toBe("he");
    expect(languageForCountry("US")).toBe("en");
    expect(currencyForCountry("IL")).toBe("ILS");
    expect(currencyForCountry("US")).toBe("USD");
  });
  it("groups accounts of the document's institution first", () => {
    const accts = [{ id: 1, institutionId: 5 }, { id: 2, institutionId: 6 }, { id: 3, institutionId: 5 }];
    expect(groupAccounts(accts, 5)).toEqual({ preferred: [accts[0], accts[2]], others: [accts[1]] });
    expect(groupAccounts(accts, null)).toEqual({ preferred: accts, others: [] });
  });
});
