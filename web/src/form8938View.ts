// Pure view logic for the Form 8938 page (DESIGN D21): wording, grouping, small form rules.
import type {
  FilingStatus,
  Form8938MaximumDto,
  Form8938ReasonDto,
  Form8938ReportDto,
  Form8938RowDto,
  Form8938TaxItemGroupDto,
  Form8938TaxItemsDto,
  Form8938Treatment,
  Form8938ValueDto,
  FbarTestVerdict,
  Us8938TermId,
} from "@finshark/shared";

export type ViewTone = "success" | "warning" | "danger" | "info";

export const FILING_STATUS_LABEL: Readonly<Record<FilingStatus, string>> = {
  married_joint: "Married filing jointly",
  married_separate: "Married filing separately",
  single: "Single",
  head_of_household: "Head of household",
  qualifying_surviving_spouse: "Qualifying surviving spouse",
};

export type ResidenceChoice = "unset" | "us" | "abroad";
export const RESIDENCE_LABEL: Readonly<Record<ResidenceChoice, string>> = {
  unset: "Not set",
  us: "Living in the US",
  abroad: "Living abroad: meets a presence-abroad test",
};
export const residenceToChoice = (abroad: boolean | null): ResidenceChoice => (abroad === null ? "unset" : abroad ? "abroad" : "us");
export const choiceToResidence = (c: ResidenceChoice): boolean | null => (c === "unset" ? null : c === "abroad");

export const TREATMENT_LABEL: Readonly<Record<Form8938Treatment, string>> = {
  financial_account: "Financial account",
  pension_plan: "Pension or deferred compensation plan",
  ask_preparer: "Ask the preparer",
  not_classified: "Not classified",
};

export const TERM_LABEL: Readonly<Record<Us8938TermId, string>> = {
  "us_8938/financial_account": "Financial account (deposit or custodial)",
  "us_8938/pension_plan": "Pension or deferred compensation plan",
  "us_8938/not_reportable": "Not reportable",
  "us_8938/ask_preparer": "Ask the preparer",
};

export const termForTreatment = (t: Form8938Treatment): Us8938TermId | null =>
  t === "not_classified" ? null : (`us_8938/${t}` as Us8938TermId);

export const needsReason = (termId: Us8938TermId): boolean => termId === "us_8938/not_reportable";

/** Null when the choice can be saved; otherwise what is missing. */
export function classificationProblem(termId: Us8938TermId | null, reason: string): string | null {
  if (termId === null) return "Choose how the form treats this account.";
  if (needsReason(termId) && reason.trim() === "") return "Say why this account is not reportable.";
  return null;
}

export const classificationBody = (year: number, termId: Us8938TermId, reason: string) => ({
  year,
  termId,
  reason: needsReason(termId) ? reason.trim() : null,
});

export const needsClassifying = (x: Pick<Form8938RowDto, "treatment">): boolean => x.treatment === "not_classified" || x.treatment === "ask_preparer";

export const TEST_LABEL: Readonly<Record<FbarTestVerdict, string>> = {
  EXCEEDED: "over",
  NOT_EXCEEDED: "not over",
  UNDETERMINED: "can't tell yet",
};

export function appliedText(r: Pick<Form8938ReportDto, "applied" | "year">): string {
  switch (r.applied) {
    case "us": return "Thresholds for people living in the US (married filing jointly).";
    case "abroad": return "Thresholds for people living abroad (married filing jointly).";
    case "both": return "Residence is not set for this year, so both threshold rows were tested.";
  }
}

export interface VerdictView {
  tone: ViewTone;
  headline: string;
  detail: string;
}

export function verdictView(r: Pick<Form8938ReportDto, "verdict" | "year" | "status">): VerdictView {
  const open = r.status === "COMPLETE" ? "" : " Some data is still missing, which can only raise the figures.";
  switch (r.verdict) {
    case "REQUIRED":
      return { tone: "warning", headline: `Form 8938 is required for ${r.year}.`, detail: `The foreign accounts counted so far are over the filing threshold.${open}` };
    case "NOT_REQUIRED":
      return { tone: "success", headline: `Form 8938 is not required for ${r.year}.`, detail: "Even counting every undecided account, nothing is over the threshold, and every value is known." };
    case "DEPENDS_ON_RULE":
      return { tone: "warning", headline: "Whether Form 8938 is required depends on a choice that isn't settled.", detail: "Take this to your preparer. Filing is the safe choice." };
    case "UNDETERMINED":
      return { tone: "warning", headline: "Can't tell yet whether Form 8938 is required.", detail: "See the reasons below." };
    case "NO_FOREIGN_ACCOUNTS":
      return { tone: "info", headline: "There are no foreign accounts.", detail: "An account counts as foreign when its country isn't the US." };
  }
}

export interface ReasonView {
  text: string;
  accountIds: number[];
}

const FILING_NOT_SUPPORTED = (s: FilingStatus | null) =>
  s === null
    ? "No filing status is set for this year. Set it above; only married filing jointly is supported."
    : `The filing status is "${FILING_STATUS_LABEL[s]}". FinShark only supports married filing jointly, because the rules for jointly owned accounts differ.`;

export function reasonView(reason: Form8938ReasonDto): ReasonView {
  switch (reason.code) {
    case "unsupported_filing_status": return { text: FILING_NOT_SUPPORTED(reason.filingStatus), accountIds: [] };
    case "residence_not_set": return { text: "Residence isn't set for this year, so both the US and the abroad thresholds apply. Set it above.", accountIds: [] };
    case "missing_values": return { text: "These accounts have a maximum or year-end value that isn't recorded, or isn't verified.", accountIds: reason.accountIds };
    case "missing_rate": return { text: `No Treasury exchange rate for 31 December is recorded for ${reason.currencies.join(", ")}, so these accounts can't be converted to USD.`, accountIds: reason.accountIds };
    case "conflicting_values": return { text: "These accounts have conflicting values. Resolve them on the account page.", accountIds: reason.accountIds };
    case "ask_preparer_accounts": return { text: "These accounts are marked \"ask the preparer\". Decide how the form treats them.", accountIds: reason.accountIds };
    case "not_classified_accounts": return { text: "These accounts haven't been classified for Form 8938. Choose how the form treats each one.", accountIds: reason.accountIds };
    case "sum_of_maxima_only": return { text: "Only the \"highest balances added up\" reading is over the at-any-time threshold, and no single date is. The form's wording doesn't say which reading to use.", accountIds: [] };
    case "unresolved_accounts_push_over": return { text: "The total is over the threshold only when the undecided accounts are counted.", accountIds: [] };
  }
}

export const reasonViews = (r: Pick<Form8938ReportDto, "reasons">): ReasonView[] => r.reasons.map(reasonView);

export interface RowGroups {
  counted: Form8938RowDto[];
  undecided: Form8938RowDto[];
}
export function groupRows(rows: readonly Form8938RowDto[]): RowGroups {
  return { counted: rows.filter((x) => x.counted), undecided: rows.filter((x) => !x.counted) };
}

export type SourceNote = { text: string; tone: "muted" | "warning" | "danger" } | null;

export function valueNote(v: Form8938ValueDto): SourceNote {
  switch (v.source) {
    case "closing_date": return { text: "from closing date", tone: "muted" };
    case "missing": return { text: "not recorded", tone: "warning" };
    case "conflict": return { text: "conflicting values", tone: "danger" };
    case "year_end_balance":
    case "balances": return v.status === "COMPLETE" ? null : { text: v.status === "CONFLICT" ? "conflicting values" : "incomplete", tone: v.status === "CONFLICT" ? "danger" : "warning" };
  }
}

export function maximumNotes(m: Form8938MaximumDto): { text: string; tone: "muted" | "warning" | "danger" }[] {
  const out: { text: string; tone: "muted" | "warning" | "danger" }[] = [];
  const n = valueNote(m);
  if (n) out.push(n);
  if (m.approximation) out.push({ text: "highest statement balance; the true peak may be higher", tone: "muted" });
  if (m.missingDates.length > 0) out.push({ text: `no balance for ${m.missingDates.length} expected date${m.missingDates.length === 1 ? "" : "s"}`, tone: "warning" });
  if (!m.coverageKnown) out.push({ text: "statement cadence not set, so gaps can't be checked", tone: "warning" });
  if (m.conflicts.length > 0) out.push({ text: `${m.conflicts.length} date${m.conflicts.length === 1 ? "" : "s"} with conflicting balances`, tone: "danger" });
  return out;
}

export function ownersHint(owners: readonly { displayName: string }[]): string {
  if (owners.length === 0) return "No owner recorded.";
  if (owners.length === 1) return `${owners[0]!.displayName} only.`;
  return `${owners.map((o) => o.displayName).join(", ")}. If one is the spouse, tick "jointly owned with spouse".`;
}

const CONCEPT_LABEL: Record<string, string> = {
  "income.interest": "Interest",
  "income.dividends": "Dividends",
  "income.dividend": "Dividends",
};
export const taxConceptLabel = (id: string): string => CONCEPT_LABEL[id] ?? id;

export interface GroupView {
  label: string;
  total: string | null;
  totalNote: string | null;
  problems: string[];
}

const range = (a: { start: string; end: string }) => `${a.start} to ${a.end}`;

export function taxGroupView(g: Form8938TaxItemGroupDto): GroupView {
  const problems: string[] = [];
  const disagree = g.periods.filter((p) => p.disagreeing !== null).length;
  if (disagree > 0) problems.push(`Verified facts disagree for ${disagree} period${disagree === 1 ? "" : "s"}.`);
  if (g.overlaps.length > 0) problems.push(`Periods overlap: ${g.overlaps.map((o) => `${range(o.a)} and ${range(o.b)}`).join("; ")}.`);
  if (g.gaps.length > 0) problems.push(`Not covered: ${g.gaps.map(range).join("; ")}.`);
  const totalNote = g.total === null ? "no total: periods overlap or disagree" : g.complete ? null : "a minimum: some of the year isn't covered";
  return { label: taxConceptLabel(g.genericConceptId), total: g.total?.formatted ?? null, totalNote, problems };
}

export const EXCLUDED_LABEL: Readonly<Record<Form8938TaxItemsDto["excluded"][number]["reason"], string>> = {
  unverified: "not verified",
  no_amount: "no amount",
  other_currency: "other currency",
  straddles_year: "period crosses the year boundary",
  bad_period: "invalid period",
};

export function excludedSummary(t: Form8938TaxItemsDto): string | null {
  if (t.excluded.length === 0) return null;
  const why = [...new Set(t.excluded.map((e) => EXCLUDED_LABEL[e.reason]))].join(", ");
  return `${t.excluded.length} tax item${t.excluded.length === 1 ? "" : "s"} not used (${why}).`;
}
