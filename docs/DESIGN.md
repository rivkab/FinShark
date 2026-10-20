# FinShark — Architecture & Product Design (draft 1)

Status: proposal for discussion, before any code. Date: 2026-10-12.

The one-line mission, as stated: **store financial evidence once, extract structured
information, verify it, query it deterministically, keep the evidence attached, reuse
it indefinitely.**

This document proposes the domain model, query model, provenance model, import
pipeline, backup format and the main risks. Where I think a stated assumption is
wrong or incomplete, it says so explicitly (marked **Challenge**).

---

## 0. The five decisions that matter most

If you read nothing else:

1. **Facts are modeled on XBRL's "concept + context" pattern, not free EAV.** A fact is
   `(concept, subject, period, dimensions) → value`, where the *concept* comes from a
   registry stored as data, and the *period* is either an **instant** (a balance on
   2025-12-31) or a **duration** (interest earned 2025-01-01..2025-12-31). Getting the
   instant/duration distinction right up front prevents most of the
   "which number do I add up" bugs later. New document types add concept rows, not
   migrations.

2. **The query engine works on a small typed query language (an "IR"), not on SQL.**
   The visual builder edits the IR; saved queries store the IR; the engine compiles
   it to SQL and *also* computes completeness and the evidence chain. Raw SQL exists
   as an escape hatch against versioned read-only views, but it cannot produce
   completeness reports — and the UI says so.

3. **Completeness requires expectations.** The system can only say "the Israeli pension
   fund's 2025 statement is missing" if it knows that pension account exists, was open
   in 2025, and is expected to report a year-end balance. So the **account registry**
   (with open/close dates) is the backbone of "I don't know," not the documents.

4. **Everything is append-only where it matters.** Facts are never edited in place;
   corrections create new facts that supersede old ones; revised documents supersede
   old documents; and query runs you *send to someone* are frozen as snapshots.
   That makes "what did we tell the school last March, and why?" answerable.

5. **The backup is a standard tar stream encrypted with `age`.** It is restorable
   by the app, *and* by hand with the open-source `age` CLI and `tar` if the app no
   longer exists. Long-lived archives should not depend on the software that made
   them.

---

## 1. Challenges to the brief

These are places where I'd push back or refine before building.

**C1. "Write a parser per institution" may not pay off for one household.**
A household might have ~15–25 institutions, many producing 1–4 documents per year.
Writing and maintaining a deterministic parser for a document you see once a year
(and whose layout changes every few years) is often more work than typing three
numbers. The universal, always-available extractor should be **manual extraction
with provenance**: open the PDF, drag a box around "$83,421.17", pick the concept
and account, done — the fact gets the same page + bounding-box provenance a parser
would produce. Parsers are then an *optimization* for high-volume documents (monthly
statements, pay stubs) and are added only when the manual effort justifies it.
The vertical slice should build manual extraction first.

**C2. Prefer structured exports over PDF parsing when they exist.** Many institutions
offer CSV/OFX/QFX downloads alongside the PDF. Those are far more reliable to parse.
They can be imported as *source documents* in their own right (with row-level
provenance instead of bounding boxes). This is not transaction syncing — it's another
evidence format.

**C3. "Extract everything" is the wrong default.** The wife's time is the scarce
resource; verification is the cost. Each document type should declare a small set
of *useful* concepts (ending balance, interest, withholding, a few form boxes). If a
new question later needs something not yet extracted, the document is already
there — extract it then. Extraction is lazy and incremental.

**C4. Same quantity, multiple documents → double counting.** "Interest earned in
2025" is reported by twelve monthly statements *and* by the 1099-INT (or the Israeli
Form 867). A naive SUM double-counts. The design must distinguish *source-specific*
concepts (`us.1099int.box1`, `statement.interest_paid`) from the *generic* concept
(`interest_income`), and the query engine must pick a **non-overlapping cover** of
the requested period, preferring the most authoritative source, and flag
discrepancies between sources rather than silently choosing. (See §4.5.)

**C5. "Retirement" is not a property of an account type; it's a classification
decision.** Is an Israeli *keren hishtalmut* retirement savings? For the IRS, for
Israeli tax, and for a CSS Profile, the answers differ. Account classifications must
be user-editable tags in named taxonomies, and queries should filter on them. Don't
put `is_retirement BOOLEAN` on the account table.

**C6. "As of December 31" is rarely exact.** A bank's monthly statement may end on
Dec 28; a pension report may be quarterly; a brokerage annual statement ends
Dec 31. The engine must never silently carry a Dec 28 balance forward as the Dec 31
balance. Date tolerance is an explicit query policy, and every contributing fact
shows its actual date.

**C7. Different workflows need different exchange rates.** FBAR / Form 8938 use the
US Treasury year-end reporting rate; Israeli filings use the Bank of Israel
representative rate; some workflows use the IRS yearly average. "Convert to USD" is
underspecified until you name a rate source. Rate source must be a query parameter,
and rates themselves are data with provenance.

**C8. Some needed values are not on any document.** FBAR asks for the *maximum*
account value during the year. Statements give month-end balances; the max of those
is an approximation, not the answer. The system should support derived facts with
an explicit, recorded derivation ("max of 12 verified month-end balances") so the
approximation is visible.

**C9. The encrypted backup protects backups, not the live data.** `finance.db` and
`documents/` sit decrypted on disk while in use. That's fine *if* the disk is
encrypted (FileVault). Options are discussed in §8; the point is that the privacy
claim should be stated precisely.

**C10. A localhost web server is reachable by every website open in the browser.**
Any page you visit can send requests to `http://127.0.0.1:PORT`, and DNS-rebinding
attacks can read responses. A "local-only" financial app that doesn't defend against
this is not actually private. See §9 — this is a must-have, not hardening.

---

## 2. Core domain model

### 2.1 Data states (as requested, made concrete)

```
Document (raw, immutable, hashed)
   │  extraction run (parser@version | manual | ai-suggestion)
   ▼
Fact [status = proposed]     ← never used by queries by default
   │  human verifies / corrects / rejects
   ▼
Fact [status = verified]     ← authoritative
   │  query IR + parameters + rate source
   ▼
Query result (derived; ephemeral unless snapshotted)
   │  "export / send to school"
   ▼
Query snapshot (frozen: definition, params, fact ids, values, app/schema version)
```

A correction does **not** edit a fact. It creates a new fact
(`origin = user_correction`, `supersedes_fact_id = old`) with the same source
location, and marks the old one `superseded`. Both remain forever.

### 2.2 Entities

```
people              id, display_name, ...
institutions        id, name, country, metadata(json)
accounts            id, institution_id, display_name, country, native_currency,
                    account_type, notes, opened_on, closed_on, statement_cadence,
                    metadata(json)
account_identifiers account_id, kind (last4 | full_hash | iban | policy_no | ...),
                    value, valid_from, valid_to
account_owners      account_id, person_id, role (owner | joint | custodian |
                    beneficiary | participant), share (nullable), valid_from, valid_to
account_links       from_account, to_account, kind (successor | renumbered |
                    sub_account_of | rolled_over_to), effective_on

taxonomies          id ('asset_class', 'tax_treatment', 'liquidity', 'aid_category', ...)
terms               id, taxonomy_id, slug, parent_term_id, label_en, label_he
account_terms       account_id, term_id, valid_from, valid_to
```

Notes:

- **Account identity over time** is a real problem in Israel (pension funds merge,
  managing companies change, policy numbers change) and in the US (401k → IRA
  rollovers). `account_identifiers` with validity ranges + `account_links` handle
  this without rewriting history.
- **Ownership** is a time-ranged relation, not a column. Joint accounts, custodial
  accounts for children (UTMA — which financial-aid forms count as the *student's*
  asset), and employer plans all fit. Whether a joint account counts fully,
  pro-rata, or not at all for "owner = X" is a **query policy**, not a model fact.
- **Classifications** are hierarchical terms in named taxonomies, time-ranged. Users
  can create taxonomies (e.g., "CSS Profile category") without code changes.

### 2.3 Documents

```
documents           id, sha256 (unique), stored_path, original_filename, byte_size,
                    mime, page_count, imported_at,
                    doc_type (term), institution_id,
                    issued_on, period_start, period_end, tax_year,
                    identity_key, text_fingerprint,
                    supersedes_document_id, status, metadata(json)
document_accounts   document_id, account_id
document_pages      document_id, page_no, width_pt, height_pt, rotation,
                    text_source (native | ocr | none), text_sha256
```

- Files live in `documents/YYYY/<sha256-prefix>/<sha256>.pdf` (content-addressed;
  the original filename is metadata). Content addressing makes "is this file intact"
  and "is this a duplicate" trivially checkable and makes renames harmless. The
  year folder is cosmetic; use import year to avoid moving files when metadata
  changes.
- A document's period/tax-year fields are *descriptive*. Facts carry their own
  periods; a multi-year or multi-account document is just a document with facts
  pointing to several accounts/periods.
- Extracted text layers (with per-glyph-run positions) are cached as sidecar JSON
  files keyed by `(sha256, extractor version)`, not in the DB — they're derived and
  regenerable.

### 2.4 Concepts (the registry that replaces schema migrations)

```
concepts   id (stable slug), label_en, label_he, description,
           period_type   (instant | duration | none),
           value_type    (money | decimal | integer | text | date | boolean),
           subject       (account | person) -- what a fact must be attached to (D8),
           generic_concept_id (nullable — 'us.1099int.box1' → 'interest_income'),
           jurisdiction  (nullable),
           authority_rank (for picking among sources of the same generic concept),
           deprecated_by (nullable)
```

Examples:

| id | period | generic |
|---|---|---|
| `balance.ending` | instant | — |
| `balance.market_value` | instant | — |
| `income.interest` | duration | — |
| `statement.interest_paid` | duration | `income.interest` |
| `us.1099int.box1` | duration | `income.interest` |
| `il.f867.interest` | duration | `income.interest` |
| `us.w2.box1_wages` | duration | `income.wages` |
| `us.w2.box2_fed_withheld` | duration | `tax.withheld.us_federal` |
| `il.pension.accrued_savings` | instant | `balance.ending` |
| `status.account_closed` | instant | — |
| `status.no_document_issued` | duration | — |

Rules: a fact must reference a registered concept; parsers declare which concepts
they emit; concepts are never deleted, only deprecated. This keeps the vocabulary
governed (the failure mode of EAV is 40 spellings of "balance") while letting it
grow without migrations. Concept definitions ship with the app as seed data that
the user can extend.

### 2.5 Facts and provenance

```
facts
  id
  concept_id
  account_id         (required when concept.subject = 'account'; see D8)
  person_id          (required when concept.subject = 'person', e.g. W-2 wages)
  value_minor        INTEGER  -- money, in minor units (cents / agorot)
  value_decimal      TEXT     -- exact decimal string for shares, prices, rates
  value_text         TEXT
  currency           (ISO 4217, required for money)
  instant_date       (for instant concepts)
  period_start, period_end   (for duration concepts; inclusive dates)
  tax_year           (nullable; set only when the source says it, e.g. a 1099)
  dimensions         JSON  -- e.g. {"payer_tin_last4": "1234", "holding": "VTI"}
  status             proposed | verified | rejected | superseded
  origin             parser | manual | user_correction | attestation | derived | ai_suggestion
  extraction_run_id
  supersedes_fact_id
  derivation         JSON  -- for origin=derived: inputs + rule
  created_at, verified_at, verified_by, note

fact_sources         -- 0..n per fact (attestations have none; some values span regions)
  fact_id, document_id, page_no,
  bbox               JSON [x0, y0, x1, y1] in PDF points, unrotated page space
  quoted_text        -- exact text inside the box at extraction time
  locator            JSON  -- for CSV/OFX: {"row": 14, "column": "Balance"}

fact_events          -- append-only audit log
  id, fact_id, at, actor, event (proposed | verified | corrected | rejected |
  superseded | reopened), payload JSON

extraction_runs
  id, document_id, extractor_id, extractor_version, input_text_sha256,
  started_at, finished_at, status, checks JSON, log
```

**Money is stored as integer minor units, never floats.** SQLite `SUM` over 64-bit
integers is exact; `REAL` sums are not. Values needing more precision (share
quantities, unit prices, FX rates) are decimal strings and computed in TypeScript
with a decimal library. Every rounding step in a derived result is recorded.

**Precise source location** = `(document sha256, page_no, bbox in PDF user space,
quoted_text)`. Storing the quoted text lets us later detect if the file or the text
extractor changed under a fact ("bbox now contains different text"). Coordinates are
stored in unrotated PDF points so they're independent of render zoom and of pdf.js
version; rendering applies page rotation.

### 2.6 Unknown vs. not applicable vs. zero vs. not imported

These are *different things* and are represented differently:

| State | Representation |
|---|---|
| **Zero** | A verified fact with value 0 from a document ("Interest paid: $0.00") |
| **Not applicable** | An *attestation* fact by a user, e.g. `status.account_closed` at 2025-06-30, or `status.no_document_issued` for 2025 with note "Chase doesn't issue 1099-INT under $10" |
| **Not yet imported** | An expectation exists (account open, cadence annual) but no document/fact covers it |
| **Unknown** | No expectation and no fact — the system can't even know to ask |

Attestations are facts with `origin = attestation`, no `fact_sources`, a mandatory
note, and a verifier. They're visibly different from document-backed facts in every
evidence view ("Attested by Sarah on 2026-02-10: account closed in June").

The "unknown unknowns" row is unavoidable in principle. Mitigations: an annual
"account registry review" step, and cross-document hints (a 1099 or 867 from an
institution/account not in the registry raises a flag).

---

## 3. Import pipeline

```
inbox/ (watched folder or drag-drop)
  1. hash        sha256 → exact duplicate? → stop, link to existing
  2. store       copy to documents/…/<sha256>.pdf (atomic: temp file + fsync + rename)
  3. text        pdf.js text layer with positions; if a page has no text → OCR
  4. fingerprint normalized text hash → near-duplicate? (same statement re-downloaded)
  5. classify    rule-based: each extractor declares a match() over text/metadata
  6. extract     matching extractor proposes facts + identity_key + checks
  7. dedupe/rev  identity_key collision → "duplicate" or "possible revision" prompt
  8. review      verification queue: proposed facts with source highlight + checks
  9. verify      facts become verified; document marked reviewed
```

### 3.1 Extractor contract

```ts
interface Extractor {
  id: string;                 // 'fidelity.brokerage-statement'
  version: string;            // bumped whenever output could change
  match(doc: DocText): MatchResult;          // deterministic, returns score + reason
  extract(doc: DocText, ctx: AccountLookup): ExtractionOutput;
}

interface ExtractionOutput {
  docType: string;
  institution?: string;
  identityKey?: string;       // e.g. 'fidelity|acct:…4821|2025-12'
  issuedOn?: string; periodStart?: string; periodEnd?: string;
  accounts: AccountHint[];    // identifiers seen in the doc, to be resolved
  facts: ProposedFact[];      // each with concept, value, period, bbox, quotedText
  checks: CheckResult[];      // see below
}
```

Extractors are **pure functions of the text layer** (no clock, no network, no
randomness), versioned, and tested with golden-file fixtures (redacted real
documents → expected JSON). Re-running an extractor on the same input yields the same
output; that's what "deterministic and reviewable" means operationally.

**Cross-checks are the best deterministic confidence signal.** Statements are full
of redundancy: opening balance + activity = closing balance; sum of holdings =
total; this statement's opening = last statement's closing; W-2 box 1 ≤ box 5 (roughly).
Checks that pass are shown in review and can justify "verify all on this document"
in one click. Checks that fail block bulk verification.

The **manual extractor** is just another extractor whose `extract` is the human
drawing boxes; its output flows through the same review/verification path.
An **AI-suggestion extractor**, if ever added, is likewise just another extractor
with `origin = ai_suggestion` — same path, no special trust.

### 3.2 OCR and Hebrew — a significant risk

- OCR: `ocrmypdf` (wraps Tesseract) adds a text layer to scanned PDFs while keeping
  the image, so the same pdf.js position pipeline works for native and scanned pages.
  Install `heb` + `eng` language data. Pin versions: OCR output changes between
  Tesseract versions, which affects determinism — the OCR'd PDF is cached per
  document so re-extraction is stable.
- **Hebrew text extraction from native PDFs is frequently broken**: reversed
  character order, numbers in mixed bidi runs, visual-order encodings in older
  Israeli bank PDFs. This needs a spike with *real documents* before
  committing to Israeli parsers. Mitigation: extractors anchor on numbers + positions
  rather than parsing Hebrew label text where possible; manual extraction always works.
- OCR'd numbers get extra checks (checksum cross-checks matter even more) and the
  review UI shows the image crop next to the OCR text so the human compares glyphs.

### 3.3 Duplicates and revisions

- **Exact duplicate**: same sha256. Reject import, point to existing.
- **Same content, different bytes** (re-download changed PDF metadata): same
  normalized text fingerprint → flag as duplicate; user chooses keep/discard.
- **Same identity, different content**: same `identity_key` (institution + account +
  period + doc type), different text → probably a **revised/corrected** statement
  (e.g., "CORRECTED" 1099). User confirms → `supersedes_document_id` is set, the old
  document's facts become `superseded`, and new facts must be verified. The old
  document and its facts are kept — they explain what was believed before.

---

## 4. Query model

### 4.1 Why an IR instead of "visual builder → SQL"

If the builder generated SQL, saved queries would be SQL, which would break on every
schema change and could never report completeness or evidence. Instead:

```
Visual builder ⇄ Query IR (JSON, versioned) → Engine → { SQL for fact selection,
                                                         completeness evaluation,
                                                         currency conversion,
                                                         evidence graph }
```

The IR deliberately covers a narrow, high-value shape: **select facts of a concept,
for a set of accounts/people chosen by attributes, at an instant or over a period,
aggregated and grouped, converted with an explicit rate policy.** I believe that
covers every example in the brief and most form questions. Things it doesn't cover
go to raw SQL.

### 4.2 IR example — "Total Investment Balance"

```json
{
  "ir": 1,
  "name": "Total investment balance",
  "params": {
    "asOf":       { "type": "date",     "default": "2025-12-31" },
    "owner":      { "type": "person",   "default": "any" },
    "country":    { "type": "country",  "default": "any" },
    "retirement": { "type": "enum", "values": ["include","exclude","only"], "default": "exclude" },
    "currency":   { "type": "currency", "default": "USD" },
    "rateSource": { "type": "rateSource", "default": "us_treasury_reporting" }
  },
  "measure": { "concept": "balance.ending", "at": { "$param": "asOf" } },
  "accounts": {
    "all": [
      { "term": "asset_class/investment" },
      { "term": "tax_treatment/retirement", "mode": { "$param": "retirement" } },
      { "country": { "$param": "country" } },
      { "owner": { "$param": "owner" }, "joint": "full" }
    ]
  },
  "aggregate": "sum",
  "groupBy": ["account"],
  "convert": { "to": { "$param": "currency" }, "rates": { "$param": "rateSource" }, "rateDate": "asOf" },
  "policy": { "unverified": "exclude", "dateToleranceDays": 0, "conflicts": "fail" }
}
```

Parameters with value `any` remove the filter. Saved queries store this definition,
never results. Next year: change `asOf`, run.

### 4.3 Visual builder: a sentence, not a diagram

For a non-programmer, a *sentence builder* beats a node graph:

> Show the **[total ▾]** **[ending balance ▾]**
> of accounts that are **[Investment ×] [not Retirement ×] [+ add condition]**
> owned by **[anyone ▾]**
> as of **[2025-12-31]**
> in **[USD ▾]** using **[US Treasury reporting rate ▾]**
> broken down by **[account ▾]**

Each bracket edits one IR field. A live "accounts in scope" list next to the sentence
shows exactly which accounts match — this is how a non-programmer checks that
"Investment, not Retirement" means what she thinks it means. "Make this a parameter"
is a toggle on any bracket.

### 4.4 Result shape

Every result — not just a number:

```
status: COMPLETE | INCOMPLETE | PROVISIONAL | CONFLICT
total (target currency), subtotals by original currency
rows (per groupBy):
  account, original value + currency, fact date, verification status,
  conversion (rate, rate source, rate date, rate provenance), converted value
completeness:
  missing:   [account, concept, period, reason]   ("no balance for 2025-12-31")
  attested:  [n/a items with notes]
  excluded:  [unverified facts not used]
conflicts:   [two verified facts disagree for the same slot]
evidence:    fact → fact_sources → document page (clickable, opens viewer at bbox)
```

The UI headline for an incomplete result is **"Known verified total: ₪842,318 —
incomplete (2 missing)"**, never a bare number.

### 4.5 Engine semantics (the subtle parts)

- **Instant measures** (balances): for each in-scope account, find verified facts of
  the concept (or concepts whose `generic_concept_id` matches) at exactly `asOf`
  (± tolerance). Zero matches → missing (unless an attestation covers it, e.g.
  account closed before `asOf`). Multiple matching facts with equal values →
  corroborated (shown as such). Different values → conflict; no silent choice.
- **Duration measures** (interest, wages): find a set of verified facts whose periods
  **exactly tile** the requested period without overlap, preferring the highest
  `authority_rank` (1099-INT over sum of monthly statements). Gaps → missing.
  If both a 1099 and monthly statements exist, show the reconciliation difference.
- **Scope** is evaluated with time-ranged relations: ownership and classification
  *as of the query date*, account open/closed status for completeness.
- **Unverified facts** are excluded by default; including them makes the whole
  result `PROVISIONAL`, visibly.

### 4.6 Raw SQL mode

- Runs on a separate read-only connection (`PRAGMA query_only = ON`) against a
  **versioned public view layer** (`q1_facts`, `q1_accounts`, `q1_documents`, …) that
  denormalizes the common joins. Views are the contract; base tables can change.
- If a result set includes a `fact_id` column, every row links to its evidence.
  Otherwise the result is labeled "no evidence chain."
- Completeness is not evaluated for SQL queries, and the UI says so plainly.
- SQL saved queries record which view-API version they target. When `q2_*` ships,
  `q1_*` stays until no saved query uses it.

### 4.7 Saved-query stability across schema changes

- IR references only **stable slugs** (concepts, taxonomy terms, rate sources) and IR
  vocabulary, never tables/columns.
- The IR has its own version; IR upgrades are pure functions `v1 → v2` applied on load,
  tested against every saved query in the user's DB during the app's migration step.
- Concept renames use `deprecated_by`; the engine follows the chain.
- Each saved query keeps a small set of recorded **regression runs** (definition +
  params + result hash); after any migration, the app re-runs them and reports
  differences before the user relies on them.

### 4.8 Snapshots ("what did we send?")

When a result is exported or marked "sent", store a **query snapshot**: IR, params,
the exact fact ids and values used, rates used, result, app version, schema version,
timestamp, label ("CSS Profile 2026–27"). Later corrections don't alter the snapshot;
the app can diff "snapshot vs. re-run today" and show which facts changed. Exports
(PDF/HTML evidence packet) are generated from the snapshot: summary, table, and
cropped page images of each source region.

---

## 5. Currency

```
rate_sources    slug ('boi_representative', 'us_treasury_reporting', 'irs_yearly_avg',
                'manual'), description, publication cadence
exchange_rates  id, source_slug, base, quote, rate (decimal TEXT), rate_date,
                imported_at, source_document_id (nullable), note
```

- Original values are never converted in storage.
- Rates are **imported** (from a CSV the user downloads from BoI / Treasury, or
  typed in with a source document) — no network needed. An optional, opt-in,
  clearly separated "fetch rates" action can come later.
- A conversion in a result records: original value, rate, rate source, rate date,
  rate's own provenance, rounding mode, converted value. Missing rate for the
  requested source/date → conversion missing → result incomplete. No fallback to
  "nearest rate" unless the query policy says so (and then it's shown).
- Treasury reporting rates are quarterly; "rate as of date" must follow each
  source's own rule about which published rate applies. Encode that per source.

---

## 6. Time: tax year vs. calendar year vs. other years

- Facts carry explicit dates. The engine never infers a period from a document's
  issue date (a 1099 for 2025 is issued in 2026; a corrected one maybe in 2027).
- `tax_year` is set on a fact only when the source asserts it.
- US and Israeli individual tax years are both calendar years, so most queries are
  calendar-period queries. School years (Sep–Aug) and employer fiscal years are just
  other date ranges — expose named period presets in the builder
  ("Calendar 2025", "Tax year 2025", "School year 2025–26"), each of which resolves
  to explicit dates in the IR.

---

## 7. Storage layout & consistency

```
FinShark/                       (the "vault"; path configurable)
  finance.db                    SQLite, WAL mode, foreign_keys=ON
  documents/2025/ab/ab12…ef.pdf content-addressed, read-only after import
  cache/                        text layers, OCR output, thumbnails (regenerable)
  inbox/                        optional watched folder
  backups/                      local automatic backups
  vault.json                    vault id, format version
```

DB/filesystem consistency:

- Import order: write file (temp → fsync → rename) **then** insert DB row. A crash
  leaves an orphan file (harmless, swept by the integrity check), never a dangling row.
- Documents are never deleted in normal use; "remove" is a status. Physical deletion
  is an explicit maintenance action that refuses if any fact references the document.
- `Verify vault` (also run before every backup): `PRAGMA integrity_check`,
  `PRAGMA foreign_key_check`, every document row's file exists and its sha256 matches,
  orphan files listed, every fact_source's bbox still contains its `quoted_text`.

SQLite is the right choice here — agreed. Single writer, low write volume, the whole
DB is one file (backup-friendly), and `VACUUM INTO` / the online backup API give a
consistent snapshot without stopping the app. PostgreSQL portability is kept by
(a) using a typed query builder (Kysely) with a dialect, (b) keeping SQLite-specific
JSON functions inside the view layer and the engine's SQL generator, (c) storing
money as integers and dates as ISO-8601 text. Don't spend more than that on it.

---

## 8. Backup format

### 8.1 Format

```
FinShark-2026-10-07T21-14.ffbackup   =  age-encrypted( tar stream )

tar contents:
  MANIFEST.json      format version, app version, schema version, vault id,
                     created_at, file list [{path, size, sha256}], db sha256
  finance.db         consistent snapshot via VACUUM INTO
  documents/…        all document files
  RECOVERY.txt       plain-language manual recovery instructions
```

- **Encryption: `age`** (passphrase mode uses scrypt; payload is chunked
  ChaCha20-Poly1305 with authentication, streaming, so multi-GB archives don't need
  to fit in memory). There is a maintained TypeScript implementation
  (`age-encryption`), and the reference Go CLI lets anyone decrypt with
  `age -d file.ffbackup | tar x` — the backup does not depend on FinShark existing.
  This beats a bespoke libsodium format on recoverability and auditability.
- No compression by default — PDFs are already compressed; optionally zstd later.
- Exclude `cache/` (regenerable).

### 8.2 Operations

- **Create**: verify vault → snapshot DB → stream tar → encrypt → write to
  `*.partial` → fsync → rename → immediately run *Verify* on the written file.
- **Verify**: decrypt in streaming mode (proves the passphrase works and nothing is
  corrupted — age authenticates every chunk), check every file against MANIFEST
  hashes, open the extracted DB copy in a temp dir and run integrity/FK checks,
  confirm every document referenced in the DB is in the archive.
- **Restore**: always into a *new* vault directory; verify; then switch the app to
  it. Never overwrite the current vault in place. Newer-schema backups restored by an
  older app → refuse with a clear message; older-schema → migrate after restore.
- **Automatic**: on a schedule and/or after N verifications, into `backups/`, with
  retention (e.g., keep 7 daily, 8 weekly, 24 monthly). Uses a key that the app can
  use unattended — see below.

### 8.3 Key management — the real risk

A forgotten passphrase means total loss, and *unattended* automatic backups need a
key the app can use without asking.

Recommendation: generate an **age X25519 key pair** for the vault. Backups are
encrypted to the public key (so automatic backups need no secret at all). The
private key is stored (a) in the macOS Keychain for convenience and (b) as a printed
**recovery sheet** (the key, plus RECOVERY.txt instructions) kept in a physical safe,
and optionally (c) a passphrase-encrypted copy of the private key (a small
`vault-key.age` file written next to the backups) so the user can restore with just
the backup, that file and a passphrase. age natively supports
multiple recipients, so adding a second household member's key or an offline recovery key is
trivial. (Note: age's passphrase mode can't be combined with other recipients in the
same file, which is why the key-pair approach is the better primary.)

Encrypted backups can then be copied anywhere the user chooses (external drive,
cloud drive) without trusting that location.

### 8.4 Data at rest (live vault)

Options, in order of recommendation:

1. Rely on FileVault (full-disk encryption) — simplest; the threat it doesn't cover
   is someone with access to your unlocked, logged-in account.
2. Put the vault inside an encrypted APFS disk image that's mounted only while
   using FinShark.
3. SQLCipher for the DB + encrypting documents individually — considerably more
   complexity (OCR tools, pdf.js, previews all need plaintext), so not for v1.

---

## 9. Security & privacy, made technically meaningful

- Server binds to `127.0.0.1` only. Never `0.0.0.0`.
- **Defend against browser-based attacks on localhost**: validate the `Host` header
  (rejects DNS rebinding), require a per-launch random token (the launcher opens the
  browser with it, it becomes a `SameSite=Strict`, `HttpOnly` cookie), reject requests
  with a foreign `Origin`, no CORS headers at all, CSRF token on mutations.
- Strict CSP: `default-src 'self'; connect-src 'self'` — the UI can't talk to
  anything else even if a dependency tried. pdf.js, fonts, everything bundled; no CDNs.
- No outbound network in the core: no HTTP client dependency in core packages; a
  test asserts the server makes no outbound connections during a full import/query/
  backup run.
- **Supply chain is the biggest practical privacy risk** in a Node app: keep
  dependencies few, pin with a lockfile, disable install scripts
  (`ignore-scripts`), review additions. Every dependency is code running with access
  to all your financial data.
- No telemetry, no crash reporting, no update checks in core.
- Optional external features (rate fetching, AI extraction) live in a separate,
  off-by-default module with a visible indicator when enabled.

---

## 10. Technology choices

| Concern | Choice | Why |
|---|---|---|
| Runtime | Node (LTS) + TypeScript | as proposed |
| SQLite driver | `better-sqlite3` (or built-in `node:sqlite` if stable enough by then) | synchronous, fast, online backup API |
| Query building | Kysely | typed, dialect-portable |
| Decimal math | `decimal.js` (or big.js) | no floats near money |
| PDF render + text positions | `pdfjs-dist` in both server and browser | one coordinate system for extraction and highlighting |
| OCR | `ocrmypdf` + Tesseract (`eng`, `heb`), external, optional | adds text layer, keeps image |
| Backup encryption | `age-encryption` (TS) + tar stream | recoverable with standard tools |
| UI | React + a plain component kit; pdf.js viewer with bbox overlay | |
| Packaging (later) | single launcher script; maybe Tauri/Electron later | not needed for v1 |

---

## 11. Vertical slice (v0)

Exactly as you proposed, with manual extraction first:

1. Create vault; add 2 people, 2 institutions, 3 accounts (one ILS), classifications.
2. Import one representative year-end statement (PDF): hash, store, text layer,
   duplicate check.
3. **Manual extraction**: draw a box → propose `balance.ending` (instant) and
   `statement.interest_paid` (duration) facts with bbox + quoted text.
4. Verification queue: verify one, correct the other (exercise supersession).
5. Add one ILS balance fact manually from a second PDF, and one Treasury rate row.
6. Run the IR query "Total balance as of {asOf} in {currency}" → result shows
   conversion details, evidence links that open the PDF at the highlighted box, and
   an INCOMPLETE status for the third account that has no fact.
7. Save it as a parameterized query; re-run with a different date.
8. Snapshot + export evidence packet (HTML is fine for v0).
9. Create encrypted backup; verify; restore into a fresh vault directory; re-run the
   saved query and get the identical result hash.
10. Localhost security baseline (Host check, token, CSP) from day one — it's cheap
    early and painful to retrofit.

Then: first automatic parser (pick the highest-volume document you have), the
sentence-style query builder, duration "tiling" semantics, the Hebrew spike, raw
SQL mode.

---

## 12. Risk register

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | Verification burden makes the wife abandon the system | High | lazy extraction (C3), cross-check-based bulk verify, manual extraction UX polish |
| 2 | Hebrew/bidi text extraction unusable | High | early spike on real docs; position-anchored extractors; manual fallback |
| 3 | Double counting across overlapping sources | High | generic concepts + authority rank + exact tiling + reconciliation display |
| 4 | Backup key loss | High | key pair + Keychain + printed recovery sheet + restore drill |
| 5 | Localhost exposure to web pages | High | §9 from day one |
| 6 | Concept vocabulary sprawl | Medium | registry governance, generic-concept mapping, deprecation not deletion |
| 7 | Saved queries silently change meaning after migration | Medium | IR versioning + upgrade functions + regression runs |
| 8 | Parser maintenance when layouts change | Medium | extractor versions, match() refuses unknown layouts, golden tests, manual fallback |
| 9 | Account identity changes (mergers, rollovers) | Medium | identifiers with validity + account_links |
| 10 | Over-building the query builder | Medium | IR covers one shape well; SQL escape hatch for the rest |
| 11 | OCR misreads digits | Medium | image crop beside value in review; arithmetic cross-checks |
| 12 | npm supply chain | Medium | minimal deps, ignore-scripts, lockfile review |

---

## 13. Open questions for you

1. ~~Who uses it, on what?~~ **Answered: one shared Mac.** See §14.
   The household members share one macOS login.
2. ~~Volume & mix~~ **Answered: several dozen documents a year, about a third in
   Hebrew; mostly digital PDFs, few scans.** See §14 D2.
3. **Which workflows first?** CSS Profile / school aid, US return, FBAR/8938, Israeli
   return — each implies the first ~20 concepts and which rate sources matter.
4. ~~UI language~~ **Answered: Hebrew labels for Israeli documents and accounts,
   English for American ones; app menus and buttons in English.** See §14 D3.
   Exports: source language by default, with an "English export" option.
5. ~~Holdings level~~ **Answered: account-level balances are enough.** See §14 D5.
6. Can you share 2–3 representative (even redacted) documents — one US statement, one
   Israeli pension report, one scanned doc — for the extraction spike?

---

## 14. Decisions log

### D1. Deployment: one shared Mac (2026-10-14)

Consequences:

- **Localhost-only holds.** No LAN exposure, no network auth, no sync. §9's browser
  defenses (Host check, launch token, CSP) are still required.
- **One vault, one server process, one writer.** The launcher refuses to start a
  second server against the same vault (lock file in the vault directory holding
  the PID).
- **"Who did this" is attribution, not security.** The app asks "who's using
  FinShark?" (a person from `people`) and records it in `verified_by` and
  `fact_events.actor`. It isn't a password login. Everyone using the machine can see everything.
  The protection boundary is the Mac itself.
- **One shared macOS login (confirmed 2026-10-14).** The vault lives in that
  user's home directory (default `~/FinShark`), the backup key goes in that user's
  Keychain, and no shared-folder permissions are needed. Since macOS can't tell the
  users apart, attribution relies entirely on the in-app "who's using FinShark?"
  choice.
- **The live vault is protected by FileVault.** Anyone who can log in to the Mac can
  read the vault. That's accepted for a shared household machine.

### D2. Volume: several dozen documents a year, about a third in Hebrew (2026-10-14)

Roughly 40–60 documents a year, of which roughly 15–20 are in Hebrew.

Consequences:

- **Manual extraction is the main path, not a fallback.** At a few documents a week
  in tax season, and probably 3–8 facts each, drawing boxes is a few hours a year.
  Most institutions send 1–4 documents a year, so a parser would rarely pay for
  itself. Parsers are deferred until a document type clearly repeats often (e.g.,
  monthly pay stubs, if those are imported). Re-evaluate after one year of real use.
- **Effort goes into the manual-extraction UX instead.** Highest-value features:
  - Draw a box and the app reads the number under it from the text layer
    (or OCR), so the user confirms rather than types.
  - "Same as last year": for a document from a known account, suggest the
    concepts extracted from that account's previous document of the same type,
    and the regions they came from as a starting point.
  - Keyboard-driven review queue.
- **Hebrew no longer blocks the plan.** It mattered mainly for parsers. For manual
  extraction, the only Hebrew-sensitive part is reading the number inside a box,
  and digits are usually extracted correctly even when surrounding Hebrew text is
  reversed. The Hebrew spike shrinks to: (a) do numbers in drawn boxes read
  correctly from Israeli PDFs, and (b) does `ocrmypdf` with `heb+eng` produce
  usable digits on scanned Israeli documents.
- **Classification can stay simple.** With dozens of documents, the import step can
  ask the user "which institution / account / type is this?" with smart defaults
  (filename, matching account number found in the text, last document from the
  same sender) instead of an automatic classifier.
- **Bilingual labels matter.** A third of the source material is Hebrew, so
  concept and taxonomy labels should carry both `label_en` and `label_he` from day
  one (the schema already does). Which one the UI shows is open question 4.
- **Scale is not a concern.** A decade of data is a few hundred documents and a few
  thousand facts. SQLite, full-table scans and in-memory evaluation are all fine.
  Don't add indexes, caching or pagination until something is measurably slow.

### D3. Label language follows the source, not a global setting (2026-10-14)

Israeli documents and accounts are labeled in Hebrew; American ones in English.
Labels match the language printed on the source documents, so what the app shows
looks like what's on the paper.

Model changes:

- `institutions.language`, `accounts.language`, `documents.language`
  (`he` | `en`). Defaults: an account inherits from its institution, an institution
  from its country (IL → `he`, US → `en`), a document from its account. All
  overridable (e.g., an English-language statement from an Israeli bank).
- Account and institution names are stored in their own language. An optional
  `alt_name` holds the other language for when it's needed (see exports below).
- Concepts and taxonomy terms keep both `label_en` and `label_he`. Which one is shown
  depends on context:
  - Jurisdiction-specific concepts (`il.*`) show Hebrew, `us.*` show English.
  - Generic concepts (e.g. `balance.ending`) show in the language of the account
    or document they're displayed next to. "יתרה לסוף תקופה" on an Israeli account row,
    "Ending balance" on a US brokerage row.
  - Where there is no single account (query totals, the query builder itself),
    English is used.
- The app's own interface (menus, buttons, headings, query builder, totals) is
  English, and the page layout is left-to-right. Hebrew appears only inside data:
  account names, labels, document titles, cell contents.
- Pickers that list concepts or terms (query builder, extraction) show the English
  label, with the Hebrew label beside it for Israeli concepts, so either name can
  be found by typing.

Rendering:

- Mixed Hebrew/English tables are normal (e.g. a total across all accounts). Each
  cell sets `dir="auto"` so Hebrew renders right-to-left and English left-to-right
  inside an otherwise single-direction layout.
- Numbers and currency inside Hebrew text are wrapped in `<bdi>` (bidirectional
  isolation) so "₪42,318" and dates don't get reordered. This is a known source of
  bugs; it needs a test page with mixed rows from the start.
- Formatting of a number follows its currency, not the label language
  (₪42,318.00, $83,421.17).

Exports (decided 2026-10-14):

- An evidence packet for a US tax preparer or a US school will contain Israeli
  accounts with Hebrew names and Hebrew source pages. The preparer may not read
  Hebrew. Proposal: exports default to the source language like the app, with an
  "English export" option that uses `alt_name` and `label_en`, keeps the original
  Hebrew in parentheses, and leaves the source page images as they are.
- Implication: an English export needs an English name for every Israeli account
  and institution it includes. If `alt_name` is missing, the export step lists the
  missing names and asks for them before generating, rather than falling back
  silently to Hebrew.

### D4. Source documents are mostly digital PDFs (2026-10-14)

Most documents are downloaded PDFs with a real text layer; scans are the exception.

Consequences:

- **OCR is deferred out of the vertical slice and v1.** Drawing a box on a digital
  PDF reads the number straight from the text layer.
- **Scans still work without OCR.** A page with no text layer is shown as an image,
  the user draws a box and types the value. The fact gets the same page and
  bounding-box provenance; `quoted_text` is empty and the fact is marked
  `text_source = none`, so the review UI shows the image crop next to the typed
  value for checking.
- **OCR is added later only if typing on scans becomes a real burden.** When it is,
  it's an import step (`ocrmypdf`, `heb+eng`) that adds a text layer, and nothing
  else in the pipeline changes.
- **The Hebrew test narrows to digital PDFs:** do the digits inside a drawn box read
  correctly from real Israeli bank and pension PDFs? That is the first technical
  check to run once sample documents are available.

### D5. Account-level balances only; no per-security holdings (2026-10-14)

Questions are answered from account totals (e.g., a brokerage account's ending
market value). There is no need to record individual securities, share counts or
prices.

Consequences:

- No holdings, securities or price tables. No `holding` dimension in the slice.
- Concepts needing share quantities or unit prices aren't seeded, so v1 money is
  integer minor units only; `value_decimal` is used only for exchange rates.
- Questions like "stocks vs. bonds" are answered at the account level by
  classifying whole accounts (e.g., a bond fund account tagged
  `asset_class/fixed_income`).
- If this changes later, holdings fit the existing model as facts with a
  `holding` dimension; no redesign is needed.

### D6. Text-layer check on real documents passed (2026-10-14)

`spikes/pdf-text-check` was run on three real documents: an Israeli pension annual
report (Hebrew, 3 pages), an Israeli bank statement (Hebrew, 2 pages) and a 2025 W-2.

- Every amount checked was read correctly as a single text item. No reversed
  digits, no pages without a text layer. One number in the pension report was
  split across text items (the app joins adjacent numeric items inside a box).
- Conclusion: box-to-read manual extraction works for these producers without
  OCR or Hebrew-specific handling. New institutions should be spot-checked with
  the same script as they're added.
- The W-2 PDF prints the same form several times on one page (copies B, C, 2),
  so each amount appears three times. Implications:
  - A fact's provenance is the specific box the user drew, not "where this number
    appears". Searching the page for a value is not a valid way to locate it.
  - Extracting a value once is correct; the repeated copies are not separate facts.
    The "same as last year" suggestion should reuse the region the user picked last
    time, so it lands on the same copy.

### D7. Implementation stack and terminology (2026-10-14)

Supersedes parts of §7 and §10.

- Node 24 LTS, TypeScript run directly by Node (type stripping; erasable syntax only).
- SQLite via Node's built-in `node:sqlite` instead of `better-sqlite3`: no native
  build step (install scripts stay disabled) and one dependency fewer. It includes
  an online `backup()` API.
- **No Kysely.** There is no maintained Kysely dialect for `node:sqlite`, and plain
  SQL behind small typed functions is enough at this scale. PostgreSQL portability
  stays a soft goal: ISO dates as TEXT, money as INTEGER, SQLite-specific SQL kept
  inside `server/src/db` and the query compiler.
- Installed versions (pinned): TypeScript 7, Vitest 5, Fastify 5, pdfjs-dist 6,
  age-encryption 0.3, tar-stream 3, decimal.js 10, React 19, Vite 8.
- "Query IR" is renamed **query definition** in code and from here on.
- Initial schema: `server/src/db/migrations/001_initial.sql`. Vault layout:
  `server/src/vault/layout.ts`.

### D8. A fact must carry the subject its concept requires (2026-10-14)

An ending balance with no account is not a fact, it's a loose number. Each concept
declares a `subject`: `account` (balances, interest, status attestations, 1099-INT,
Form 867, pension savings) or `person` (W-2 wages, federal withholding). Creating or
correcting a fact is refused (`subject_required`) unless the matching `account_id` or
`person_id` is present. Enforced in `prepareFact`, not by a table CHECK, because
facts are append-only and rows written before migration 003 may lack it; those stay
readable. New concepts default to `account`.

### D9. Every account has at least one current owner (2026-10-14)

Ownership stays the time-ranged `account_owners` relation (§2.2). Creating an account
through the API requires `owners` (one or more people, each with a role defaulting to
`owner` and an optional exact-decimal `share`). `PUT /api/accounts/:id/owners` replaces
the current set and refuses an empty one; owners who drop out keep their row with
`valid_to` set to today, so history is preserved. The "at least one" rule is enforced
in the API, not the schema, because accounts created before this decision have no owner
rows; they show as "none recorded" and can be fixed from the Accounts page.

### D10. Accounts have a descriptive type (2026-10-15)

`accounts.account_type` says what kind of product an account is: checking, savings,
fixed deposit, investment, pension, provident fund, keren hishtalmut, credit card, loan,
mortgage, insurance or other. The list is `ACCOUNT_TYPES` in `shared/src/api.ts`. It is
validated by the API, not a CHECK, so adding a value needs no table rebuild, and it is
nullable because earlier accounts have none. The Add account form requires a type;
existing accounts can be given one with Edit (`PUT /api/accounts/:id/type`).

It is a label, not a classification. Whether something is retirement savings, or how
it is taxed or counted for aid, stays in taxonomies (C5); queries should not infer
those from the type. "Pension" and "keren hishtalmut" say what the product is, not how a
filing treats it.

### D11. Numbers are verified when they are added; the Review page is gone (2026-10-19)

Drawing a box around a number and saving it is the human check, so the web app now
verifies it straight away. It still goes through the same two steps on the server:
`POST /api/facts` (or `/api/attestations`) records a `proposed` fact, then the app calls
`POST /api/facts/:id/verify`, so the fact history shows both events and the API is
unchanged. The Review queue page, its route and its keyboard shortcuts were removed;
`GET /api/review-queue` remains.

If a different value is already verified for the same slot, verification returns the
usual 409 conflict. The fact stays `proposed`, the add panel says so and links to it,
and the fact page offers Verify (retry), Correct, and Reopen for rejected facts.
The fact page's "Delete this number" button rejects a proposed or verified fact with a required reason; facts are never physically deleted, and a rejected fact can be reopened.
Queries still exclude unverified facts by default, so a conflicted fact is surfaced,
not silently used.

### D12. Institutions are financial institutions or employers (2026-10-20)

`institutions.kind` is `financial` (bank, broker, fund, insurer: it holds accounts) or
`employer` (it issues pay documents such as payslips and W-2s). The list is
`INSTITUTION_KINDS` in `shared/src/api.ts`, validated by the API, not a CHECK. It is
nullable because earlier institutions have none, and we do not guess: the Institutions
table shows "Not set" and the kind can be changed there (`PUT /api/institutions/:id/kind`).
The Add institution form requires a kind. The Add account picker lists only institutions
that are not employers. Documents can still be linked to either kind.

### D13. People are account owners, app users, or both (2026-10-20)

`people.owns_accounts` and `people.uses_app` are two flags on one list, not two lists. A
person who owns accounts can be an account owner and the subject of person-level facts
(W-2 wages). A person who uses the app can be chosen as "who's using FinShark?" and so
appears in `verified_by` and `fact_events.actor`. A person can be both (the usual case for
the adults), only an owner (a child with a savings account), or only a user (a helper).
Keeping one row means history and ownership refer to the same person.

At least one flag must be set. The API refuses an owner who does not own accounts, a session
person who does not use the app, removing `owns_accounts` from a current owner of an account
(change the owners first), and removing `uses_app` from the person using the app right now.
Existing people got both flags (migration 007). Names in history and owner lists still resolve
for everyone; only the pickers are filtered.
