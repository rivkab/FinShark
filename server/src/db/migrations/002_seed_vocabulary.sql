-- Starting vocabulary. See docs/DESIGN.md §2.4, §14 D3. Seed rows are stable slugs:
-- never renamed or deleted, only deprecated. Users may add their own.

-- ---------------------------------------------------------------- concepts
-- Generic concepts first so generic_concept_id references resolve.

INSERT INTO concepts (id, label_en, label_he, description, period_type, value_type, generic_concept_id, jurisdiction, authority_rank) VALUES
  ('balance.ending', 'Ending balance', 'יתרה לסוף תקופה', 'Balance of an account at the end of a period.', 'instant', 'money', NULL, NULL, 0),
  ('income.interest', 'Interest income', 'הכנסות ריבית', 'Interest earned over a period, from any source.', 'duration', 'money', NULL, NULL, 0),
  ('income.wages', 'Wages', 'שכר', 'Wages, salaries and tips over a period.', 'duration', 'money', NULL, NULL, 0),
  ('tax.withheld.us_federal', 'US federal income tax withheld', 'מס פדרלי אמריקאי שנוכה במקור', 'US federal income tax withheld over a period.', 'duration', 'money', NULL, NULL, 0),
  ('status.account_closed', 'Account closed', 'החשבון נסגר', 'Attestation that the account was closed as of the date.', 'instant', 'boolean', NULL, NULL, 0),
  ('status.no_document_issued', 'No document issued', 'לא הונפק מסמך', 'Attestation that the institution issued no document for the period.', 'duration', 'boolean', NULL, NULL, 0);

INSERT INTO concepts (id, label_en, label_he, description, period_type, value_type, generic_concept_id, jurisdiction, authority_rank) VALUES
  ('statement.interest_paid', 'Interest paid (statement)', 'ריבית ששולמה (דף חשבון)', 'Interest shown on a periodic statement; not an official tax figure.', 'duration', 'money', 'income.interest', NULL, 10),
  ('us.1099int.box1', 'Form 1099-INT, Box 1: Interest income', NULL, 'Interest income reported to the IRS on Form 1099-INT.', 'duration', 'money', 'income.interest', 'US', 100),
  ('il.f867.interest', 'Form 867: Interest', 'טופס 867 - ריבית', 'Interest reported on Israeli Form 867 (אישור ניכוי מס במקור).', 'duration', 'money', 'income.interest', 'IL', 100),
  ('us.w2.box1_wages', 'Form W-2, Box 1: Wages, tips, other compensation', NULL, 'Taxable wages reported on Form W-2.', 'duration', 'money', 'income.wages', 'US', 100),
  ('us.w2.box2_fed_withheld', 'Form W-2, Box 2: Federal income tax withheld', NULL, 'Federal income tax withheld as reported on Form W-2.', 'duration', 'money', 'tax.withheld.us_federal', 'US', 100),
  ('il.pension.accrued_savings', 'Pension accrued savings', 'סך חיסכון צבור', 'Accumulated savings in an Israeli pension or provident fund at a date.', 'instant', 'money', 'balance.ending', 'IL', 50);

-- ---------------------------------------------------------------- taxonomies and terms

INSERT INTO taxonomies (id, label_en, label_he) VALUES
  ('asset_class', 'Asset class', 'סוג נכס'),
  ('tax_treatment', 'Tax treatment', 'יחס מס'),
  ('doc_type', 'Document type', 'סוג מסמך');

INSERT INTO terms (id, taxonomy_id, parent_term_id, label_en, label_he) VALUES
  ('asset_class/cash', 'asset_class', NULL, 'Cash', 'מזומן'),
  ('asset_class/investment', 'asset_class', NULL, 'Investment', 'השקעות'),
  ('asset_class/fixed_income', 'asset_class', NULL, 'Fixed income', 'הכנסה קבועה'),
  ('asset_class/real_estate', 'asset_class', NULL, 'Real estate', 'נדל"ן'),
  ('asset_class/other', 'asset_class', NULL, 'Other', 'אחר'),
  ('tax_treatment/taxable', 'tax_treatment', NULL, 'Taxable', 'חייב במס'),
  ('tax_treatment/retirement', 'tax_treatment', NULL, 'Retirement', 'פנסיה'),
  ('tax_treatment/tax_advantaged_savings', 'tax_treatment', NULL, 'Tax-advantaged savings', 'חיסכון מוטב מס'),
  ('tax_treatment/education', 'tax_treatment', NULL, 'Education', 'חיסכון לימודים'),
  ('doc_type/statement', 'doc_type', NULL, 'Statement', 'דף חשבון'),
  ('doc_type/annual_statement', 'doc_type', 'doc_type/statement', 'Annual statement', 'דוח שנתי'),
  ('doc_type/tax_form', 'doc_type', NULL, 'Tax form', 'טופס מס'),
  ('doc_type/pay_stub', 'doc_type', NULL, 'Pay stub', 'תלוש שכר'),
  ('doc_type/pension_report', 'doc_type', NULL, 'Pension report', 'דוח פנסיה'),
  ('doc_type/other', 'doc_type', NULL, 'Other', 'אחר');

-- ---------------------------------------------------------------- rate sources

INSERT INTO rate_sources (id, label_en, description, cadence) VALUES
  ('boi_representative', 'Bank of Israel representative rate', 'Daily representative exchange rates published by the Bank of Israel.', 'daily'),
  ('us_treasury_reporting', 'US Treasury reporting rates of exchange', 'Quarterly rates published by the US Treasury for foreign currency reporting.', 'quarterly'),
  ('irs_yearly_average', 'IRS yearly average currency exchange rate', 'Yearly average rates published by the IRS.', 'yearly'),
  ('manual', 'Manually entered rate', 'A rate entered by the user, with a note on where it came from.', 'manual');
