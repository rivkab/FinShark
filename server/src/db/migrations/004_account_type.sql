-- What kind of product an account is (checking, savings, pension, ...). A plain
-- descriptive label, nullable because accounts created before this migration have
-- none. The allowed values live in shared/src/api.ts (ACCOUNT_TYPES) and are checked
-- by the API, not a CHECK, so the list can grow without rebuilding the table.
-- It is not a tax or aid classification: that stays in taxonomies (DESIGN C5).

ALTER TABLE accounts ADD COLUMN account_type TEXT;
