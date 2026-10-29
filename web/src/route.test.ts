import { describe, expect, it } from "vitest";
import { hrefPay, hrefFbar, hrefAccount, hrefDocument, hrefDocuments, hrefFact, parseHash } from "./route.ts";

describe("parseHash", () => {
  it("reads an account filter on the documents list", () => {
    expect(parseHash("#/documents?account=7")).toEqual({ page: "documents", accountId: 7 });
    expect(parseHash("#/documents?account=abc")).toEqual({ page: "documents", accountId: null });
    expect(hrefDocuments(7)).toBe("#/documents?account=7");
    expect(hrefDocuments()).toBe("#/documents");
    expect(hrefDocuments(null)).toBe("#/documents");
  });
  it("parses an account page", () => {
    expect(parseHash("#/accounts/7")).toEqual({ page: "account", id: 7 });
    expect(parseHash("#/accounts/x")).toEqual({ page: "accounts" });
    expect(hrefAccount(7)).toBe("#/accounts/7");
  });
  it("parses the pay page", () => {
    expect(parseHash("#/pay")).toEqual({ page: "pay" });
    expect(hrefPay()).toBe("#/pay");
  });
  it("defaults to accounts", () => {
    for (const h of ["", "#", "#/", "#/nonsense"]) expect(parseHash(h)).toEqual({ page: "accounts" });
  });
  it("parses document links with a fact", () => {
    expect(parseHash("#/documents/12?fact=40")).toEqual({ page: "document", id: 12, factId: 40 });
    expect(parseHash("#/documents/12")).toEqual({ page: "document", id: 12, factId: null });
    expect(parseHash("#/documents/12?fact=abc")).toEqual({ page: "document", id: 12, factId: null });
    expect(parseHash("#/documents/x")).toEqual({ page: "documents", accountId: null });
  });
  it("parses facts, fact history, accounts, demo", () => {
    // The Facts list is gone (D19); `#/facts` falls back to the default page.
    expect(parseHash("#/facts")).toEqual({ page: "accounts" });
    expect(parseHash("#/facts?status=proposed")).toEqual({ page: "accounts" });
    expect(parseHash("#/facts/9")).toEqual({ page: "fact", id: 9 });
    expect(parseHash("#/accounts")).toEqual({ page: "accounts" });
    // There is no People page (DESIGN D16); an old bookmark lands on the default page.
    expect(parseHash("#/people")).toEqual({ page: "accounts" });
    expect(parseHash("#/rates")).toEqual({ page: "rates" });
    expect(parseHash("#/fbar")).toEqual({ page: "fbar", year: null });
    expect(parseHash("#/fbar?year=2025")).toEqual({ page: "fbar", year: 2025 });
    expect(parseHash("#/fbar?year=abc")).toEqual({ page: "fbar", year: null });
    expect(hrefFbar(2025)).toBe("#/fbar?year=2025");
    expect(hrefFbar()).toBe("#/fbar");
    expect(parseHash("#/demo")).toEqual({ page: "demo" });
    expect(parseHash("#/design")).toEqual({ page: "design" });
  });
  it("round-trips the href builders", () => {
    expect(parseHash(hrefDocument(5, 6))).toEqual({ page: "document", id: 5, factId: 6 });
    expect(hrefDocument(5)).toBe("#/documents/5");
    expect(parseHash(hrefFact(9))).toEqual({ page: "fact", id: 9 });
  });
  it("survives malformed escapes", () => {
    expect(parseHash("#/%E0%A4%A")).toEqual({ page: "accounts" });
  });
});
