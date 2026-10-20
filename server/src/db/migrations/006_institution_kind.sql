-- Whether an institution is a financial institution (bank, broker, fund, insurer) or an
-- employer (payslips, W-2s, tlushim). A plain descriptive label, nullable because
-- institutions created before this migration have none and we do not guess. The allowed
-- values live in shared/src/api.ts (INSTITUTION_KINDS) and are checked by the API, not a
-- CHECK, so the list can grow without rebuilding the table.

ALTER TABLE institutions ADD COLUMN kind TEXT;
