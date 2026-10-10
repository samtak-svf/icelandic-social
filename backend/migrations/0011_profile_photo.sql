-- One profile photo per account (decision 0039). The photo itself is in the R2
-- bucket spjall-profiles, keyed by account id; this is an opaque token that
-- changes with each upload, null when there is none, so a client fetches the
-- photo again only when it changes.

ALTER TABLE accounts ADD COLUMN photo_version TEXT;
