import { describe, expect, it } from "vitest";
import type { DocumentDto, FactDto } from "@finshark/shared";
import { describeUpload, factDateLabel, findPreviousDocument, periodLabel, suggestionsFromFacts } from "./suggest.ts";

const doc = (id: number, o: Partial<DocumentDto> = {}): DocumentDto => ({
  id, sha256: "", originalFilename: `d${id}.pdf`, byteSize: 1, pageCount: 1, importedAt: "", docType: null, institutionId: 1, language: null,
  issuedOn: null, periodStart: null, periodEnd: null, taxYear: null, identityKey: null, status: "inbox", accountIds: [1], factCount: 2, ...o,
});

describe("findPreviousDocument", () => {
  const cur = doc(10, { periodEnd: "2025-06-30" });
  it("picks the latest earlier period sharing an account with facts", () => {
    const docs = [doc(1, { periodEnd: "2024-06-30" }), doc(2, { periodEnd: "2025-03-31" }), doc(3, { periodEnd: "2025-09-30" }), cur];
    expect(findPreviousDocument(cur, docs)?.id).toBe(2);
  });
  it("ignores other accounts, empty documents, itself", () => {
    const docs = [doc(1, { accountIds: [2] }), doc(2, { factCount: 0 }), cur];
    expect(findPreviousDocument(cur, docs)).toBeNull();
  });
  it("falls back to lower ids without periods and honours an explicit account list", () => {
    const c = doc(10, { accountIds: [] });
    const docs = [doc(4, { accountIds: [3] }), doc(5, { accountIds: [3] }), doc(11, { accountIds: [3] })];
    expect(findPreviousDocument(c, docs, [3])?.id).toBe(5);
    expect(findPreviousDocument(c, docs)).toBeNull();
  });
});

const fact = (id: number, o: Partial<FactDto> = {}): FactDto =>
  ({ id, conceptId: "balance.ending", conceptLabelEn: "Ending balance", conceptLabelHe: null, accountId: 1, accountLanguage: "en", formatted: "$1.00", status: "verified", origin: "manual",
    sources: [{ id: 1, documentId: 4, documentName: "", pageNo: 2, bbox: [1, 2, 3, 4], quotedText: null }], ...o }) as FactDto;

describe("suggestionsFromFacts", () => {
  it("one per concept+account, live facts only, with a hint", () => {
    const s = suggestionsFromFacts([fact(1), fact(2), fact(3, { status: "rejected", conceptId: "x" }), fact(4, { origin: "attestation", conceptId: "y" }), fact(5, { conceptId: "income.interest", accountId: 2 })], 4);
    expect(s.map((x) => x.conceptId)).toEqual(["balance.ending", "income.interest"]);
    expect(s[0]!.hint).toEqual({ pageNo: 2, bbox: [1, 2, 3, 4] });
  });
  it("filters by account list", () => {
    expect(suggestionsFromFacts([fact(1), fact(2, { accountId: 9, conceptId: "z" })], 4, [1]).map((x) => x.conceptId)).toEqual(["balance.ending"]);
  });
});

describe("describeUpload / labels", () => {
  it("describes each outcome", () => {
    expect(describeUpload({ status: "duplicate", existingDocumentId: 3, sha256: "" })).toMatchObject({ kind: "duplicate", related: [3] });
    const imp = { status: "imported" as const, documentId: 8, sha256: "", pageCount: 1, possibleDuplicateOf: [] as number[], possibleRevisionOf: [] as number[] };
    expect(describeUpload(imp).kind).toBe("imported");
    expect(describeUpload({ ...imp, possibleDuplicateOf: [2] })).toMatchObject({ kind: "possible_duplicate", related: [2], documentId: 8 });
    expect(describeUpload({ ...imp, possibleDuplicateOf: [2], possibleRevisionOf: [5] })).toMatchObject({ kind: "possible_revision", related: [5] });
  });
  it("formats periods and dates", () => {
    expect(periodLabel({ periodStart: "2025-01-01", periodEnd: "2025-03-31", taxYear: null })).toBe("2025-01-01 to 2025-03-31");
    expect(periodLabel({ periodStart: null, periodEnd: null, taxYear: 2025 })).toBe("tax year 2025");
    expect(factDateLabel({ instantDate: "2025-06-30", periodStart: null, periodEnd: null })).toBe("2025-06-30");
    expect(factDateLabel({ instantDate: null, periodStart: "a", periodEnd: "b" })).toBe("a to b");
  });
});
