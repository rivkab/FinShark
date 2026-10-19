-- Free-text notes about an account, written by a person. Nullable; blank means none.
-- Notes are for people to read: nothing computes from them.

ALTER TABLE accounts ADD COLUMN notes TEXT;
