import { db } from "../../env/index.ts";
import { UNBLOCKED } from "../../identity/index.ts";
import { transfer } from "./membership.ts";
import { likeLiteral, nameKey } from "../profiles/index.ts";

// The community graph in D1 (decisions 0060, 0063): communities, members and
// their roles, join requests, invitations and bans.

type Role = "owner" | "moderator" | "member";
export type Audience = "open" | "private";

/** A community as one account stands in it: what it may see and do there. */
export type Standing = {
  communityId: string;
  name: string;
  description: string;
  audience: Audience;
  createdAt: number;
  memberCount: number | null;
  role: Role | null;
  joinRequested: boolean;
  invited: boolean;
  readOnly: boolean;
  banned: boolean;
  /** Until when a moderator muted the viewer here, or null. */
  mutedUntil: number | null;
  /** The viewer is on Samtak's list of platform moderators (decision 0063). */
  platformModerator: boolean;
};

/** A read-only community is deleted this long after its owner's account was (decision 0063). */
const READ_ONLY_MS = 90 * 24 * 60 * 60 * 1000;

// ?1 is the viewer in every query that uses these.
const COLUMNS = `c.community_id, c.name, c.description, c.audience, c.created_at,
       c.read_only_since, m.role, m.muted_until,
       EXISTS (SELECT 1 FROM platform_moderators p WHERE p.account_id = ?1) AS platform,
       EXISTS (SELECT 1 FROM community_bans x
                WHERE x.community_id = c.community_id AND x.account_id = ?1) AS banned,
       EXISTS (SELECT 1 FROM community_join_requests r
                WHERE r.community_id = c.community_id AND r.account_id = ?1) AS requested,
       EXISTS (SELECT 1 FROM community_invitations i
                WHERE i.community_id = c.community_id AND i.account_id = ?1) AS invited,
       CASE WHEN c.audience = 'open' OR m.role IS NOT NULL
            THEN (SELECT COUNT(*) FROM community_members n WHERE n.community_id = c.community_id)
       END AS member_count`;
const FROM = `communities c LEFT JOIN community_members m
         ON m.community_id = c.community_id AND m.account_id = ?1`;

type Row = {
  community_id: string;
  name: string;
  description: string;
  audience: Audience;
  created_at: number;
  read_only_since: number | null;
  role: Role | null;
  muted_until: number | null;
  platform: number;
  banned: number;
  requested: number;
  invited: number;
  member_count: number | null;
};

function standingOf(row: Row): Standing {
  return {
    communityId: row.community_id,
    name: row.name,
    description: row.description,
    audience: row.audience,
    createdAt: row.created_at,
    memberCount: row.member_count,
    role: row.role,
    joinRequested: row.requested === 1,
    invited: row.invited === 1,
    readOnly: row.read_only_since !== null,
    banned: row.banned === 1,
    mutedUntil: row.muted_until,
    platformModerator: row.platform === 1,
  };
}

/** The community as `viewer` stands in it, or null when there is none. */
export async function standing(
  env: Env,
  viewer: string,
  communityId: string,
): Promise<Standing | null> {
  const row = await db(env)
    .prepare(`SELECT ${COLUMNS} FROM ${FROM} WHERE c.community_id = ?2`)
    .bind(viewer, communityId)
    .first<Row>();
  return row ? standingOf(row) : null;
}

/** The public face of a standing: the flags the contract does not carry are dropped. */
export function view(s: Standing): Omit<Standing, "banned" | "platformModerator"> {
  const { banned, platformModerator, ...community } = s;
  void banned;
  void platformModerator;
  return community;
}

/** A new community id: 16 random bytes, hex. */
function newCommunityId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `cm_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** Whether Kenni verified the account (decision 0063: only a verified account creates). */
export async function isVerified(env: Env, accountId: string): Promise<boolean> {
  const row = await db(env)
    .prepare("SELECT verified FROM accounts WHERE account_id = ?")
    .bind(accountId)
    .first<{ verified: number }>();
  return row?.verified === 1;
}

/** Creates a community owned by `owner`. */
export async function createCommunity(
  env: Env,
  owner: string,
  input: { name: string; description: string; audience: Audience },
): Promise<Standing> {
  const communityId = newCommunityId();
  const now = Date.now();
  await db(env).batch([
    db(env)
      .prepare(
        `INSERT INTO communities (community_id, name, name_key, description, audience, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(communityId, input.name, nameKey(input.name), input.description, input.audience, now),
    db(env)
      .prepare(
        `INSERT INTO community_members (community_id, account_id, role, joined_at)
         VALUES (?, ?, 'owner', ?)`,
      )
      .bind(communityId, owner, now),
  ]);
  return {
    communityId,
    ...input,
    createdAt: now,
    memberCount: 1,
    role: "owner",
    joinRequested: false,
    invited: false,
    readOnly: false,
    banned: false,
    mutedUntil: null,
    platformModerator: false,
  };
}

/** Discovery: every community, newest first, `query` matched anywhere in its name. */
export async function discover(
  env: Env,
  viewer: string,
  options: { query?: string; after?: { createdAt: number; id: string }; limit: number },
): Promise<{ items: Standing[]; next: string | null }> {
  const { query, after, limit } = options;
  const { results } = await db(env)
    .prepare(
      `SELECT ${COLUMNS} FROM ${FROM}
        WHERE (?2 IS NULL OR c.name_key LIKE '%' || ?2 || '%' ESCAPE '\\')
          AND (?3 IS NULL OR c.created_at < ?3 OR (c.created_at = ?3 AND c.community_id < ?4))
        ORDER BY c.created_at DESC, c.community_id DESC
        LIMIT ?5`,
    )
    .bind(
      viewer,
      query === undefined ? null : likeLiteral(nameKey(query)),
      after?.createdAt ?? null,
      after?.id ?? null,
      limit + 1,
    )
    .all<Row>();
  const page = results.slice(0, limit).map(standingOf);
  const last = page.at(-1);
  return {
    items: page,
    next: results.length > limit && last ? `${last.createdAt}-${last.communityId}` : null,
  };
}

/** The communities `viewer` is a member of, by name. */
export async function communitiesOf(env: Env, viewer: string): Promise<Standing[]> {
  const { results } = await db(env)
    .prepare(
      `SELECT ${COLUMNS} FROM ${FROM}
        WHERE m.account_id IS NOT NULL ORDER BY c.name_key, c.community_id`,
    )
    .bind(viewer)
    .all<Row>();
  return results.map(standingOf);
}

export async function updateCommunity(
  env: Env,
  communityId: string,
  change: { name?: string; description?: string; audience?: Audience },
): Promise<void> {
  await db(env)
    .prepare(
      `UPDATE communities
          SET name = COALESCE(?2, name), name_key = COALESCE(?3, name_key),
              description = COALESCE(?4, description), audience = COALESCE(?5, audience)
        WHERE community_id = ?1`,
    )
    .bind(
      communityId,
      change.name ?? null,
      change.name === undefined ? null : nameKey(change.name),
      change.description ?? null,
      change.audience ?? null,
    )
    .run();
}

/** Deletes a community's graph: its members, requests, invitations and bans go with it. */
export async function deleteCommunityRows(env: Env, communityId: string): Promise<void> {
  await db(env).prepare("DELETE FROM communities WHERE community_id = ?").bind(communityId).run();
}

export type Member = {
  accountId: string;
  name: string | null;
  verified: boolean;
  role: Role;
  joinedAt: number;
};

/** The members, owner and moderators first; a block hides one from `viewer` unless it moderates. */
export async function members(
  env: Env,
  viewer: string,
  communityId: string,
  moderating: boolean,
): Promise<Member[]> {
  const { results } = await db(env)
    .prepare(
      `SELECT m.account_id AS accountId, a.display_name AS name, a.verified, m.role,
              m.joined_at AS joinedAt
         FROM community_members m JOIN accounts a ON a.account_id = m.account_id
        WHERE m.community_id = ?2 AND (?3 = 1 OR ${UNBLOCKED("?1", "m.account_id")})
        ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'moderator' THEN 1 ELSE 2 END,
                 m.joined_at, m.account_id`,
    )
    .bind(viewer, communityId, moderating ? 1 : 0)
    .all<Omit<Member, "verified"> & { verified: number }>();
  return results.map((r) => ({ ...r, verified: r.verified === 1 }));
}

export type JoinRequest = {
  accountId: string;
  name: string | null;
  verified: boolean;
  requestedAt: number;
};

/** The join requests that wait, oldest first; a moderator sees them whoever made them. */
export async function joinRequests(env: Env, communityId: string): Promise<JoinRequest[]> {
  const { results } = await db(env)
    .prepare(
      `SELECT r.account_id AS accountId, a.display_name AS name, a.verified,
              r.created_at AS requestedAt
         FROM community_join_requests r JOIN accounts a ON a.account_id = r.account_id
        WHERE r.community_id = ? ORDER BY r.created_at, r.account_id`,
    )
    .bind(communityId)
    .all<Omit<JoinRequest, "verified"> & { verified: number }>();
  return results.map((r) => ({ ...r, verified: r.verified === 1 }));
}

/**
 * Before an account is deleted (decision 0063): each community it owns
 * passes to its longest-serving moderator, or with none becomes read-only.
 * Its memberships, requests, invitations and bans go with the account's row.
 */
export async function handOverCommunities(env: Env, accountId: string): Promise<void> {
  const { results } = await db(env)
    .prepare(
      `SELECT community_id,
              (SELECT account_id FROM community_members s
                WHERE s.community_id = m.community_id AND s.role = 'moderator'
                ORDER BY s.joined_at, s.account_id LIMIT 1) AS heir
         FROM community_members m WHERE account_id = ? AND role = 'owner'`,
    )
    .bind(accountId)
    .all<{ community_id: string; heir: string | null }>();
  for (const { community_id, heir } of results) {
    if (heir) {
      await transfer(env, community_id, accountId, heir);
    } else {
      await db(env)
        .prepare("UPDATE communities SET read_only_since = ? WHERE community_id = ?")
        .bind(Date.now(), community_id)
        .run();
    }
  }
}

/** The read-only communities past their 90 days, for the daily cron to delete. */
export async function expiredReadOnly(env: Env, now = Date.now()): Promise<string[]> {
  const { results } = await db(env)
    .prepare("SELECT community_id FROM communities WHERE read_only_since <= ?")
    .bind(now - READ_ONLY_MS)
    .all<{ community_id: string }>();
  return results.map((r) => r.community_id);
}
