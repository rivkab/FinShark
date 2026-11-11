// Request/response types of the HTTP API (JSON). Shared by the server routes and the web client.
//
// Conventions
//  * Ids are JSON numbers, except the session's personId which is a string (see /api/session).
//  * Money (bigint minor units) travels as a decimal string ("8342117") plus a `formatted`
//    display string ("$83,421.17"). Never parse these with Number.
//  * Dates are ISO "YYYY-MM-DD" strings, timestamps ISO-8601 UTC.
//  * Errors are `ApiErrorBody` with HTTP 400 (bad input), 404 (not found), 409 (state/conflict).
//  * Every mutation except POST /api/people, PUT /api/people/:id/roles, PUT /api/people/:id/name
//    and POST /api/session/person needs a chosen person (409 `choose_person` otherwise) and the CSRF header.
//
// Endpoints (all under the security hooks; JSON unless noted)
//   GET  /api/people                         -> { people: PersonDto[] }
//   POST /api/people          CreatePersonRequest        -> 201 PersonDto
//   PUT  /api/people/:id/roles               SetPersonRolesRequest -> PersonDto
//   PUT  /api/people/:id/name                RenamePersonRequest -> PersonDto
//   GET  /api/institutions                   -> { institutions: InstitutionDto[] }
//   POST /api/institutions    CreateInstitutionRequest   -> 201 InstitutionDto
//   PUT  /api/institutions/:id/kind          SetInstitutionKindRequest -> InstitutionDto
//   GET  /api/accounts                       -> { accounts: AccountDto[] }
//   POST /api/accounts        CreateAccountRequest       -> 201 AccountDto
//   POST /api/accounts/:id/identifiers  AddIdentifierRequest -> 201 AccountDto
//   PUT  /api/accounts/:id/notes           SetAccountNotesRequest -> AccountDto
//   PUT  /api/accounts/:id/type            SetAccountTypeRequest -> AccountDto
//   PUT  /api/accounts/:id/cadence         SetAccountCadenceRequest -> AccountDto
//   PUT  /api/accounts/:id/name            SetAccountNameRequest -> AccountDto
//   PUT  /api/accounts/:id/account-number  SetAccountNumberRequest -> AccountDto
//   PUT  /api/accounts/:id/owners           SetAccountOwnersRequest -> AccountDto
//   GET  /api/concepts                       -> { concepts: ConceptDto[] }
//   GET  /api/terms                          -> { taxonomies: TaxonomyDto[] }
//   POST /api/documents       raw application/pdf body, header X-Filename (URI-encoded),
//                             optional query: institutionId, language, docType, identityKey,
//                             issuedOn, periodStart, periodEnd, taxYear
//                                                   -> 201 UploadImportedResponse | 200 UploadDuplicateResponse
//   GET  /api/documents                      -> { documents: DocumentDto[] }
//   GET  /api/documents/:id                  -> DocumentDetailDto
//   GET  /api/documents/:id/file             -> application/pdf bytes
//   GET  /api/documents/:id/text-layer       -> TextLayerDto
//   PATCH /api/documents/:id  UpdateDocumentRequest      -> DocumentDetailDto
//   POST /api/documents/:id/accounts  { accountId }      -> DocumentDetailDto
//   POST /api/facts           ProposeFactRequest         -> 201 ProposeFactResponse
//   POST /api/attestations    AttestationRequest         -> 201 { fact: FactDto }
//   GET  /api/review-queue                   -> { items: FactDto[] }   (proposed facts, oldest first)
//   GET  /api/facts?status=&concept=&account=&person=&document=  -> { facts: FactDto[] }
//   GET  /api/facts/:id                      -> FactDetailDto
//   POST /api/facts/:id/verify               -> { fact } | 409 conflict (details: ConflictDetails)
//   POST /api/facts/:id/correct  CorrectFactRequest      -> 201 { fact, superseded } | 409 conflict
//   POST /api/facts/:id/reject   { reason }              -> { fact }
//   POST /api/facts/:id/reopen                           -> { fact }
//   POST /api/exchange-rates/import  raw text/csv body (US Treasury Reporting Rates of Exchange),
//                             optional query: note            -> 201 ImportRatesResponse
//   GET  /api/exchange-rates                 -> { rates: ExchangeRateDto[] }
//   GET  /api/fbar?year=YYYY                 -> FbarReportDto   (year defaults to the previous calendar year)
//   GET  /api/form8938?year=YYYY             -> Form8938ReportDto   (year defaults to the previous calendar year)
//   GET  /api/tax-years/:year                -> TaxYearDto   (a year with no row returns nulls)
//   PUT  /api/tax-years/:year  SetTaxYearRequest         -> TaxYearDto
//   PUT  /api/accounts/:id/us-8938  SetUs8938Request     -> Us8938ClassificationDto | null (classification for that year)
//   GET  /api/backups                      -> BackupStatusDto
//   POST /api/backups                        -> 201 BackupFileDto   (back up now; waits for it)
//   POST /api/backups/:name/verify           -> BackupFileDto
//   POST /api/backups/setup   BackupSetupRequest         -> 201 BackupSetupResponse (the only call that returns the private key)
//   POST /api/backups/setup/confirm  BackupConfirmRequest -> BackupStatusDto
//   POST /api/backups/key     BackupImportKeyRequest     -> BackupStatusDto   (use this vault's key on this Mac)
//   PUT  /api/backups/second-folder  BackupSecondFolderRequest -> BackupStatusDto
//   POST /api/backups/second-folder/choose   -> BackupStatusDto   (opens the macOS folder chooser; unchanged if cancelled)
//   GET  /api/session / POST /api/session/person         (see server/src/http/app.ts)

import type { PdfRect } from "./pdf-geometry.ts";

export type ApiErrorCode =
  | "bad_request"
  | "not_found"
  | "choose_person"
  | "conflict"
  | "bad_state"
  | "deprecated_concept"
  | "unsupported_media_type"
  | "payload_too_large"
  | "not_a_pdf"
  | "file_missing"
  | "internal";

export interface ApiErrorBody {
  error: ApiErrorCode | string;
  message: string;
  details?: unknown;
}

export type Language = "en" | "he";
export type FactStatus = "proposed" | "verified" | "rejected" | "superseded";
export type FactOrigin = "parser" | "manual" | "user_correction" | "attestation" | "derived" | "ai_suggestion";
export type PeriodType = "instant" | "duration" | "none";
export type ValueType = "money" | "decimal" | "integer" | "text" | "date" | "boolean";
export type DocumentStatus = "inbox" | "reviewed" | "removed";

// ---------------------------------------------------------------- people, institutions, accounts

export interface PersonDto {
  id: number;
  displayName: string;
  /** Can be an account owner, or the subject of a person-level fact. */
  ownsAccounts: boolean;
  /** Can be chosen as the person using FinShark, and so appears in history. */
  usesApp: boolean;
}
export interface CreatePersonRequest {
  displayName: string;
  /** Default true. At least one of the two must be true. */
  ownsAccounts?: boolean;
  usesApp?: boolean;
}
export interface RenamePersonRequest {
  /** Trimmed; unique among people, ignoring case. */
  displayName: string;
}
export interface SetPersonRolesRequest {
  ownsAccounts: boolean;
  usesApp: boolean;
}

/** A financial institution holds accounts (bank, broker, fund, insurer); an employer issues pay documents. */
export const INSTITUTION_KINDS = ["financial", "employer"] as const;
export type InstitutionKind = (typeof INSTITUTION_KINDS)[number];

export interface InstitutionDto {
  id: number;
  name: string;
  altName: string | null;
  country: string;
  language: Language;
  /** Null for institutions created before kinds existed. */
  kind: InstitutionKind | null;
}
export interface SetInstitutionKindRequest {
  kind: InstitutionKind | null;
}
export interface CreateInstitutionRequest {
  name: string;
  country: string;
  kind?: InstitutionKind;
  altName?: string;
  /** Default from country (IL -> he, otherwise en). */
  language?: Language;
}

export interface AccountIdentifierDto {
  id: number;
  kind: string;
  value: string;
  validFrom: string | null;
  validTo: string | null;
}
export type AccountOwnerRole = "owner" | "joint" | "custodian" | "beneficiary" | "participant";
export interface AccountOwnerDto {
  personId: number;
  role: AccountOwnerRole;
  /** Decimal fraction like '0.5'; null when unspecified. */
  share: string | null;
}
/**
 * What kind of product an account is. A descriptive label only: whether something
 * counts as retirement savings, or how it is taxed, is a classification (DESIGN C5).
 */
export const ACCOUNT_TYPES = [
  "checking",
  "savings",
  "deposit",
  "investment",
  "pension",
  "provident_fund",
  "keren_hishtalmut",
  "credit_card",
  "loan",
  "mortgage",
  "insurance",
  "other",
] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export interface AccountDto {
  id: number;
  institutionId: number;
  institutionName: string;
  displayName: string;
  altName: string | null;
  country: string;
  language: Language;
  nativeCurrency: string;
  openedOn: string | null;
  closedOn: string | null;
  statementCadence: string | null;
  /** null for accounts created before types existed. */
  accountType: AccountType | null;
  /** Free text written by a person; null when there is none. */
  notes: string | null;
  /** The current account number (identifier kind 'account_number'), or null. */
  accountNumber: string | null;
  /** All identifiers, including past account numbers with their validity dates. */
  identifiers: AccountIdentifierDto[];
  /** Current owners (not ended). Empty only for accounts created before owners were required. */
  owners: AccountOwnerDto[];
}
/** Owners as given in requests; role defaults to 'owner', share to unspecified. */
export interface AccountOwnerInput {
  personId: number;
  role?: AccountOwnerRole;
  share?: string | null;
}
export interface CreateAccountRequest {
  institutionId: number;
  displayName: string;
  nativeCurrency: string;
  altName?: string;
  /** Default: the institution's. */
  country?: string;
  /** Default: the institution's. */
  language?: Language;
  openedOn?: string;
  closedOn?: string;
  statementCadence?: "monthly" | "quarterly" | "semiannual" | "annual" | "irregular";
  accountNumber?: string;
  accountType?: AccountType;
  notes?: string;
  /** At least one. */
  owners: AccountOwnerInput[];
}
/** Replaces the current owners (at least one). Owners removed keep their history. */
export interface SetAccountOwnersRequest {
  owners: AccountOwnerInput[];
}
/**
 * Renames the account. Documents and facts refer to the account by id, so nothing else changes.
 * altName (the name in the other language): omitted keeps it, null or blank clears it.
 */
export interface SetAccountNameRequest {
  displayName: string;
  altName?: string | null;
}
/** Blank or null clears the notes. At most 2000 characters. */
export interface SetAccountNotesRequest {
  notes: string | null;
}
/** null clears the type. */
export interface SetAccountTypeRequest {
  accountType: AccountType | null;
}
/** null clears the cadence. */
export interface SetAccountCadenceRequest {
  statementCadence: "monthly" | "quarterly" | "semiannual" | "annual" | "irregular" | null;
}
/** null clears the number. The previous number is kept as history. */
export interface SetAccountNumberRequest {
  accountNumber: string | null;
}
export interface AddIdentifierRequest {
  kind: string;
  value: string;
  validFrom?: string;
  validTo?: string;
}

// ---------------------------------------------------------------- vocabulary

export interface ConceptDto {
  id: string;
  labelEn: string;
  labelHe: string | null;
  description: string | null;
  periodType: PeriodType;
  valueType: ValueType;
  /** What a fact of this concept must be attached to. */
  subject: "account" | "person";
  genericConceptId: string | null;
  jurisdiction: string | null;
  authorityRank: number;
  deprecatedBy: string | null;
}
export interface TermDto {
  id: string;
  taxonomyId: string;
  parentTermId: string | null;
  labelEn: string;
  labelHe: string | null;
}
export interface TaxonomyDto {
  id: string;
  labelEn: string;
  labelHe: string | null;
  terms: TermDto[];
}

// ---------------------------------------------------------------- documents

export interface DocumentDto {
  id: number;
  sha256: string;
  originalFilename: string;
  byteSize: number;
  pageCount: number | null;
  importedAt: string;
  docType: string | null;
  institutionId: number | null;
  language: Language | null;
  issuedOn: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  taxYear: number | null;
  identityKey: string | null;
  status: DocumentStatus;
  accountIds: number[];
  factCount: number;
}
export interface DocumentPageDto {
  pageNo: number;
  widthPt: number;
  heightPt: number;
  rotation: 0 | 90 | 180 | 270;
  textSource: "native" | "ocr" | "none";
}
export interface DocumentDetailDto extends DocumentDto {
  pages: DocumentPageDto[];
}
export interface UploadImportedResponse {
  status: "imported";
  documentId: number;
  sha256: string;
  pageCount: number;
  possibleDuplicateOf: number[];
  possibleRevisionOf: number[];
}
export interface UploadDuplicateResponse {
  status: "duplicate";
  existingDocumentId: number;
  sha256: string;
}
export type UploadResponse = UploadImportedResponse | UploadDuplicateResponse;

export interface UpdateDocumentRequest {
  /** null clears. */
  institutionId?: number | null;
  /** A term id of the doc_type taxonomy; null clears. */
  docType?: string | null;
  language?: Language | null;
  issuedOn?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  taxYear?: number | null;
  identityKey?: string | null;
  status?: "inbox" | "reviewed";
}

export interface TextLayerItemDto {
  str: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  dir: string;
}
export interface TextLayerPageDto extends DocumentPageDto {
  items: TextLayerItemDto[];
}
export interface TextLayerDto {
  sha256: string;
  pages: TextLayerPageDto[];
}

// ---------------------------------------------------------------- facts

export interface FactSourceDto {
  id: number;
  documentId: number;
  documentName: string;
  pageNo: number | null;
  bbox: PdfRect | null;
  /** Text inside the box, computed by the server from the text layer; null when the page has no text layer. */
  quotedText: string | null;
}

export interface FactDto {
  id: number;
  conceptId: string;
  conceptLabelEn: string;
  conceptLabelHe: string | null;
  valueType: ValueType;
  accountId: number | null;
  accountName: string | null;
  accountLanguage: Language | null;
  personId: number | null;
  personName: string | null;
  /** Money in minor units as a decimal string, or null. */
  valueMinor: string | null;
  valueDecimal: string | null;
  valueText: string | null;
  currency: string | null;
  /** Display string: "$83,421.17" for money, otherwise the value as stored. */
  formatted: string;
  instantDate: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  taxYear: number | null;
  dimensions: Record<string, unknown>;
  status: FactStatus;
  origin: FactOrigin;
  extractionRunId: number | null;
  supersedesFactId: number | null;
  note: string | null;
  createdAt: string;
  createdBy: number | null;
  verifiedAt: string | null;
  verifiedBy: number | null;
  sources: FactSourceDto[];
  /** Does the value read from the source box equal the typed value? null when there is no text to compare. */
  valueMatchesSource: boolean | null;
}

export interface FactEventDto {
  id: number;
  factId: number;
  at: string;
  actor: number | null;
  actorName: string | null;
  event: "proposed" | "verified" | "corrected" | "rejected" | "superseded" | "reopened";
  payload: Record<string, unknown>;
}

export interface FactDetailDto {
  fact: FactDto;
  events: FactEventDto[];
  /** Older facts this one replaced, nearest first. */
  supersedes: FactDto[];
  /** Newer facts that replaced this one, nearest first. */
  supersededBy: FactDto[];
}

interface FactValueFields {
  /** The value as a person would type it: "$83,421.17", "1,204.33", "2025-06-30", "true". */
  value: string;
  /** Required for money concepts. */
  currency?: string;
  /** Instant concepts. */
  instantDate?: string;
  /** Duration concepts (inclusive). */
  periodStart?: string;
  periodEnd?: string;
  taxYear?: number;
  dimensions?: Record<string, string | number | boolean | null>;
  accountId?: number;
  personId?: number;
  note?: string;
}

export interface ProposeFactRequest extends FactValueFields {
  documentId: number;
  pageNo: number;
  /** [x0, y0, x1, y1], unrotated PDF points. The server recomputes quoted text from it. */
  bbox: PdfRect;
  conceptId: string;
}
export interface ProposeFactResponse {
  fact: FactDto;
  valueMatchesSource: boolean | null;
}

export interface AttestationRequest extends Omit<FactValueFields, "note"> {
  conceptId: string;
  /** Mandatory: who says so and why. */
  note: string;
}

export interface CorrectFactRequest {
  conceptId?: string;
  value?: string;
  currency?: string;
  instantDate?: string;
  periodStart?: string;
  periodEnd?: string;
  taxYear?: number | null;
  dimensions?: Record<string, string | number | boolean | null>;
  accountId?: number | null;
  personId?: number | null;
  note?: string;
  /** Verify the corrected fact in the same step (subject to the conflict rule). */
  verify?: boolean;
}

export interface ConflictDetails {
  /** Verified facts in the same slot with a different value. */
  conflicts: FactDto[];
}

// ---------------------------------------------------------------- exchange rates

/** 1 `base` = `rate` `quote`; `rate` is an exact decimal string, never a number. */
export interface ExchangeRateDto {
  id: number;
  sourceId: string;
  base: string;
  quote: string;
  rate: string;
  rateDate: string;
  note: string | null;
  importedAt: string;
}

export interface ImportRatesResponse {
  added: number;
  unchanged: number;
  /** Dates already stored with a different rate; the stored rate was kept. */
  conflicts: { quote: string; rateDate: string; stored: string; incoming: string }[];
  /** Rows for currencies the app does not support yet. */
  skippedCurrencies: number;
}

// ---------------------------------------------------------------- FBAR report (DESIGN D18)

export interface MoneyDto {
  /** Integer minor units as a decimal string. */
  minor: string;
  currency: string;
  formatted: string;
}

export type FbarStatus = "COMPLETE" | "INCOMPLETE" | "CONFLICT";
export type FbarTestVerdict = "EXCEEDED" | "NOT_EXCEEDED" | "UNDETERMINED";
export type FbarVerdict = "REQUIRED" | "NOT_REQUIRED" | "DEPENDS_ON_RULE" | "UNDETERMINED" | "NO_FOREIGN_ACCOUNTS";

export interface FbarRowDto {
  accountId: number;
  displayName: string;
  country: string;
  currency: string;
  status: FbarStatus;
  /** The highest verified period-end balance in the year (an approximation of the true peak). */
  max: { amount: MoneyDto; date: string; factIds: number[] } | null;
  /** `max` in USD at the 31 December rate; null when there is no maximum or no rate. */
  usd: MoneyDto | null;
  conversion: { kind: "none" } | { kind: "rate"; rate: string; rateDate: string } | { kind: "missing_rate"; currency: string } | null;
  /** False when the account's statement cadence is unset or irregular, so missing dates cannot be listed. */
  coverageKnown: boolean;
  /** Dates a statement should have given a balance for, but none is recorded. */
  missing: string[];
  conflicts: { date: string; values: { amount: MoneyDto; factIds: number[] }[] }[];
  excluded: { factId: number; date: string; reason: "unverified" | "other_currency" | "no_amount" }[];
  /** Every verified fact the maximum was chosen from. */
  factIds: number[];
}

export interface FbarReportDto {
  year: number;
  status: FbarStatus;
  verdict: FbarVerdict;
  threshold: MoneyDto;
  /** Sum of the known USD maxima; a lower bound unless `status` is COMPLETE. */
  knownAggregate: MoneyDto;
  rows: FbarRowDto[];
  notInScope: { accountId: number; displayName: string; reason: "opened_after_year" | "closed_before_year" }[];
  tests: {
    sumOfMaxima: FbarTestVerdict;
    singleDate: {
      verdict: FbarTestVerdict;
      exceededOn: string | null;
      dates: { date: string; usd: MoneyDto; missingAccountIds: number[] }[];
    };
  };
}

// ---------------------------------------------------------------- Form 8938 (DESIGN D21)

export type Form8938Verdict = "REQUIRED" | "NOT_REQUIRED" | "DEPENDS_ON_RULE" | "UNDETERMINED" | "NO_FOREIGN_ACCOUNTS";
/** How the form treats an account; `not_classified` = no us_8938 term for the year. */
export type Form8938Treatment = "financial_account" | "pension_plan" | "ask_preparer" | "not_classified";
export type Form8938ValueSource = "balances" | "year_end_balance" | "closing_date" | "missing" | "conflict";

export interface Form8938ValueDto {
  /** In the account's own currency; null when unknown. */
  native: MoneyDto | null;
  /** In USD at the 31 December Treasury rate; null when unknown or when there is no rate. */
  usd: MoneyDto | null;
  source: Form8938ValueSource;
  date: string | null;
  factIds: number[];
  status: FbarStatus;
}

export interface Form8938MaximumDto extends Form8938ValueDto {
  /** True when it is the maximum of period-end balances (an approximation of the true peak). */
  approximation: boolean;
  /** Dates a statement should have given a balance for, but none is recorded (over the period measured). */
  missingDates: string[];
  coverageKnown: boolean;
  conflicts: { date: string; values: { amount: MoneyDto; factIds: number[] }[] }[];
}

export type Form8938ConversionDto =
  | { kind: "none" }
  | { kind: "rate"; rate: string; rateDate: string; rateId: number }
  | { kind: "missing_rate"; currency: string };

export interface Form8938DetailsDto {
  identifiers: { kind: string; value: string }[];
  institutionName: string | null;
  openedDuringYear: boolean;
  closedDuringYear: boolean;
  owners: { personId: number; displayName: string }[];
  currency: string;
  rate: { rate: string; rateDate: string; rateId: number } | null;
  mailingAddress: "not_in_finshark";
  giin: "not_in_finshark";
}

export interface Form8938TaxItemPeriodDto {
  periodStart: string;
  periodEnd: string;
  /** Null when verified facts disagree on this period (then `disagreeing` is set). */
  value: MoneyDto | null;
  conceptIds: string[];
  factIds: number[];
  disagreeing: { amount: MoneyDto; factIds: number[] }[] | null;
}

export interface Form8938TaxItemGroupDto {
  genericConceptId: string;
  currency: string;
  periods: Form8938TaxItemPeriodDto[];
  /** Null when periods overlap or disagree; a lower bound when there are gaps. */
  total: MoneyDto | null;
  complete: boolean;
  gaps: { start: string; end: string }[];
  overlaps: { a: { start: string; end: string }; b: { start: string; end: string } }[];
  factIds: number[];
}

export interface Form8938TaxItemsDto {
  groups: Form8938TaxItemGroupDto[];
  excluded: { factId: number; genericConceptId: string; reason: "unverified" | "no_amount" | "other_currency" | "straddles_year" | "bad_period" }[];
  /** No tax item was found for the year (Part V has a box for that). */
  noTaxItems: boolean;
}

export interface Form8938RowDto {
  accountId: number;
  displayName: string;
  country: string;
  currency: string;
  treatment: Form8938Treatment;
  /** True for financial_account and pension_plan; the rest only enter the "withUnresolved" totals. */
  counted: boolean;
  conversion: Form8938ConversionDto;
  maximum: Form8938MaximumDto;
  yearEnd: Form8938ValueDto;
  details: Form8938DetailsDto;
  /** Only for counted accounts. */
  taxItems: Form8938TaxItemsDto | null;
}

export type Form8938ReasonDto =
  | { code: "unsupported_filing_status"; filingStatus: FilingStatus | null }
  | { code: "residence_not_set" }
  | { code: "missing_values"; accountIds: number[] }
  | { code: "missing_rate"; accountIds: number[]; currencies: string[] }
  | { code: "conflicting_values"; accountIds: number[] }
  | { code: "ask_preparer_accounts"; accountIds: number[] }
  | { code: "not_classified_accounts"; accountIds: number[] }
  | { code: "sum_of_maxima_only" }
  | { code: "unresolved_accounts_push_over" };

/** Each figure twice: over counted accounts only, and also counting ask_preparer / not classified ones. */
export interface Form8938PairedDto<T> {
  counted: T;
  withUnresolved: T;
}

export interface Form8938SingleDateDto {
  date: string;
  usd: MoneyDto;
  missingAccountIds: number[];
}

export interface Form8938ScenarioDto {
  thresholds: { yearEnd: MoneyDto; anyTime: MoneyDto };
  yearEnd: Form8938PairedDto<FbarTestVerdict>;
  sumOfMaxima: Form8938PairedDto<FbarTestVerdict>;
  singleDate: Form8938PairedDto<{ verdict: FbarTestVerdict; exceededOn: string | null }>;
  /** The verdict if this threshold row applied (the filing status is not considered here). */
  verdict: "REQUIRED" | "NOT_REQUIRED" | "DEPENDS_ON_RULE" | "UNDETERMINED";
}

export interface Form8938ReportDto {
  year: number;
  filingStatus: FilingStatus | null;
  abroad: boolean | null;
  /** Which threshold row(s) the verdict used; "both" when residence is not set. */
  applied: "us" | "abroad" | "both";
  verdict: Form8938Verdict;
  /** Why the verdict is not firm (UNDETERMINED or DEPENDS_ON_RULE). */
  reasons: Form8938ReasonDto[];
  /** About the values. */
  status: FbarStatus;
  /** About Part III tax items, kept apart from the values. */
  taxItemsStatus: FbarStatus;
  scenarios: { us: Form8938ScenarioDto; abroad: Form8938ScenarioDto };
  /** Totals of the known values in USD; lower bounds unless `status` is COMPLETE. */
  totals: {
    yearEnd: Form8938PairedDto<MoneyDto>;
    sumOfMaxima: Form8938PairedDto<MoneyDto>;
    singleDate: Form8938PairedDto<Form8938SingleDateDto[]>;
  };
  /** Counted accounts first, then ask_preparer / not classified ones. */
  rows: Form8938RowDto[];
  /** Classified not_reportable: excluded from every total. */
  notReportable: { accountId: number; displayName: string; reason: string | null }[];
  notInScope: { accountId: number; displayName: string; reason: "opened_after_year" | "closed_before_year" }[];
  /** Part IV (Forms 3520, 5471, 8621, 8865) is not tracked; the preparer must check it. */
  partIV: { checkedByPreparer: true };
}

// ---------------------------------------------------------------- backups (DESIGN D20)

export interface BackupProblemDto {
  code: string;
  message: string;
  path?: string;
}

export interface BackupFileDto {
  name: string;
  createdAt: string;
  bytes: number;
  /** null = not yet verified. */
  verifiedAt: string | null;
  verifyOk: boolean | null;
  problems: BackupProblemDto[];
  /** Problems the vault check found while this backup was written. */
  vaultWarnings: BackupProblemDto[];
  copiedAt: string | null;
  copyError: string | null;
}

export type BackupWarningCode = "not_set_up" | "stale" | "verify_failed" | "vault_problems" | "second_folder" | "backup_failed";

export interface BackupStatusDto {
  setUp: boolean;
  /** A key was made but the recovery sheet isn't confirmed yet. */
  awaitingConfirmation: boolean;
  recipient: string | null;
  keyOnThisMac: boolean;
  /** This Mac's Keychain holds a key for a different public key. */
  keyMismatch: boolean;
  secondDir: string | null;
  secondDirProblem: string | null;
  /** A "Choose..." button can open the macOS folder chooser (POST /api/backups/second-folder/choose). */
  canChooseFolder: boolean;
  running: boolean;
  lastError: string | null;
  /** Newest first. */
  files: BackupFileDto[];
  /** Shown on every page. */
  warnings: { code: BackupWarningCode; message: string }[];
}

export interface BackupSetupRequest {
  passphrase: string;
}

export interface BackupSetupResponse {
  identity: string;
  recipient: string;
  /** Plain text to print and keep somewhere safe. */
  recoverySheet: string;
}

export interface BackupConfirmRequest {
  lastChars: string;
}

export type BackupImportKeyRequest = { passphrase: string } | { identity: string };

export interface BackupSecondFolderRequest {
  /** Absolute path, or null to stop copying to a second folder. */
  path: string | null;
}

// ---------------------------------------------------------------- Form 8938 data (DESIGN D21)

/** Only married_joint is supported by the Form 8938 report; the rest are storable. */
export const FILING_STATUSES = ["married_joint", "married_separate", "single", "head_of_household", "qualifying_surviving_spouse"] as const;
export type FilingStatus = (typeof FILING_STATUSES)[number];

export const US_8938_TERM_IDS = ["us_8938/financial_account", "us_8938/pension_plan", "us_8938/not_reportable", "us_8938/ask_preparer"] as const;
export type Us8938TermId = (typeof US_8938_TERM_IDS)[number];

export interface TaxYearDto {
  year: number;
  filingStatus: FilingStatus | null;
  /** true = meets a presence-abroad test, false = lives in the US, null = not set. */
  abroad8938: boolean | null;
  /** null when the year has no row yet. */
  updatedAt: string | null;
}
export interface SetTaxYearRequest {
  filingStatus: FilingStatus | null;
  abroad8938: boolean | null;
}

/** Sets the classification for `year` onward (earlier years keep theirs); termId null clears it. */
export interface SetUs8938Request {
  year: number;
  termId: Us8938TermId | null;
  /** Required (non-empty) for us_8938/not_reportable, otherwise null. */
  reason: string | null;
}
export interface Us8938ClassificationDto {
  year: number;
  termId: Us8938TermId;
  reason: string | null;
  validFrom: string | null;
  validTo: string | null;
}
