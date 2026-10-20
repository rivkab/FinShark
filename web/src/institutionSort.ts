// Sorting for the institutions table. Pure and unit-tested.
import { INSTITUTION_KINDS, type InstitutionDto } from "@finshark/shared";

// Names can be Hebrew or English; compare by the user's locale with numbers in order.
const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

/** Position of a kind in INSTITUTION_KINDS; institutions with no kind sort last. */
function kindRank(i: Pick<InstitutionDto, "kind">): number {
  return i.kind === null || i.kind === undefined ? INSTITUTION_KINDS.length : INSTITUTION_KINDS.indexOf(i.kind);
}

/** A sorted copy: by kind (financial, employer, not set), then country, then name. Ties fall back to id, so the order is stable. */
export function sortInstitutions(institutions: readonly InstitutionDto[]): InstitutionDto[] {
  return [...institutions].sort(
    (x, y) => kindRank(x) - kindRank(y) || collator.compare(x.country, y.country) || collator.compare(x.name, y.name) || x.id - y.id,
  );
}
