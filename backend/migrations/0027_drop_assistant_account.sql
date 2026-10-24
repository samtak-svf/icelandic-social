-- The retired tester assistant's account (decisions 0076, 0084). Migration 0026
-- dropped its tables and kept accounts.kind on the premise that every account
-- is a 'person', but the account the assistant posted as was left behind, still
-- a member of the community it answered in. The orphan sweep skips any account
-- that is not a 'person', so nothing else would ever remove it.
--
-- It held no identity, device or session, and nothing outside D1. Its
-- memberships go with it (ON DELETE CASCADE); a notification it caused keeps
-- its row and loses its actor (ON DELETE SET NULL), as when a person leaves.

DELETE FROM accounts WHERE kind = 'assistant';
