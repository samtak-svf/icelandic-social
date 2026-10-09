-- Identities (decision 0033): an account holds at most one per provider, and
-- a sign-in finds its account by one. A subject is kept only as its HMAC under
-- the key 0019 uses for kennitölur: a Kenni subject is the kennitala, a Google
-- subject "google:" and its `sub`. accounts.kennitala_hmac is copied here
-- unchanged and is dropped by a later migration, once nothing reads it.

CREATE TABLE identities (
  provider TEXT NOT NULL CHECK (provider IN ('kenni', 'google')),
  subject_hmac TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts (account_id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (provider, subject_hmac),
  UNIQUE (account_id, provider)
) STRICT;

INSERT INTO identities (provider, subject_hmac, account_id, created_at)
SELECT 'kenni', kennitala_hmac, account_id, created_at
  FROM accounts WHERE kennitala_hmac IS NOT NULL;
