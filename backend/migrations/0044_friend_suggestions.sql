-- Whether an account takes part in friend suggestions (decision 0114): 1 by default, and 0 takes
-- it out in both directions, so it is neither suggested to anyone nor shown anyone. A setting
-- of the account, so it goes with the account's row.
ALTER TABLE accounts ADD COLUMN in_suggestions INTEGER NOT NULL DEFAULT 1
  CHECK (in_suggestions IN (0, 1));
