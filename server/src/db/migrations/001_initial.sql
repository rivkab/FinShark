-- FinShark initial schema. See docs/DESIGN.md §2, §3, §4.8, §5, §14.
-- Conventions:
--   * Dates are ISO-8601 TEXT ('2025-12-31'); timestamps are ISO-8601 UTC TEXT.
--   * Money is INTEGER minor units (cents/agorot) + ISO 4217 currency. Never REAL.
--   * Exact decimals (exchange rates) are TEXT, computed with decimal.js.
--   * Stable identifiers that saved queries reference (concepts, taxonomies,
--     terms, rate sources) are TEXT slugs, never renamed or deleted.
--   * Tables marked APPEND-ONLY are never UPDATEd or DELETEd by application code,
--     except the status columns noted.

-- ---------------------------------------------------------------- people, institutions, accounts

CREATE TABLE people (
  id            INTEGER PRIMARY KEY,
  display_name  TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE institutions (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,          -- in the institution's own language
  alt_name      TEXT,                   -- the other language, for English exports
  country       TEXT NOT NULL,          -- ISO 3166-1 alpha-2: 'US', 'IL'
  language      TEXT NOT NULL CHECK (language IN ('en', 'he')),
  metadata      TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata)),
  created_at    TEXT NOT NULL
);

CREATE TABLE accounts (
  id                 INTEGER PRIMARY KEY,
  institution_id     INTEGER NOT NULL REFERENCES institutions(id),
  display_name       TEXT NOT NULL,
  alt_name           TEXT,
  country            TEXT NOT NULL,
  language           TEXT NOT NULL CHECK (language IN ('en', 'he')),
  native_currency    TEXT NOT NULL,
  opened_on          TEXT,
  closed_on          TEXT,
  statement_cadence  TEXT CHECK (statement_cadence IN ('monthly', 'quarterly', 'semiannual', 'annual', 'irregular')),
  metadata           TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata)),
  created_at         TEXT NOT NULL
);

CREATE TABLE account_identifiers (
  id          INTEGER PRIMARY KEY,
  account_id  INTEGER NOT NULL REFERENCES accounts(id),
  kind        TEXT NOT NULL,            -- 'last4', 'full_hash', 'iban', 'policy_no', ...
  value       TEXT NOT NULL,
  valid_from  TEXT,
  valid_to    TEXT
);

CREATE TABLE account_owners (
  id          INTEGER PRIMARY KEY,
  account_id  INTEGER NOT NULL REFERENCES accounts(id),
  person_id   INTEGER NOT NULL REFERENCES people(id),
  role        TEXT NOT NULL CHECK (role IN ('owner', 'joint', 'custodian', 'beneficiary', 'participant')),
  share       TEXT,                     -- decimal fraction '0.5'; NULL = unspecified
  valid_from  TEXT,
  valid_to    TEXT
);

CREATE TABLE account_links (
  id             INTEGER PRIMARY KEY,
  from_account   INTEGER NOT NULL REFERENCES accounts(id),
  to_account     INTEGER NOT NULL REFERENCES accounts(id),
  kind           TEXT NOT NULL CHECK (kind IN ('successor', 'renumbered', 'sub_account_of', 'rolled_over_to')),
  effective_on   TEXT
);

-- ---------------------------------------------------------------- classifications

CREATE TABLE taxonomies (
  id        TEXT PRIMARY KEY,           -- slug: 'asset_class', 'tax_treatment', ...
  label_en  TEXT NOT NULL,
  label_he  TEXT
);

CREATE TABLE terms (
  id              TEXT PRIMARY KEY,     -- '<taxonomy>/<slug>': 'asset_class/investment'
  taxonomy_id     TEXT NOT NULL REFERENCES taxonomies(id),
  parent_term_id  TEXT REFERENCES terms(id),
  label_en        TEXT NOT NULL,
  label_he        TEXT
);

CREATE TABLE account_terms (
  id          INTEGER PRIMARY KEY,
  account_id  INTEGER NOT NULL REFERENCES accounts(id),
  term_id     TEXT NOT NULL REFERENCES terms(id),
  valid_from  TEXT,
  valid_to    TEXT
);

-- ---------------------------------------------------------------- documents

CREATE TABLE documents (
  id                      INTEGER PRIMARY KEY,
  sha256                  TEXT NOT NULL UNIQUE,   -- lowercase hex of the file bytes
  stored_path             TEXT NOT NULL UNIQUE,   -- relative to the vault root
  original_filename       TEXT NOT NULL,
  byte_size               INTEGER NOT NULL,
  mime                    TEXT NOT NULL,
  page_count              INTEGER,
  imported_at             TEXT NOT NULL,
  doc_type                TEXT REFERENCES terms(id),
  institution_id          INTEGER REFERENCES institutions(id),
  language                TEXT CHECK (language IN ('en', 'he')),
  issued_on               TEXT,
  period_start            TEXT,
  period_end              TEXT,
  tax_year                INTEGER,
  identity_key            TEXT,                   -- institution|account|period|type
  text_fingerprint        TEXT,                   -- sha256 of normalized text
  supersedes_document_id  INTEGER REFERENCES documents(id),
  status                  TEXT NOT NULL DEFAULT 'inbox'
                            CHECK (status IN ('inbox', 'reviewed', 'removed')),
  metadata                TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata))
);
CREATE INDEX documents_identity_key ON documents(identity_key);
CREATE INDEX documents_text_fingerprint ON documents(text_fingerprint);

CREATE TABLE document_accounts (
  document_id  INTEGER NOT NULL REFERENCES documents(id),
  account_id   INTEGER NOT NULL REFERENCES accounts(id),
  PRIMARY KEY (document_id, account_id)
);

CREATE TABLE document_pages (
  document_id  INTEGER NOT NULL REFERENCES documents(id),
  page_no      INTEGER NOT NULL,          -- 1-based
  width_pt     REAL NOT NULL,             -- page geometry, not money
  height_pt    REAL NOT NULL,
  rotation     INTEGER NOT NULL DEFAULT 0 CHECK (rotation IN (0, 90, 180, 270)),
  text_source  TEXT NOT NULL CHECK (text_source IN ('native', 'ocr', 'none')),
  text_sha256  TEXT,
  PRIMARY KEY (document_id, page_no)
);

-- ---------------------------------------------------------------- concepts

CREATE TABLE concepts (
  id                  TEXT PRIMARY KEY,   -- 'balance.ending', 'us.w2.box1_wages', ...
  label_en            TEXT NOT NULL,
  label_he            TEXT,
  description         TEXT,
  period_type         TEXT NOT NULL CHECK (period_type IN ('instant', 'duration', 'none')),
  value_type          TEXT NOT NULL CHECK (value_type IN ('money', 'decimal', 'integer', 'text', 'date', 'boolean')),
  generic_concept_id  TEXT REFERENCES concepts(id),
  jurisdiction        TEXT,               -- 'US', 'IL', or NULL for generic
  authority_rank      INTEGER NOT NULL DEFAULT 0,
  deprecated_by       TEXT REFERENCES concepts(id)
);

-- ---------------------------------------------------------------- extraction and facts

-- APPEND-ONLY except status/finished_at/checks/log while a run is in progress.
CREATE TABLE extraction_runs (
  id                  INTEGER PRIMARY KEY,
  document_id         INTEGER NOT NULL REFERENCES documents(id),
  extractor_id        TEXT NOT NULL,      -- 'manual', 'fidelity.brokerage-statement', ...
  extractor_version   TEXT NOT NULL,
  input_text_sha256   TEXT,
  started_at          TEXT NOT NULL,
  finished_at         TEXT,
  status              TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  checks              TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(checks)),
  log                 TEXT
);

-- APPEND-ONLY except: status, verified_at, verified_by. Corrections create a new
-- row with supersedes_fact_id set; the old row's status becomes 'superseded'.
CREATE TABLE facts (
  id                  INTEGER PRIMARY KEY,
  concept_id          TEXT NOT NULL REFERENCES concepts(id),
  account_id          INTEGER REFERENCES accounts(id),
  person_id           INTEGER REFERENCES people(id),
  value_minor         INTEGER,            -- money
  value_decimal       TEXT,               -- exact decimal string
  value_text          TEXT,
  currency            TEXT,
  instant_date        TEXT,
  period_start        TEXT,
  period_end          TEXT,               -- inclusive
  tax_year            INTEGER,
  dimensions          TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(dimensions)),
  status              TEXT NOT NULL CHECK (status IN ('proposed', 'verified', 'rejected', 'superseded')),
  origin              TEXT NOT NULL CHECK (origin IN ('parser', 'manual', 'user_correction', 'attestation', 'derived', 'ai_suggestion')),
  extraction_run_id   INTEGER REFERENCES extraction_runs(id),
  supersedes_fact_id  INTEGER REFERENCES facts(id),
  derivation          TEXT CHECK (derivation IS NULL OR json_valid(derivation)),
  note                TEXT,
  created_at          TEXT NOT NULL,
  created_by          INTEGER REFERENCES people(id),
  verified_at         TEXT,
  verified_by         INTEGER REFERENCES people(id),
  CHECK (value_minor IS NULL OR currency IS NOT NULL),
  CHECK (origin <> 'attestation' OR note IS NOT NULL),
  CHECK ((instant_date IS NULL) OR (period_start IS NULL AND period_end IS NULL)),
  CHECK ((period_start IS NULL) = (period_end IS NULL))
);
CREATE INDEX facts_concept_account ON facts(concept_id, account_id);
CREATE INDEX facts_status ON facts(status);

-- APPEND-ONLY.
CREATE TABLE fact_sources (
  id           INTEGER PRIMARY KEY,
  fact_id      INTEGER NOT NULL REFERENCES facts(id),
  document_id  INTEGER NOT NULL REFERENCES documents(id),
  page_no      INTEGER,
  bbox         TEXT CHECK (bbox IS NULL OR json_valid(bbox)),   -- [x0,y0,x1,y1] PDF points, unrotated
  quoted_text  TEXT,                       -- text inside bbox at extraction time; NULL if no text layer
  locator      TEXT CHECK (locator IS NULL OR json_valid(locator))  -- CSV/OFX row locator
);
CREATE INDEX fact_sources_fact ON fact_sources(fact_id);
CREATE INDEX fact_sources_document ON fact_sources(document_id);

-- APPEND-ONLY audit log.
CREATE TABLE fact_events (
  id       INTEGER PRIMARY KEY,
  fact_id  INTEGER NOT NULL REFERENCES facts(id),
  at       TEXT NOT NULL,
  actor    INTEGER REFERENCES people(id),
  event    TEXT NOT NULL CHECK (event IN ('proposed', 'verified', 'corrected', 'rejected', 'superseded', 'reopened')),
  payload  TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload))
);
CREATE INDEX fact_events_fact ON fact_events(fact_id);

-- ---------------------------------------------------------------- currency

CREATE TABLE rate_sources (
  id           TEXT PRIMARY KEY,           -- 'boi_representative', 'us_treasury_reporting', ...
  label_en     TEXT NOT NULL,
  description  TEXT,
  cadence      TEXT NOT NULL CHECK (cadence IN ('daily', 'quarterly', 'yearly', 'manual'))
);

CREATE TABLE exchange_rates (
  id                  INTEGER PRIMARY KEY,
  source_id           TEXT NOT NULL REFERENCES rate_sources(id),
  base                TEXT NOT NULL,       -- 1 base = rate quote
  quote               TEXT NOT NULL,
  rate                TEXT NOT NULL,       -- exact decimal string
  rate_date           TEXT NOT NULL,
  source_document_id  INTEGER REFERENCES documents(id),
  note                TEXT,
  imported_at         TEXT NOT NULL,
  UNIQUE (source_id, base, quote, rate_date)
);

-- ---------------------------------------------------------------- queries

CREATE TABLE saved_queries (
  id               INTEGER PRIMARY KEY,
  name             TEXT NOT NULL,
  description      TEXT,
  kind             TEXT NOT NULL CHECK (kind IN ('definition', 'sql')),
  format_version   INTEGER NOT NULL,       -- query-definition format, or SQL view-API version
  definition       TEXT NOT NULL,          -- JSON query definition, or SQL text
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

-- APPEND-ONLY. Frozen results that were exported or sent somewhere (§4.8).
CREATE TABLE query_snapshots (
  id               INTEGER PRIMARY KEY,
  saved_query_id   INTEGER REFERENCES saved_queries(id),
  label            TEXT NOT NULL,
  definition       TEXT NOT NULL,
  params           TEXT NOT NULL CHECK (json_valid(params)),
  result           TEXT NOT NULL CHECK (json_valid(result)),
  fact_ids         TEXT NOT NULL CHECK (json_valid(fact_ids)),
  app_version      TEXT NOT NULL,
  schema_version   INTEGER NOT NULL,
  created_at       TEXT NOT NULL,
  created_by       INTEGER REFERENCES people(id)
);
