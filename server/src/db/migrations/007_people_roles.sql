-- What a person is for: owns_accounts (can be an account owner, or the subject of a
-- person-level fact such as W-2 wages) and uses_app (can be chosen as "who is using
-- FinShark?" and so appear in history and verified-by). One person can be both; a child who
-- only owns an account is not a user, and a helper who only uses the app is not an owner.
-- Everyone who exists today did both, so both default to 1. The API requires at least one.

ALTER TABLE people ADD COLUMN owns_accounts INTEGER NOT NULL DEFAULT 1 CHECK (owns_accounts IN (0, 1));
ALTER TABLE people ADD COLUMN uses_app INTEGER NOT NULL DEFAULT 1 CHECK (uses_app IN (0, 1));
