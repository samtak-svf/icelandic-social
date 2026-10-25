import type { PostView } from "../../api/social.ts";
import { type Framing, parseFraming } from "../../api/image-frames.ts";
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
  /** When it was deleted; only a platform moderator sees a deleted one (decision 0070). */
  deletedAt: number | null;
  /** Its content is gone; it is kept only for its log, and cannot be restored. */
  purged: boolean;
  /** Until when the viewer's declined request keeps it from asking again, or null. */
  joinDeclinedUntil: number | null;
  /** How many join requests wait; null unless the viewer moderates. */
  pendingJoinRequests: number | null;
  /** How many open reports wait; null unless the viewer moderates. */
  openReports: number | null;
  /** Members may post without their name, for a moderator's approval (decision 0091). */
  anonymousPosts: boolean;
  /** How many anonymous posts wait for approval; 0 unless the viewer moderates. */
  pendingAnonymous: number;
  /** The picture's version (decision 0080), or null when it has none. */
  photo: string | null;
  /** The cover's version (decision 0080), or null when it has none. */
  cover: string | null;
  /** How the picture is framed (decision 0086), or null. */
  photoFrames: Framing | null;
  /** How the cover is framed (decision 0086), or null. */
  coverFrames: Framing | null;
  /**
   * Posts made since the viewer last opened the feed (decision 0080), counted
   * from D1's sequence alone. A post later deleted or removed still counts as
   * posted, the accepted trade-off for never asking a space. 0 for a viewer
   * who is not a member.
   */
  unread: number;
  /** When the latest post was made, or null: hidden from a private community's outsiders. */
  lastPostAt: number | null;
  /** The viewer pinned it to the top of its list (decision 0080). */
  pinned: boolean;
  /** When the viewer pinned it, to order the pinned; not part of the contract. */
  pinnedAt: number | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;
/** A read-only community is deleted this long after its owner's account was (decision 0063). */
export const READ_ONLY_MS = 90 * DAY_MS;
/** A declined account may ask to join again this long after (decision 0070). */
export const DECLINED_MS = 30 * DAY_MS;

// ?1 is the viewer in every query that uses these.
const COLUMNS = `c.community_id, c.name, c.description, c.audience, c.created_at,
       c.read_only_since, c.deleted_at, c.purged_at, c.photo_version, c.cover_version,
       c.photo_frames, c.cover_frames, c.anonymous_posts,
       m.role, m.muted_until,
       CASE WHEN m.role IS NOT NULL
            THEN MAX(0, c.post_seq - COALESCE((SELECT x.read_seq FROM community_reads x
                          WHERE x.community_id = c.community_id AND x.account_id = ?1), 0))
            ELSE 0 END AS unread,
       CASE WHEN c.audience = 'open' OR m.role IS NOT NULL THEN c.last_post_at END AS last_post_at,
       (SELECT x.pinned_at FROM community_pins x
         WHERE x.community_id = c.community_id AND x.account_id = ?1) AS pinned_at,
       EXISTS (SELECT 1 FROM platform_moderators p WHERE p.account_id = ?1) AS platform,
       EXISTS (SELECT 1 FROM community_bans x
                WHERE x.community_id = c.community_id AND x.account_id = ?1) AS banned,
       EXISTS (SELECT 1 FROM community_join_requests r
                WHERE r.community_id = c.community_id AND r.account_id = ?1
                  AND r.declined_at IS NULL) AS requested,
       (SELECT r.declined_at FROM community_join_requests r
         WHERE r.community_id = c.community_id AND r.account_id = ?1) AS declined_at,
       CASE WHEN m.role IN ('owner', 'moderator')
            THEN (SELECT COUNT(*) FROM community_join_requests r
                   WHERE r.community_id = c.community_id AND r.declined_at IS NULL)
       END AS pending,
       CASE WHEN m.role IN ('owner', 'moderator')
            THEN (SELECT COUNT(*) FROM reports r
                   WHERE r.community_id = c.community_id AND r.state = 'open'
                     AND r.to_platform = 0)
       END AS open_reports,
       CASE WHEN m.role IN ('owner', 'moderator')
            THEN (SELECT COUNT(*) FROM post_index q
                   WHERE q.community_id = c.community_id AND q.state = 'pending'
                     AND q.anonymous = 1)
            ELSE 0 END AS pending_anonymous,
       EXISTS (SELECT 1 FROM community_invitations i
                WHERE i.community_id = c.community_id AND i.account_id = ?1) AS invited,
       CASE WHEN c.audience = 'open' OR m.role IS NOT NULL
            THEN (SELECT COUNT(*) FROM community_members n WHERE n.community_id = c.community_id)
       END AS member_count`;
const MEMBERSHIP = `LEFT JOIN community_members m
         ON m.community_id = c.community_id AND m.account_id = ?1`;
/** The communities that are not deleted, as every list reads them. */
const FROM = `live_communities c ${MEMBERSHIP}`;

type Row = {
  community_id: string;
  name: string;
  description: string;
  audience: Audience;
  created_at: number;
  read_only_since: number | null;
  deleted_at: number | null;
  purged_at: number | null;
  photo_version: string | null;
  cover_version: string | null;
  photo_frames: string | null;
  cover_frames: string | null;
  anonymous_posts: number;
  pending_anonymous: number;
  unread: number;
  last_post_at: number | null;
  pinned_at: number | null;
  role: Role | null;
  muted_until: number | null;
  platform: number;
  banned: number;
  requested: number;
  invited: number;
  declined_at: number | null;
  pending: number | null;
  open_reports: number | null;
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
    deletedAt: row.deleted_at,
    purged: row.purged_at !== null,
    joinDeclinedUntil:
      row.declined_at !== null && row.declined_at + DECLINED_MS > Date.now()
        ? row.declined_at + DECLINED_MS
        : null,
    pendingJoinRequests: row.pending,
    openReports: row.open_reports,
    anonymousPosts: row.anonymous_posts === 1,
    pendingAnonymous: row.pending_anonymous,
    photo: row.photo_version,
    cover: row.cover_version,
    photoFrames: parseFraming(row.photo_frames),
    coverFrames: parseFraming(row.cover_frames),
    unread: row.unread,
    lastPostAt: row.last_post_at,
    pinned: row.pinned_at !== null,
    pinnedAt: row.pinned_at,
  };
}

/**
 * The community as `viewer` stands in it, or null when there is none. A
 * deleted one is none, except with `deleted` to a platform moderator, who
 * restores it and reads its log for a year (decision 0070).
 */
export async function standing(
  env: Env,
  viewer: string,
  communityId: string,
  options: { deleted?: boolean } = {},
): Promise<Standing | null> {
  // The one read of the bare table: the view leaves deleted ones out.
  const row = await db(env)
    .prepare(
      `SELECT ${COLUMNS} FROM communities c ${MEMBERSHIP}
        WHERE c.community_id = ?2
          AND (c.deleted_at IS NULL
               OR (?3 = 1 AND EXISTS (SELECT 1 FROM platform_moderators p
                                       WHERE p.account_id = ?1)))`,
    )
    .bind(viewer, communityId, options.deleted ? 1 : 0)
    .first<Row>();
  return row ? standingOf(row) : null;
}

/** The public face of a standing: the flags the contract does not carry are dropped. */
export function view(
  s: Standing,
  featured: PostView[] = [],
): Omit<Standing, "banned" | "platformModerator" | "purged" | "pinnedAt"> & {
  featured: PostView[];
} {
  const { banned, platformModerator, purged, pinnedAt, ...community } = s;
  void banned;
  void platformModerator;
  void purged;
  void pinnedAt;
  return { ...community, featured };
}

/** A new community id: 16 random bytes, hex. */
function newCommunityId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `cm_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** Whether `communityId` exists, read-only or not. */
export async function communityExists(env: Env, communityId: string): Promise<boolean> {
  const row = await db(env)
    .prepare("SELECT 1 AS found FROM live_communities WHERE community_id = ?")
    .bind(communityId)
    .first<{ found: number }>();
  return row !== null;
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
    deletedAt: null,
    purged: false,
    joinDeclinedUntil: null,
    pendingJoinRequests: 0,
    openReports: 0,
    anonymousPosts: false,
    pendingAnonymous: 0,
    photo: null,
    cover: null,
    photoFrames: null,
    coverFrames: null,
    unread: 0,
    lastPostAt: null,
    pinned: false,
    pinnedAt: null,
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

/**
 * The communities `viewer` is a member of: the ones it pinned first, the
 * earliest pin first (decision 0080), then the rest by name. Everything,
 * unread counts included, is read from D1; no space is asked.
 */
export async function communitiesOf(env: Env, viewer: string): Promise<Standing[]> {
  const { results } = await db(env)
    .prepare(
      `SELECT ${COLUMNS} FROM ${FROM}
        WHERE m.account_id IS NOT NULL
        ORDER BY pinned_at IS NULL, pinned_at, c.name_key, c.community_id`,
    )
    .bind(viewer)
    .all<Row>();
  return results.map(standingOf);
}

export async function updateCommunity(
  env: Env,
  communityId: string,
  change: { name?: string; description?: string; audience?: Audience; anonymousPosts?: boolean },
  /** Statements written in the same batch, such as the log's entry for the switch. */
  also: D1PreparedStatement[] = [],
): Promise<void> {
  await db(env).batch([
    db(env)
      .prepare(
        `UPDATE communities
          SET name = COALESCE(?2, name), name_key = COALESCE(?3, name_key),
              description = COALESCE(?4, description), audience = COALESCE(?5, audience),
              anonymous_posts = COALESCE(?6, anonymous_posts)
        WHERE community_id = ?1`,
      )
      .bind(
        communityId,
        change.name ?? null,
        change.name === undefined ? null : nameKey(change.name),
        change.description ?? null,
        change.audience ?? null,
        change.anonymousPosts === undefined ? null : change.anonymousPosts ? 1 : 0,
      ),
    ...also,
  ]);
}

/**
 * The statement that sets a community's picture or cover version, or clears it
 * with null (decision 0080), for the batch that also writes the log's entry.
 */
export function imageVersion(
  env: Env,
  communityId: string,
  which: "photo" | "cover",
  version: string | null,
  framing: Framing | null,
): D1PreparedStatement {
  const [column, frames] =
    which === "photo" ? ["photo_version", "photo_frames"] : ["cover_version", "cover_frames"];
  return db(env)
    .prepare(
      `UPDATE communities SET ${column} = ?2, ${frames} = ?3
        WHERE community_id = ?1 AND deleted_at IS NULL`,
    )
    .bind(communityId, version, framing && JSON.stringify(framing));
}

export type Member = {
  accountId: string;
  name: string | null;
  verified: boolean;
  /** The account's photo version, or null without one. */
  photo: string | null;
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
      `SELECT m.account_id AS accountId, a.display_name AS name, a.verified,
              a.photo_version AS photo, m.role, m.joined_at AS joinedAt
         FROM community_members m JOIN accounts a ON a.account_id = m.account_id
        WHERE m.community_id = ?2 AND (?3 = 1 OR ${UNBLOCKED("?1", "m.account_id")})
        ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'moderator' THEN 1 ELSE 2 END,
                 a.display_name IS NULL, a.display_name COLLATE NOCASE, m.joined_at, m.account_id`,
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
        WHERE r.community_id = ? AND r.declined_at IS NULL
        ORDER BY r.created_at, r.account_id`,
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
