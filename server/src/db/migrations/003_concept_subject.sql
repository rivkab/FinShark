-- A concept says what its facts are about. A fact of a concept whose subject is
-- 'account' must carry an account_id (an ending balance is meaningless without
-- its account); 'person' requires person_id (e.g. W-2 wages). Enforced when a
-- fact is created or corrected (server/src/facts/validate.ts), not by a CHECK,
-- because facts are append-only and rows written before this migration may lack it.

ALTER TABLE concepts ADD COLUMN subject TEXT NOT NULL DEFAULT 'account' CHECK (subject IN ('account', 'person'));

UPDATE concepts SET subject = 'person' WHERE id IN ('income.wages', 'us.w2.box1_wages', 'tax.withheld.us_federal', 'us.w2.box2_fed_withheld');
