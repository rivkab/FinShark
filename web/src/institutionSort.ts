// Sorting for the institutions table. Pure and unit-tested.
import type { InstitutionDto } from "@finshark/shared";

// Names can be Hebrew or English; compare by the user's locale with numbers in order.
const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

/** A sorted copy: by country, then name. Ties fall back to id, so the order is stable. */
export function sortInstitutions(institutions: readonly InstitutionDto[]): InstitutionDto[] {
  return [...institutions].sort(
    (x, y) => collator.compare(x.country, y.country) || collator.compare(x.name, y.name) || x.id - y.id,
  );
}
