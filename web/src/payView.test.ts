import { describe, expect, it } from "vitest";
import type { ConceptDto, DocumentDto, FactDto, InstitutionDto } from "@finshark/shared";
import { payColumn, payView } from "./payView.ts";

const concepts = [
  { id: "income.wages", genericConceptId: null, subject: "person" },
  { id: "us.w2.box1_wages", genericConceptId: "income.wages", subject: "person" },
  { id: "tax.withheld.us_federal", genericConceptId: null, subject: "person" },
  { id: "us.w2.box2_fed_withheld", genericConceptId: "tax.withheld.us_federal", subject: "person" },
  { id: "balance.ending", genericConceptId: null, subject: "account" },
] as ConceptDto[];

const institutions = [
  { id: 1, name: "Acme", altName: null, kind: "employer" },
  { id: 2, name: "Big Bank", altName: null, kind: "financial" },
  { id: 3, name: "Zeta", altName: null, kind: "employer" },
] as InstitutionDto[];

const doc = (id: number, institutionId: number | null) => ({ id, institutionId }) as DocumentDto;
const documents = [doc(10, 1), doc(11, 2), doc(12, null), doc(13, 3)];
const typed = (id: number, docType: string) => ({ id, institutionId: 1, docType }) as DocumentDto;
const people = [{ id: 1, displayName: "Dana" }, { id: 2, displayName: "Avi" }];

const fact = (id: number, over: Partial<FactDto> = {}): FactDto =>
  ({
    id,
    conceptId: "us.w2.box1_wages",
    conceptLabelEn: "W-2 wages",
    personId: 1,
    personName: "Dana",
    valueMinor: "9000000",
    currency: "USD",
    formatted: "$90,000.00",
    periodStart: "2025-01-01",
    periodEnd: "2025-12-31",
    instantDate: null,
    taxYear: 2025,
    status: "verified",
    sources: [{ id: id, documentId: 10, documentName: "w2.pdf", pageNo: 1, bbox: [0, 0, 1, 1], quotedText: null }],
    ...over,
  }) as FactDto;

const view = (facts: FactDto[]) => payView(facts, concepts, documents, institutions, people);

describe("payColumn", () => {
  it("maps via the generic concept", () => {
    expect(payColumn("us.w2.box1_wages", concepts)).toBe("wages");
    expect(payColumn("us.w2.box2_fed_withheld", concepts)).toBe("withheld");
    expect(payColumn("balance.ending", concepts)).toBeNull();
  });
});

describe("payView", () => {
  it("puts wages and withholding of one employer and period on one row, linked to the box", () => {
    const v = view([fact(1), fact(2, { conceptId: "us.w2.box2_fed_withheld", valueMinor: "1000", formatted: "$10.00" })]);
    expect(v.notShown).toEqual([]);
    const emp = v.people[0]!.years[0]!.employers;
    expect(emp).toHaveLength(1);
    expect(emp[0]!.employer?.name).toBe("Acme");
    const row = emp[0]!.rows[0]!;
    expect(row.kind).toBe("annual");
    expect(row.wages.map((x) => [x.factId, x.formatted, x.href, x.conflict])).toEqual([[1, "$90,000.00", "#/documents/10?fact=1", false]]);
    expect(row.withheld.map((x) => x.formatted)).toEqual(["$10.00"]);
  });

  it("keeps annual and period values separate and never sums", () => {
    const slip = fact(3, { conceptId: "income.wages", periodStart: "2025-01-01", periodEnd: "2025-01-31", valueMinor: "700000", formatted: "$7,000.00" });
    const slip2 = fact(4, { conceptId: "income.wages", periodStart: "2025-02-01", periodEnd: "2025-02-28", valueMinor: "700000", formatted: "$7,000.00" });
    const rows = view([slip2, slip, fact(1)]).people[0]!.years[0]!.employers[0]!.rows;
    expect(rows.map((r) => [r.kind, r.periodStart])).toEqual([["annual", "2025-01-01"], ["period", "2025-01-01"], ["period", "2025-02-01"]]);
    expect(rows.flatMap((r) => r.wages.map((w) => w.formatted))).toEqual(["$90,000.00", "$7,000.00", "$7,000.00"]);
  });

  it("takes annual or payslip from the document type when the kind of number doesn't say", () => {
    const docs = [...documents, typed(20, "doc_type/tax_form"), typed(21, "doc_type/pay_stub"), typed(22, "doc_type/other")];
    const src = (documentId: number) => [{ documentId, documentName: "d", pageNo: 1 }] as FactDto["sources"];
    const v = payView(
      [
        fact(1, { conceptId: "income.wages", sources: src(20) }),
        fact(2, { conceptId: "income.wages", periodStart: "2025-01-01", periodEnd: "2025-01-31", sources: src(21) }),
        fact(3, { conceptId: "income.wages", periodStart: "2025-02-01", periodEnd: "2025-02-28", sources: src(22) }),
      ],
      concepts, docs, institutions, people,
    );
    const rows = v.people[0]!.years[0]!.employers[0]!.rows;
    expect(rows.map((r) => [r.kind, r.wages[0]!.factId])).toEqual([["annual", 1], ["payslip", 2], ["period", 3]]);
  });

  it("groups by person, years newest first", () => {
    const v = view([
      fact(1),
      fact(2, { periodStart: "2024-01-01", periodEnd: "2024-12-31", taxYear: 2024 }),
      fact(3, { personId: 2, personName: "Avi" }),
    ]);
    expect(v.people.map((p) => p.personName)).toEqual(["Avi", "Dana"]);
    expect(v.people[1]!.years.map((y) => y.year)).toEqual([2025, 2024]);
  });

  it("shows 'no employer' when the document has none or a non-employer institution, never guessing", () => {
    const v = view([
      fact(1, { sources: [{ documentId: 11, documentName: "b", pageNo: 1 }] as FactDto["sources"] }),
      fact(2, { conceptId: "us.w2.box2_fed_withheld", sources: [{ documentId: 12, documentName: "c", pageNo: 1 }] as FactDto["sources"] }),
      fact(3, { conceptId: "tax.withheld.us_federal", sources: [] }),
      fact(4, { sources: [{ documentId: 13, documentName: "z", pageNo: 1 }] as FactDto["sources"] }),
    ]);
    const emp = v.people[0]!.years[0]!.employers;
    expect(emp.map((e) => e.employer?.name ?? null)).toEqual(["Zeta", null]);
    expect(emp[1]!.rows.flatMap((r) => [...r.wages, ...r.withheld]).map((x) => x.factId).sort()).toEqual([1, 2, 3]);
  });

  it("does not pick an employer when a fact's sources point at different employers", () => {
    const two = [
      { id: 1, documentId: 13, documentName: "z", pageNo: 1 },
      { id: 2, documentId: 10, documentName: "a", pageNo: 1 },
    ] as FactDto["sources"];
    const v = view([fact(1, { sources: two }), fact(2)]);
    const emp = v.people[0]!.years[0]!.employers;
    expect(emp.map((e) => [e.employer?.name ?? null, e.unclear.map((i) => i.name)])).toEqual([["Acme", []], [null, ["Acme", "Zeta"]]]);
    expect(emp[1]!.rows[0]!.wages.map((x) => x.factId)).toEqual([1]);
  });

  it("marks proposed facts as conflicts linking to the fact page; attested facts link to the fact", () => {
    const v = view([fact(1, { status: "proposed" }), fact(2, { conceptId: "income.wages", periodStart: "2025-03-01", periodEnd: "2025-03-31", sources: [] })]);
    const rows = v.people[0]!.years[0]!.employers.flatMap((e) => e.rows);
    const w2 = rows.find((r) => r.kind === "annual")!.wages[0]!;
    expect([w2.conflict, w2.href]).toEqual([true, "#/facts/1"]);
    const attested = rows.find((r) => r.kind === "period")!.wages[0]!;
    expect([attested.conflict, attested.href, attested.sourceName]).toEqual([false, "#/facts/2", null]);
  });

  it("lists values without an exact amount, year or person under notShown", () => {
    const v = view([
      fact(1, { valueMinor: null, formatted: "n/a" }),
      fact(2, { currency: null }),
      fact(3, { periodStart: null, periodEnd: null, taxYear: null }),
      fact(4, { personId: null, personName: null }),
      fact(5),
    ]);
    expect(v.notShown.map((n) => [n.factId, n.reason])).toEqual([
      [1, "No exact amount"],
      [2, "No exact amount"],
      [3, "No year"],
      [4, "No person"],
    ]);
    expect(v.people[0]!.years[0]!.employers[0]!.rows[0]!.wages.map((x) => x.factId)).toEqual([5]);
  });

  it("uses current person facts only", () => {
    const v = view([
      fact(1, { status: "rejected" }),
      fact(2, { status: "superseded" }),
      fact(3, { conceptId: "balance.ending", personId: null }),
    ]);
    expect(v).toEqual({ people: [], notShown: [] });
  });

  it("lists a person-level concept with no column under notShown instead of dropping it", () => {
    const v = payView([fact(1, { conceptId: "income.bonus" })], [...concepts, { id: "income.bonus", genericConceptId: null, subject: "person" } as ConceptDto], documents, institutions, people);
    expect(v.notShown.map((n) => [n.factId, n.reason])).toEqual([[1, "Not wages or tax withheld"]]);
    expect(v.people).toEqual([]);
  });
});
