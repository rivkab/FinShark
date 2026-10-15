// Request/response types of the HTTP API (JSON). Shared by the server routes and the web client.
//
// Conventions
//  * Ids are JSON numbers, except the session's personId which is a string (see /api/session).
//  * Money (bigint minor units) travels as a decimal string ("8342117") plus a `formatted`
//    display string ("$83,421.17"). Never parse these with Number.
//  * Dates are ISO "YYYY-MM-DD" strings, timestamps ISO-8601 UTC.
//  * Errors are `ApiErrorBody` with HTTP 400 (bad input), 404 (not found), 409 (state/conflict).
//  * Every mutation except POST /api/people and POST /api/session/person needs a chosen
//    person (409 `choose_person` otherwise) and the CSRF header.
//
// Endpoints (all under the security hooks; JSON unless noted)
//   GET  /api/people                         -> { people: PersonDto[] }
//   POST /api/people          CreatePersonRequest        -> 201 PersonDto
//   GET  /api/institutions                   -> { institutions: InstitutionDto[] }
//   POST /api/institutions    CreateInstitutionRequest   -> 201 InstitutionDto
//   GET  /api/accounts                       -> { accounts: AccountDto[] }
//   POST /api/accounts        CreateAccountRequest       -> 201 AccountDto
//   POST /api/accounts/:id/identifiers  AddIdentifierRequest -> 201 AccountDto
//   PUT  /api/accounts/:id/type            SetAccountTypeRequest -> AccountDto
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
//   GET  /api/facts?status=&concept=&account=&document=  -> { facts: FactDto[] }
//   GET  /api/facts/:id                      -> FactDetailDto
//   POST /api/facts/:id/verify               -> { fact } | 409 conflict (details: ConflictDetails)
//   POST /api/facts/:id/correct  CorrectFactRequest      -> 201 { fact, superseded } | 409 conflict
//   POST /api/facts/:id/reject   { reason }              -> { fact }
//   POST /api/facts/:id/reopen                           -> { fact }
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
}
export interface CreatePersonRequest {
  displayName: string;
}

export interface InstitutionDto {
  id: number;
  name: string;
  altName: string | null;
  country: string;
  language: Language;
}
export interface CreateInstitutionRequest {
  name: string;
  country: string;
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
/** null clears the type. */
export interface SetAccountTypeRequest {
  accountType: AccountType | null;
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
