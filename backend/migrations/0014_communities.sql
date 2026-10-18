-- Communities (decision 0063): the graph lives in D1, the content in each
-- community's Durable Object (decision 0060). A community is open or private;
-- a private one never becomes open. It has exactly one owner, any number of
-- moderators and members. `read_only_since` is set when the owner's account is
-- deleted and no moderator is left to take it over; the community is deleted
-- 90 days later. Names and descriptions are what the community says of itself,
-- never logged (0008).

CREATE TABLE communities (
  community_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  -- The name lowered with the Icelandic letters folded, as the directory's
  -- name_key is (0010), for discovery's search.
  name_key TEXT NOT NULL,
  description TEXT NOT NULL,
  audience TEXT NOT NULL CHECK (audience IN ('open', 'private')),
  created_at INTEGER NOT NULL,
  read_only_since INTEGER
) STRICT;

CREATE INDEX communities_by_age ON communities (created_at, community_id);
CREATE INDEX communities_read_only ON communities (read_only_since)
  WHERE read_only_since IS NOT NULL;

CREATE TABLE community_members (
  community_id TEXT NOT NULL REFERENCES communities (community_id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts (account_id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'moderator', 'member')),
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (community_id, account_id)
) STRICT;

-- The feed and "my communities" read by account (docs/d1-social-workload.md).
CREATE INDEX community_members_by_account ON community_members (account_id);
CREATE UNIQUE INDEX community_one_owner ON community_members (community_id) WHERE role = 'owner';

-- A request to join a private community, and a moderator's invitation to
-- one; each is gone once the account is a member.
CREATE TABLE community_join_requests (
  community_id TEXT NOT NULL REFERENCES communities (community_id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts (account_id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (community_id, account_id)
) STRICT;

CREATE TABLE community_invitations (
  community_id TEXT NOT NULL REFERENCES communities (community_id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts (account_id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (community_id, account_id)
) STRICT;

CREATE INDEX community_invitations_by_account ON community_invitations (account_id);

-- An account a community banned: it is not a member and cannot join again.
CREATE TABLE community_bans (
  community_id TEXT NOT NULL REFERENCES communities (community_id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts (account_id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (community_id, account_id)
) STRICT;
