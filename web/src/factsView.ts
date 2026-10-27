import type { FactDto } from "@finshark/shared";

/**
 * The facts list's default view: current facts only (verified, plus proposed ones that conflict
 * with a verified value). Deleted (rejected) and replaced (superseded) facts show only when asked.
 */
export function visibleFacts(facts: FactDto[], showRemoved: boolean): FactDto[] {
  return showRemoved ? facts : facts.filter((f) => f.status === "verified" || f.status === "proposed");
}
