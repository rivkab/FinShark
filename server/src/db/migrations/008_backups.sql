-- Backup bookkeeping (DESIGN D20). These rows describe backup files, they are not
-- evidence: plain mutable rows, not append-only. The .ffbackup files on disk are the
-- truth about which backups exist; a row without a file is ignored.

-- One row once backups are set up. Only the public key is stored here; the private
-- key lives in the macOS Keychain and in vault-key.age (DESIGN §8.3).
CREATE TABLE backup_settings (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  recipient     TEXT NOT NULL,   -- age public key (age1...); backups are encrypted to it
  created_at    TEXT NOT NULL,
  confirmed_at  TEXT,            -- recovery sheet confirmed; NULL = setup not finished
  second_dir    TEXT,            -- absolute path of the second backup folder, or NULL
  changed_at    TEXT             -- last change made through the app; drives automatic backups
);

-- What is known about each backup file written by this vault.
CREATE TABLE backup_files (
  name                 TEXT PRIMARY KEY,                 -- file name in backups/
  created_at           TEXT NOT NULL,
  bytes                INTEGER NOT NULL,
  verified_at          TEXT,                             -- NULL = not yet verified
  verify_ok            INTEGER CHECK (verify_ok IN (0, 1)),
  problems_json        TEXT NOT NULL DEFAULT '[]',       -- problems from the last verify
  vault_warnings_json  TEXT NOT NULL DEFAULT '[]',       -- vault check problems while writing it
  copied_at            TEXT,                             -- copied to the second folder
  copy_error           TEXT                              -- why the copy failed, if it did
);
