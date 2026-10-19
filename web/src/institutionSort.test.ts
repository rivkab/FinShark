import { describe, expect, it } from "vitest";
import type { InstitutionDto } from "@finshark/shared";
import { sortInstitutions } from "./institutionSort.ts";

const inst = (id: number, name: string, country: string) => ({ id, name, country }) as InstitutionDto;

describe("sortInstitutions", () => {
  it("sorts by country, then alphabetically by name", () => {
    const out = sortInstitutions([inst(1, "Zeta Bank", "IL"), inst(2, "beta Fund", "US"), inst(3, "Alpha Bank", "US"), inst(4, "Mizrahi", "IL")]);
    expect(out.map((i) => i.id)).toEqual([4, 1, 3, 2]);
  });
  it("breaks full ties by id and does not mutate the input", () => {
    const input = [inst(9, "Same", "US"), inst(2, "Same", "US")];
    expect(sortInstitutions(input).map((i) => i.id)).toEqual([2, 9]);
    expect(input.map((i) => i.id)).toEqual([9, 2]);
  });
});
