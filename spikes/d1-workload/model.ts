// The model behind spikes/d1-workload/measure.ts: the usage assumptions, the
// hypothetical social schema, the SQL that seeds it and the reads measured.

// ---- The assumptions. Change them here, and the report follows. ----

/** Accounts at the horizon the projection is made for. */
export const ASSUMED_ACCOUNTS = 100_000;
/** Days of content kept at that horizon: three years, nothing expires. */
export const ASSUMED_DAYS = 3 * 365;
/** Accounts per community, which sets how many communities there are. */
export const ACCOUNTS_PER_COMMUNITY = 50;
/** Share of communities that are private (members only). */
const PRIVATE_SHARE = 0.2;
/** Communities an account belongs to, on average. */
const MEMBERSHIPS_PER_ACCOUNT = 8;
/** Posts an average account writes per day (most write none). */
const POSTS_PER_ACCOUNT_PER_DAY = 0.2;
/** Share of posts made in a community; the rest go to the author's followers. */
const COMMUNITY_POST_SHARE = 0.7;
/** Comments and reactions per post, on average. */
const COMMENTS_PER_POST = 3;
const REACTIONS_PER_POST = 8;
/** Accounts an account follows, and blocks, on average. */
const FOLLOWS_PER_ACCOUNT = 50;
const BLOCKS_PER_ACCOUNT = 0.5;
/** Social notifications are kept this long (comments and reactions on your posts). */
const NOTIFICATION_DAYS = 90;
/** Characters in a post and a comment, on average (uniform around it). */
export const POST_CHARS = 280;
const COMMENT_CHARS = 120;
/** A home-feed or community page. */
const PAGE = 30;
/** D1's limit per database. */
export const D1_LIMIT_BYTES = 10 * 1024 ** 3;

// ---- The seed: the same density per community, fewer accounts and days. ----

export const DEFAULT_SEED_ACCOUNTS = 20_000;
const SEED_DAYS = 90;
const DAY_MS = 86_400_000;
/** The seed's "now": fixed, so the windows below are reproducible. */
export const NOW = Date.UTC(2027, 0, 1);
/** Viewers sampled per query; the report gives their median and the slowest. */
export const VIEWERS = 25;

// Ids are 22 characters, the length of a 16-byte base64url id like the
// Worker's, numbered so the seed can refer to rows it made.
export const ID_DIGITS = 21;

export const SCHEMA = `
CREATE TABLE accounts (
  account_id TEXT PRIMARY KEY,
  display_name TEXT,
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE communities (
  community_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  visibility TEXT NOT NULL CHECK (visibility IN ('open', 'private')),
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE community_members (
  community_id TEXT NOT NULL REFERENCES communities (community_id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts (account_id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'moderator', 'owner')),
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (community_id, account_id)
) STRICT;
CREATE INDEX community_members_by_account ON community_members (account_id);

-- A post with no community is a profile post, shown to the author's followers.
CREATE TABLE posts (
  post_id TEXT PRIMARY KEY,
  community_id TEXT REFERENCES communities (community_id) ON DELETE CASCADE,
  author_account_id TEXT NOT NULL REFERENCES accounts (account_id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX posts_by_community ON posts (community_id, created_at) WHERE community_id IS NOT NULL;
CREATE INDEX posts_by_author ON posts (author_account_id, created_at);

CREATE TABLE comments (
  comment_id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES posts (post_id) ON DELETE CASCADE,
  author_account_id TEXT NOT NULL REFERENCES accounts (account_id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX comments_by_post ON comments (post_id, created_at);
CREATE INDEX comments_by_author ON comments (author_account_id);

CREATE TABLE reactions (
  post_id TEXT NOT NULL REFERENCES posts (post_id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts (account_id) ON DELETE CASCADE,
  reaction TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, account_id)
) STRICT;
CREATE INDEX reactions_by_account ON reactions (account_id);

CREATE TABLE follows (
  follower_account_id TEXT NOT NULL REFERENCES accounts (account_id) ON DELETE CASCADE,
  followee_account_id TEXT NOT NULL REFERENCES accounts (account_id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (follower_account_id, followee_account_id)
) STRICT;
CREATE INDEX follows_by_followee ON follows (followee_account_id);

CREATE TABLE blocks (
  blocker_account_id TEXT NOT NULL REFERENCES accounts (account_id) ON DELETE CASCADE,
  blocked_account_id TEXT NOT NULL REFERENCES accounts (account_id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (blocker_account_id, blocked_account_id)
) STRICT;
CREATE INDEX blocks_by_blocked ON blocks (blocked_account_id);

CREATE TABLE notifications (
  notification_id INTEGER PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts (account_id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  actor_account_id TEXT,
  created_at INTEGER NOT NULL,
  read_at INTEGER
) STRICT;
CREATE INDEX notifications_by_account ON notifications (account_id, created_at);
`;

/** The tables in seeding order; each one's growth is measured on its own. */
export const TABLES = [
  "accounts",
  "communities",
  "community_members",
  "follows",
  "blocks",
  "posts",
  "comments",
  "reactions",
  "notifications",
] as const;
type Table = (typeof TABLES)[number];

export type Seed = { accounts: number; communities: number; posts: number; days: number };

export function seedFor(accounts: number): Seed {
  return {
    accounts,
    communities: Math.max(1, Math.round(accounts / ACCOUNTS_PER_COMMUNITY)),
    posts: Math.round(accounts * POSTS_PER_ACCOUNT_PER_DAY * SEED_DAYS),
    days: SEED_DAYS,
  };
}

/** Rows each table holds at the assumed horizon. */
export function projectedRows(): Record<Table, number> {
  const posts = ASSUMED_ACCOUNTS * POSTS_PER_ACCOUNT_PER_DAY * ASSUMED_DAYS;
  const perDay = ASSUMED_ACCOUNTS * POSTS_PER_ACCOUNT_PER_DAY;
  return {
    accounts: ASSUMED_ACCOUNTS,
    communities: ASSUMED_ACCOUNTS / ACCOUNTS_PER_COMMUNITY,
    community_members: ASSUMED_ACCOUNTS * MEMBERSHIPS_PER_ACCOUNT,
    follows: ASSUMED_ACCOUNTS * FOLLOWS_PER_ACCOUNT,
    blocks: ASSUMED_ACCOUNTS * BLOCKS_PER_ACCOUNT,
    posts,
    comments: posts * COMMENTS_PER_POST,
    reactions: posts * REACTIONS_PER_POST,
    notifications: perDay * (COMMENTS_PER_POST + REACTIONS_PER_POST) * NOTIFICATION_DAYS,
  };
}

/** SQL for a numbered id: `id('a', expr)` is 'a' and expr, zero-padded. */
const id = (prefix: string, n: string) => `printf('${prefix}%0${ID_DIGITS}d', ${n})`;
/** A random integer in [0, n), in SQL. */
const below = (n: number | string) => `(abs(random()) % (${n}))`;
/** A random fraction in [0, 1), in SQL. */
const fraction = `(abs(random()) % 1000000) / 1000000.0`;
/** A body of `chars` characters on average, uniform from half to one and a half. */
const body = (chars: number) => `printf('%.*c', ${chars / 2} + ${below(chars)}, 'x')`;
/** A time in the seed's window, in SQL. */
const timeIn = (days: number) => `${NOW} - ${below(days * DAY_MS)}`;
/** Rows 1..n, as a CTE named `seq(n)`. */
const seq = (n: number) =>
  `WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < ${n})`;
/**
 * An id skewed towards low numbers (popular accounts, big communities): the
 * product of two uniform fractions puts the first 1% of ids at about 5% of picks.
 */
const skewed = (prefix: string, of: number) =>
  id(prefix, `1 + CAST(${of} * ((${fraction}) * (${fraction})) AS INTEGER)`);

export function seedStatements(seed: Seed): Record<Table, string[]> {
  const commentCount = seed.posts * COMMENTS_PER_POST;
  const reactionCount = seed.posts * REACTIONS_PER_POST;
  const communityPosts = Math.round(seed.posts * COMMUNITY_POST_SHARE);
  const memberships = seed.accounts * MEMBERSHIPS_PER_ACCOUNT;
  return {
    accounts: [
      `INSERT INTO accounts ${seq(seed.accounts)}
       SELECT ${id("a", "n")}, 'Name ' || n, ${timeIn(seed.days)} FROM seq`,
    ],
    communities: [
      `INSERT INTO communities ${seq(seed.communities)}
       SELECT ${id("c", "n")}, 'Community ' || n,
              CASE WHEN ${fraction} < ${PRIVATE_SHARE} THEN 'private' ELSE 'open' END,
              ${timeIn(seed.days)} FROM seq`,
    ],
    community_members: [
      `INSERT OR IGNORE INTO community_members ${seq(memberships)}
       SELECT ${skewed("c", seed.communities)}, ${id("a", `1 + (n - 1) % ${seed.accounts}`)},
              'member', ${timeIn(seed.days)} FROM seq`,
    ],
    follows: [
      `INSERT OR IGNORE INTO follows ${seq(seed.accounts * FOLLOWS_PER_ACCOUNT)}
       SELECT ${id("a", `1 + (n - 1) % ${seed.accounts}`)}, ${skewed("a", seed.accounts)},
              ${timeIn(seed.days)} FROM seq`,
    ],
    blocks: [
      `INSERT OR IGNORE INTO blocks ${seq(Math.max(1, Math.round(seed.accounts * BLOCKS_PER_ACCOUNT)))}
       SELECT ${id("a", `1 + ${below(seed.accounts)}`)}, ${id("a", `1 + ${below(seed.accounts)}`)},
              ${timeIn(seed.days)} FROM seq`,
    ],
    // Community posts are written by members: each takes a random membership row.
    posts: [
      `INSERT INTO posts ${seq(communityPosts)}
       SELECT ${id("p", "n")}, m.community_id, m.account_id, ${body(POST_CHARS)}, ${timeIn(seed.days)}
         FROM seq JOIN community_members m
           ON m.rowid = 1 + (n * 7919) % (SELECT max(rowid) FROM community_members)`,
      `INSERT INTO posts ${seq(seed.posts - communityPosts)}
       SELECT ${id("p", `${communityPosts} + n`)}, NULL, ${id("a", `1 + ${below(seed.accounts)}`)},
              ${body(POST_CHARS)}, ${timeIn(seed.days)} FROM seq`,
    ],
    comments: [
      `INSERT INTO comments ${seq(commentCount)}
       SELECT ${id("m", "n")}, ${id("p", `1 + ${below(seed.posts)}`)},
              ${id("a", `1 + ${below(seed.accounts)}`)}, ${body(COMMENT_CHARS)}, ${timeIn(seed.days)}
         FROM seq`,
    ],
    reactions: [
      `INSERT OR IGNORE INTO reactions ${seq(reactionCount)}
       SELECT ${id("p", `1 + ${below(seed.posts)}`)}, ${id("a", `1 + ${below(seed.accounts)}`)},
              'heart', ${timeIn(seed.days)} FROM seq`,
    ],
    // One notification per comment and reaction on a post, to its author,
    // for the window they are kept.
    notifications: [
      `INSERT INTO notifications (account_id, kind, subject_id, actor_account_id, created_at)
       SELECT p.author_account_id, 'comment', c.comment_id, c.author_account_id, c.created_at
         FROM comments c JOIN posts p USING (post_id)
        WHERE c.created_at > ${NOW - NOTIFICATION_DAYS * DAY_MS}`,
      `INSERT INTO notifications (account_id, kind, subject_id, actor_account_id, created_at)
       SELECT p.author_account_id, 'reaction', r.post_id, r.account_id, r.created_at
         FROM reactions r JOIN posts p USING (post_id)
        WHERE r.created_at > ${NOW - NOTIFICATION_DAYS * DAY_MS}`,
    ],
  };
}

// ---- The reads. `?1` is the viewer, `?2` the cursor (older than). ----

const NOT_BLOCKED = `NOT EXISTS (
  SELECT 1 FROM blocks b
   WHERE (b.blocker_account_id = ?1 AND b.blocked_account_id = p.author_account_id)
      OR (b.blocker_account_id = p.author_account_id AND b.blocked_account_id = ?1))`;

/** Window a home-feed read is bounded to; an empty window steps back one. */
const FEED_WINDOW_DAYS = 7;

export const QUERIES = {
  // The obvious form: one scan of posts, newest first, filtered per row.
  "home feed, one scan": `
    SELECT p.post_id, p.community_id, p.author_account_id, p.created_at FROM posts p
     WHERE p.created_at < ?2
       AND (p.community_id IN (SELECT community_id FROM community_members WHERE account_id = ?1)
            OR (p.community_id IS NULL AND p.author_account_id IN
                  (SELECT followee_account_id FROM follows WHERE follower_account_id = ?1)))
       AND ${NOT_BLOCKED}
     ORDER BY p.created_at DESC LIMIT ${PAGE}`,
  // One index range per source (each community, each followee), bounded to a
  // window, merged and sorted. Reads grow with what the viewer follows, not
  // with the table.
  "home feed, per source in a window": `
    SELECT * FROM (
      SELECT p.post_id, p.community_id, p.author_account_id, p.created_at
        FROM community_members m JOIN posts p
          ON p.community_id = m.community_id AND p.created_at < ?2 AND p.created_at >= ?2 - ${FEED_WINDOW_DAYS * DAY_MS}
       WHERE m.account_id = ?1
      UNION ALL
      SELECT p.post_id, p.community_id, p.author_account_id, p.created_at
        FROM follows f JOIN posts p
          ON p.author_account_id = f.followee_account_id AND p.created_at < ?2 AND p.created_at >= ?2 - ${FEED_WINDOW_DAYS * DAY_MS}
       WHERE f.follower_account_id = ?1 AND p.community_id IS NULL
    ) p
     WHERE ${NOT_BLOCKED}
     ORDER BY p.created_at DESC LIMIT ${PAGE}`,
  // A community's page as a viewer sees it: access first (open, or a member),
  // then a page of posts with their comment and reaction counts.
  "community page": `
    SELECT p.post_id, p.author_account_id, p.created_at,
           (SELECT count(*) FROM comments c WHERE c.post_id = p.post_id) AS comments,
           (SELECT count(*) FROM reactions r WHERE r.post_id = p.post_id) AS reactions
      FROM posts p
     WHERE p.community_id = ?3 AND p.created_at < ?2
       AND EXISTS (SELECT 1 FROM communities k WHERE k.community_id = ?3
                     AND (k.visibility = 'open' OR EXISTS
                          (SELECT 1 FROM community_members m
                            WHERE m.community_id = ?3 AND m.account_id = ?1)))
       AND ${NOT_BLOCKED}
     ORDER BY p.created_at DESC LIMIT ${PAGE}`,
  "a post's comments": `
    SELECT c.comment_id, c.author_account_id, c.body, c.created_at FROM comments c
     WHERE c.post_id = ?4 ORDER BY c.created_at LIMIT 100`,
  "notifications, newest first": `
    SELECT * FROM notifications WHERE account_id = ?1 ORDER BY created_at DESC LIMIT ${PAGE}`,
} as const;
