import { describe, expect, it } from "vitest";
import type { Form8938ValueDto, Form8938MaximumDto, Form8938RowDto, Form8938TaxItemGroupDto } from "@finshark/shared";
import {
  choiceToResidence, classificationBody, classificationProblem, excludedSummary, groupRows, maximumNotes, ownersHint,
  reasonView, residenceToChoice, taxGroupView, termForTreatment, valueNote, verdictView, appliedText,
} from "./form8938View.ts";

const money = (s: string) => ({ minor: "0", currency: "USD", formatted: s });

describe("form8938View", () => {
  it("round-trips residence", () => {
    for (const v of [null, true, false]) expect(choiceToResidence(residenceToChoice(v))).toBe(v);
  });
  it("needs a reason only for not reportable", () => {
    expect(classificationProblem(null, "")).not.toBeNull();
    expect(classificationProblem("us_8938/not_reportable", "  ")).not.toBeNull();
    expect(classificationProblem("us_8938/not_reportable", "closed")).toBeNull();
    expect(classificationProblem("us_8938/pension_plan", "")).toBeNull();
    expect(classificationBody(2025, "us_8938/pension_plan", "junk")).toEqual({ year: 2025, termId: "us_8938/pension_plan", reason: null });
    expect(classificationBody(2025, "us_8938/not_reportable", " x ").reason).toBe("x");
  });
  it("maps treatment to term", () => {
    expect(termForTreatment("not_classified")).toBeNull();
    expect(termForTreatment("pension_plan")).toBe("us_8938/pension_plan");
  });
  it("words each verdict and warns about missing data", () => {
    expect(verdictView({ verdict: "REQUIRED", year: 2025, status: "INCOMPLETE" }).detail).toContain("missing");
    expect(verdictView({ verdict: "REQUIRED", year: 2025, status: "COMPLETE" }).detail).not.toContain("missing");
    expect(verdictView({ verdict: "NOT_REQUIRED", year: 2025, status: "COMPLETE" }).tone).toBe("success");
    expect(verdictView({ verdict: "UNDETERMINED", year: 2025, status: "COMPLETE" }).tone).toBe("warning");
  });
  it("says both rows were tested when residence is unset", () => {
    expect(appliedText({ applied: "both", year: 2025 })).toContain("both");
  });
  it("explains reasons with their accounts", () => {
    expect(reasonView({ code: "missing_rate", accountIds: [3], currencies: ["ILS"] })).toMatchObject({ accountIds: [3] });
    expect(reasonView({ code: "missing_rate", accountIds: [3], currencies: ["ILS"] }).text).toContain("ILS");
    expect(reasonView({ code: "unsupported_filing_status", filingStatus: "single" }).text).toContain("Single");
    expect(reasonView({ code: "unsupported_filing_status", filingStatus: null }).text).toContain("No filing status");
    expect(reasonView({ code: "residence_not_set" }).accountIds).toEqual([]);
  });
  it("groups rows", () => {
    const rows = [{ accountId: 1, counted: true }, { accountId: 2, counted: false }] as Form8938RowDto[];
    const g = groupRows(rows);
    expect(g.counted.map((x) => x.accountId)).toEqual([1]);
    expect(g.undecided.map((x) => x.accountId)).toEqual([2]);
  });
  const val: Form8938ValueDto = { native: null, usd: null, source: "balances", date: null, factIds: [], status: "COMPLETE" };
  it("notes value sources", () => {
    expect(valueNote({ ...val })).toBeNull();
    expect(valueNote({ ...val, source: "closing_date" })?.text).toBe("from closing date");
    expect(valueNote({ ...val, source: "missing", status: "INCOMPLETE" })?.tone).toBe("warning");
    expect(valueNote({ ...val, source: "conflict", status: "CONFLICT" })?.tone).toBe("danger");
  });
  it("lists maximum notes", () => {
    const m: Form8938MaximumDto = { ...val, approximation: true, missingDates: ["2025-03-31"], coverageKnown: false, conflicts: [{ date: "2025-06-30", values: [] }] };
    const t = maximumNotes(m).map((n) => n.text).join("|");
    expect(t).toContain("true peak");
    expect(t).toContain("1 expected date");
    expect(t).toContain("cadence");
    expect(t).toContain("conflicting");
  });
  it("hints at joint ownership", () => {
    expect(ownersHint([])).toContain("No owner");
    expect(ownersHint([{ displayName: "A" }])).toBe("A only.");
    expect(ownersHint([{ displayName: "A" }, { displayName: "B" }])).toContain("jointly owned");
  });
  it("surfaces tax item gaps, overlaps and disagreement", () => {
    const g = {
      genericConceptId: "income.interest", currency: "ILS", complete: false, total: null, factIds: [],
      periods: [{ periodStart: "a", periodEnd: "b", value: null, conceptIds: [], factIds: [], disagreeing: [] }],
      gaps: [{ start: "2025-01-01", end: "2025-03-31" }],
      overlaps: [{ a: { start: "x", end: "y" }, b: { start: "y", end: "z" } }],
    } as Form8938TaxItemGroupDto;
    const v = taxGroupView(g);
    expect(v.label).toBe("Interest");
    expect(v.problems).toHaveLength(3);
    expect(v.total).toBeNull();
    const ok = taxGroupView({ ...g, total: money("$5"), complete: true, gaps: [], overlaps: [], periods: [] });
    expect(ok.totalNote).toBeNull();
    expect(taxGroupView({ ...g, total: money("$5"), overlaps: [], periods: [] }).totalNote).toContain("minimum");
  });
  it("summarises excluded tax items", () => {
    expect(excludedSummary({ groups: [], noTaxItems: false, excluded: [] })).toBeNull();
    expect(excludedSummary({ groups: [], noTaxItems: false, excluded: [{ factId: 1, genericConceptId: "x", reason: "unverified" }] })).toContain("not verified");
  });
});
