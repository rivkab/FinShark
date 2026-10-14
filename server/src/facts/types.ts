import type { DatabaseSync } from "node:sqlite";
import type { PdfRect } from "@finshark/shared";
import type { VaultLayout } from "../vault/layout.ts";
import type { ExtractFn } from "../documents/text-layer.ts";

export type FactStatus = "proposed" | "verified" | "rejected" | "superseded";
export type FactOrigin = "parser" | "manual" | "user_correction" | "attestation" | "derived" | "ai_suggestion";
export type ValueType = "money" | "decimal" | "integer" | "text" | "date" | "boolean";
export type PeriodType = "instant" | "duration" | "none";
export type Language = "en" | "he";

export type FactErrorCode =
  | "actor_required"
  | "not_found"
  | "bad_input"
  | "bad_period"
  | "bad_value"
  | "bad_bbox"
  | "subject_required"
  | "note_required"
  | "deprecated_concept"
  | "bad_state";

/** A refusal the caller can show to a person. `details` is JSON-safe. */
export class FactError extends Error {
  readonly code: FactErrorCode;
  readonly details?: unknown;
  constructor(code: FactErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "FactError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export interface Fact {
  id: number;
  conceptId: string;
  accountId: number | null;
  personId: number | null;
  /** Money in minor units. */
  valueMinor: bigint | null;
  /** Exact decimal / integer as a string. */
  valueDecimal: string | null;
  /** Text, ISO date or "true"/"false". */
  valueText: string | null;
  currency: string | null;
  instantDate: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  taxYear: number | null;
  dimensions: Record<string, unknown>;
  status: FactStatus;
  origin: FactOrigin;
  extractionRunId: number | null;
  supersedesFactId: number | null;
  derivation: unknown;
  note: string | null;
  createdAt: string;
  createdBy: number | null;
  verifiedAt: string | null;
  verifiedBy: number | null;
}

export interface FactSource {
  id: number;
  factId: number;
  documentId: number;
  documentName: string;
  pageNo: number | null;
  bbox: PdfRect | null;
  quotedText: string | null;
  locator: unknown;
}

export interface FactEvent {
  id: number;
  factId: number;
  at: string;
  actor: number | null;
  actorName: string | null;
  event: "proposed" | "verified" | "corrected" | "rejected" | "superseded" | "reopened";
  payload: Record<string, unknown>;
}

/** A fact with everything a review screen needs. */
export interface FactView {
  fact: Fact;
  concept: { id: string; labelEn: string; labelHe: string | null; valueType: ValueType; periodType: PeriodType };
  account: { id: number; displayName: string; language: Language } | null;
  person: { id: number; displayName: string } | null;
  sources: FactSource[];
  /** Does the value read from the source box equal the stored value? null when there is no text to compare. */
  valueMatchesSource: boolean | null;
}

export interface FactDeps {
  db: DatabaseSync;
  /** Injected clock. */
  now: () => Date;
}

export interface ProposeDeps extends FactDeps {
  layout: VaultLayout;
  /** Override the text extractor (tests). */
  extractText?: ExtractFn;
}

/** The fields shared by manual proposals, attestations and corrections. */
export interface FactFields {
  conceptId: string;
  accountId?: number | null | undefined;
  personId?: number | null | undefined;
  /** As a person would type it: "$83,421.17", "1,204.33", "2025-06-30", "true". */
  value: string;
  currency?: string | null | undefined;
  instantDate?: string | null | undefined;
  periodStart?: string | null | undefined;
  periodEnd?: string | null | undefined;
  taxYear?: number | null | undefined;
  dimensions?: Record<string, unknown> | null | undefined;
  note?: string | null | undefined;
}

export interface ManualFactInput extends FactFields {
  documentId: number;
  pageNo: number;
  bbox: PdfRect;
}

export type AttestationInput = Omit<FactFields, "note"> & { note: string };

export interface FactChanges {
  conceptId?: string | undefined;
  value?: string | undefined;
  currency?: string | null | undefined;
  instantDate?: string | null | undefined;
  periodStart?: string | null | undefined;
  periodEnd?: string | null | undefined;
  taxYear?: number | null | undefined;
  dimensions?: Record<string, unknown> | null | undefined;
  accountId?: number | null | undefined;
  personId?: number | null | undefined;
  note?: string | null | undefined;
  /** Verify the corrected fact in the same step (same conflict rule as verifyFact). */
  verify?: boolean | undefined;
}

export interface FactConflict {
  /** The fact that could not be verified. */
  factId: number;
  /** Verified facts in the same slot with a different value. */
  conflictingWith: FactView[];
}

export type VerifyResult = { ok: true; view: FactView; corroboratedBy: number[] } | { ok: false; conflict: FactConflict };

export type CorrectResult =
  | { ok: true; view: FactView; superseded: FactView; corroboratedBy: number[] }
  | { ok: false; conflict: FactConflict };

export interface FactFilters {
  status?: FactStatus | undefined;
  conceptId?: string | undefined;
  accountId?: number | undefined;
  documentId?: number | undefined;
}

export interface FactHistory {
  view: FactView;
  events: FactEvent[];
  /** Older facts this one replaced, nearest first. */
  supersedes: FactView[];
  /** Newer facts that replaced this one, nearest first. */
  supersededBy: FactView[];
}
