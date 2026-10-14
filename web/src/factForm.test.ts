import { describe, expect, it } from "vitest";
import type { ConceptDto, FactDto } from "@finshark/shared";
import {
  applyConceptChange,
  buildAttestationRequest,
  buildCorrectRequest,
  buildProposeRequest,
  defaultCurrency,
  emptyFactForm,
  formFromFact,
  mismatchWarning,
  validateAttestation,
  validateFactForm,
  valueForForm,
} from "./factForm.ts";

const concept = (id: string, periodType: ConceptDto["periodType"], valueType: ConceptDto["valueType"] = "money"): ConceptDto => ({
  id,
  labelEn: id,
  labelHe: null,
  description: null,
  periodType,
  valueType,
  subject: "account",
  genericConceptId: null,
  jurisdiction: null,
  authorityRank: 0,
  deprecatedBy: null,
});
const BAL = concept("balance.ending", "instant");
const INT = concept("income.interest", "duration");
const FLAG = concept("status.account_closed", "instant", "boolean");
const doc = { periodStart: "2025-04-01", periodEnd: "2025-06-30" };
const WHERE = { documentId: 3, pageNo: 2, bbox: [1, 2, 3, 4] as [number, number, number, number] };

describe("applyConceptChange", () => {
  it("prefills instant and duration dates from the document", () => {
    const a = applyConceptChange(emptyFactForm(), BAL, undefined, doc);
    expect(a).toMatchObject({ conceptId: "balance.ending", instantDate: "2025-06-30", periodStart: "", periodEnd: "" });
    const b = applyConceptChange(a, INT, BAL, doc);
    expect(b).toMatchObject({ conceptId: "income.interest", instantDate: "", periodStart: "2025-04-01", periodEnd: "2025-06-30" });
  });
  it("keeps dates the user typed", () => {
    const a = { ...applyConceptChange(emptyFactForm(), BAL, undefined, doc), instantDate: "2025-06-15" };
    expect(applyConceptChange(a, BAL, BAL, doc).instantDate).toBe("2025-06-15");
  });
  it("clears everything for no concept", () => {
    expect(applyConceptChange({ ...emptyFactForm(), instantDate: "2025-06-30" }, undefined, BAL, doc)).toMatchObject({ conceptId: "", instantDate: "" });
  });
});

describe("validateFactForm", () => {
  const ok = { ...emptyFactForm(), conceptId: "balance.ending", value: "$83,421.17", currency: "USD", instantDate: "2025-06-30", accountId: "4" };
  it("accepts a good money form", () => expect(validateFactForm(ok, BAL)).toEqual([]));
  it("requires concept, value, dates", () => {
    expect(validateFactForm(emptyFactForm(), undefined)).toEqual(["Choose what kind of number this is.", "Enter the value."]);
    expect(validateFactForm({ ...ok, instantDate: "" }, BAL)).toEqual(["Date must be a date."]);
    expect(validateFactForm({ ...ok, periodStart: "2025-06-30", periodEnd: "2025-01-01" }, INT)).toEqual(["The end date is before the start date."]);
  });
  it("requires an account for account concepts and a person for person concepts", () => {
    expect(validateFactForm({ ...ok, accountId: "" }, BAL)).toEqual(["Choose the account this number belongs to."]);
    const WAGES: ConceptDto = { ...INT, id: "income.wages", subject: "person" };
    expect(validateFactForm({ ...ok, accountId: "", periodStart: "2025-01-01", periodEnd: "2025-12-31" }, WAGES)).toEqual(["Choose the person this number belongs to."]);
    expect(validateFactForm({ ...ok, accountId: "", personId: "2", periodStart: "2025-01-01", periodEnd: "2025-12-31" }, WAGES)).toEqual([]);
  });
  it("checks money against the currency, as text", () => {
    expect(validateFactForm({ ...ok, value: "12abc" }, BAL)).toHaveLength(1);
    expect(validateFactForm({ ...ok, value: "₪5.00" }, BAL)).toHaveLength(1);
    expect(validateFactForm({ ...ok, currency: "" }, BAL)).toEqual(["Choose a currency."]);
    expect(validateFactForm({ ...ok, value: "12345678901234567890.12" }, BAL)).toEqual([]);
  });
  it("does not parse non-money values", () => {
    expect(validateFactForm({ ...ok, value: "true", currency: "" }, FLAG)).toEqual([]);
  });
});

describe("request builders", () => {
  it("proposes money with currency, instant date, account and trimmed note", () => {
    const form = { ...emptyFactForm(), conceptId: BAL.id, value: " $83,421.17 ", currency: "USD", instantDate: "2025-06-30", periodStart: "x", accountId: "4", note: " n " };
    expect(buildProposeRequest(form, BAL, WHERE)).toEqual({
      documentId: 3,
      pageNo: 2,
      bbox: [1, 2, 3, 4],
      conceptId: "balance.ending",
      value: "$83,421.17",
      currency: "USD",
      instantDate: "2025-06-30",
      accountId: 4,
      note: "n",
    });
  });
  it("sends a period, no currency for non-money, omits empty optionals", () => {
    const form = { ...emptyFactForm(), conceptId: INT.id, value: "1,204.33", currency: "ILS", periodStart: "2025-01-01", periodEnd: "2025-12-31", instantDate: "stale" };
    expect(buildProposeRequest(form, INT, WHERE)).toEqual({
      documentId: 3, pageNo: 2, bbox: [1, 2, 3, 4], conceptId: "income.interest", value: "1,204.33", currency: "ILS", periodStart: "2025-01-01", periodEnd: "2025-12-31",
    });
    const flag = buildProposeRequest({ ...emptyFactForm(), value: "true", currency: "USD", instantDate: "2025-06-30" }, FLAG, WHERE);
    expect(flag).not.toHaveProperty("currency");
    expect(flag).not.toHaveProperty("accountId");
    expect(flag).not.toHaveProperty("note");
  });
  it("corrects with explicit null account and the verify flag", () => {
    const form = { ...emptyFactForm(), conceptId: BAL.id, value: "100.00", currency: "USD", instantDate: "2025-06-30" };
    expect(buildCorrectRequest(form, BAL, true)).toEqual({
      conceptId: "balance.ending", value: "100.00", currency: "USD", instantDate: "2025-06-30", accountId: null, personId: null, note: "", verify: true,
    });
    expect(buildCorrectRequest({ ...form, accountId: "9" }, BAL, false)).toMatchObject({ accountId: 9, verify: false });
  });
  it("builds attestations", () => {
    expect(buildAttestationRequest(7, { conceptId: "status.account_closed", date: "2025-06-30", periodStart: "", periodEnd: "", note: " Sarah says so " })).toEqual({
      conceptId: "status.account_closed", accountId: 7, value: "true", note: "Sarah says so", instantDate: "2025-06-30",
    });
    expect(buildAttestationRequest(7, { conceptId: "status.no_document_issued", date: "", periodStart: "2025-01-01", periodEnd: "2025-12-31", note: "n" })).toEqual({
      conceptId: "status.no_document_issued", accountId: 7, value: "true", note: "n", periodStart: "2025-01-01", periodEnd: "2025-12-31",
    });
  });
  it("validates attestations", () => {
    const base = { conceptId: "status.account_closed" as const, date: "2025-06-30", periodStart: "", periodEnd: "", note: "x" };
    expect(validateAttestation(base)).toEqual([]);
    expect(validateAttestation({ ...base, note: "  " })).toEqual(["Write who says so and why."]);
    expect(validateAttestation({ ...base, date: "" })).toHaveLength(1);
    expect(validateAttestation({ ...base, conceptId: "status.no_document_issued" })).toEqual(["Choose the period."]);
  });
});

describe("currency and existing facts", () => {
  it("defaults the currency from the account", () => {
    expect(defaultCurrency({ nativeCurrency: "ILS" })).toBe("ILS");
    expect(defaultCurrency(undefined)).toBe("USD");
    expect(defaultCurrency(undefined, "ILS")).toBe("ILS");
  });
  const fact = { valueMinor: "-4231855", currency: "ILS", formatted: "-₪42,318.55", conceptId: "balance.ending", accountId: 2, instantDate: "2025-06-30", periodStart: null, periodEnd: null, note: null } as unknown as FactDto;
  it("re-expresses money exactly, without Number", () => {
    expect(valueForForm(fact)).toBe("-42318.55");
    expect(valueForForm({ valueMinor: "900719925474099312", currency: "USD", formatted: "" })).toBe("9007199254740993.12");
    expect(valueForForm({ valueMinor: null, currency: null, formatted: "true" })).toBe("true");
  });
  it("builds a form from a fact", () => {
    expect(formFromFact({ ...fact, personId: null })).toEqual({ conceptId: "balance.ending", accountId: "2", personId: "", value: "-42318.55", currency: "ILS", instantDate: "2025-06-30", periodStart: "", periodEnd: "", note: "" });
  });
});

describe("mismatchWarning", () => {
  it("only warns on an explicit mismatch", () => {
    expect(mismatchWarning(true, "x")).toBeNull();
    expect(mismatchWarning(null, null)).toBeNull();
    expect(mismatchWarning(false, " $83,421.17 ")).toBe("The number you typed differs from the text in the box ($83,421.17).");
    expect(mismatchWarning(false, null)).toBe("The number you typed differs from the text in the box (no text found).");
  });
});
