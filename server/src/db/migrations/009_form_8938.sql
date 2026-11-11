-- Form 8938 data layer (DESIGN D21).

-- Per calendar year: how the household files and where it lives. FinShark records the
-- answers; it does not decide residence. filing_status is checked by the API against
-- FILING_STATUSES in shared/src/api.ts, not a CHECK, so the list can grow. Only
-- 'married_joint' is supported by the report; the others are storable so the report can
-- say "unsupported" instead of guessing. abroad_8938: 1 = meets a presence-abroad test,
-- 0 = lives in the US, NULL = not set for the year (the report then tests both).
-- Plain mutable rows, not evidence.
CREATE TABLE tax_years (
  year          INTEGER PRIMARY KEY,   -- calendar year
  filing_status TEXT,
  abroad_8938   INTEGER CHECK (abroad_8938 IN (0, 1)),
  updated_at    TEXT NOT NULL
);

-- How Form 8938 treats an account, attached through account_terms (validity dates are
-- inclusive ISO dates, NULL = unbounded). The classification in effect for tax year Y is
-- the us_8938 row whose range contains Y-12-31.
INSERT INTO taxonomies (id, label_en, label_he) VALUES
  ('us_8938', 'Form 8938', 'טופס 8938');

INSERT INTO terms (id, taxonomy_id, parent_term_id, label_en, label_he) VALUES
  ('us_8938/financial_account', 'us_8938', NULL, 'Foreign financial account', 'חשבון פיננסי זר'),
  ('us_8938/pension_plan', 'us_8938', NULL, 'Foreign pension or deferred compensation plan', 'תוכנית פנסיה או שכר נדחה זרה'),
  ('us_8938/not_reportable', 'us_8938', NULL, 'Not reportable', 'לא לדיווח'),
  ('us_8938/ask_preparer', 'us_8938', NULL, 'Ask the preparer', 'לשאול את מכין הדוחות');

-- Why an account is not reportable. Required by the API when the term is
-- us_8938/not_reportable, otherwise NULL.
ALTER TABLE account_terms ADD COLUMN reason TEXT;
