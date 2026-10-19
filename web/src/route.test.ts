import { describe, expect, it } from "vitest";
import { hrefDocument, hrefDocuments, hrefFacts, parseHash } from "./route.ts";

describe("parseHash", () => {
  it("reads an account filter on the documents list", () => {
    expect(parseHash("#/documents?account=7")).toEqual({ page: "documents", accountId: 7 });
    expect(parseHash("#/documents?account=abc")).toEqual({ page: "documents", accountId: null });
    expect(hrefDocuments(7)).toBe("#/documents?account=7");
    expect(hrefDocuments()).toBe("#/documents");
    expect(hrefDocuments(null)).toBe("#/documents");
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
  it("parses review, facts, fact history, accounts, demo", () => {
    expect(parseHash("#/review")).toEqual({ page: "review", factId: null });
    expect(parseHash("#/review?fact=7")).toEqual({ page: "review", factId: 7 });
    expect(parseHash("#/facts")).toEqual({ page: "facts", filters: {} });
    expect(parseHash("#/facts?status=proposed&account=3&junk=1")).toEqual({ page: "facts", filters: { status: "proposed", account: "3" } });
    expect(parseHash("#/facts/9")).toEqual({ page: "fact", id: 9 });
    expect(parseHash("#/accounts")).toEqual({ page: "accounts" });
    expect(parseHash("#/people")).toEqual({ page: "people" });
    expect(parseHash("#/demo")).toEqual({ page: "demo" });
  });
  it("round-trips the href builders", () => {
    expect(parseHash(hrefDocument(5, 6))).toEqual({ page: "document", id: 5, factId: 6 });
    expect(hrefDocument(5)).toBe("#/documents/5");
    expect(parseHash(hrefFacts({ concept: "balance.ending", status: "" }))).toEqual({ page: "facts", filters: { concept: "balance.ending" } });
  });
  it("survives malformed escapes", () => {
    expect(parseHash("#/%E0%A4%A")).toEqual({ page: "accounts" });
  });
});
