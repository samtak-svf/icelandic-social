import { HOME_WINDOW_DAYS } from "../../api/home.ts";
import { db } from "../../env/index.ts";
import { UNBLOCKED } from "../../identity/index.ts";
import { UNSNOOZED } from "../friends/index.ts";
import { type HomeSource, type IndexedPost, readsHome } from "./access.ts";
import type { Viewer } from "./do/space.ts";
import { INDEXED, listed } from "./post-page.ts";

// The home feed (decision 0116): the viewer's communities, its friends' walls and
// its own wall, newest first, through `posts_by_community` with no bound list of
// ids. A stranger's wall never enters, whatever its posts' audience: this is what
// the viewer chose, and the person screen is where a stranger's wall is read.
//
// The width adapts because a fixed window costs a heavy viewer the rows of all
// of it on every page, and a narrow one shows a light viewer nothing.

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Windows a request reads. With the one read of how far back there is to go, a
 * request makes at most three statements for its rows, as decision 0116 has it.
 */
const WINDOWS_PER_REQUEST = 2;

/**
 * An anonymous post stays when its author is snoozed: hiding it would let the
 * viewer find out who wrote it by snoozing people one at a time. A block hides
 * it even so, since safety outranks that leak (decision 0091), and a snooze is
 * no safety measure.
 */
const WINDOW = (tombstones: boolean) => `
  SELECT ${INDEXED}, s.wall_owner AS wallOwner, s.friend FROM (
      SELECT m.community_id, NULL AS wall_owner, 0 AS friend
        FROM community_members m
        JOIN live_communities c ON c.community_id = m.community_id
       WHERE m.account_id = ?1
      UNION ALL
      SELECT w.community_id, f.friend_id, 1
        FROM friendships f JOIN walls w ON w.account_id = f.friend_id
       WHERE f.account_id = ?1
      UNION ALL
      SELECT w.community_id, w.account_id, 0 FROM walls w WHERE w.account_id = ?1
    ) s
    JOIN post_index p ON p.community_id = s.community_id
     AND p.created_at <= ?2 AND p.created_at > ?3
   WHERE ${listed(tombstones)}
     AND p.imported IS NOT 'backlog'
     AND (p.created_at < ?2 OR ?4 IS NULL OR p.post_id < ?4)
     AND ${UNBLOCKED("?1", "p.author_id")}
     AND (p.anonymous = 1 OR ${UNSNOOZED("?1", "p.author_id", "?5")})
   ORDER BY p.created_at DESC, p.post_id DESC LIMIT ?6`;

/**
 * When the oldest source of the viewer's began. A wall and not a friendship,
 * because a post older than the friendship is read as soon as the two are friends
 * (decision 0115): stopping at the friendship would lose it without saying so.
 */
const OLDEST = `
  SELECT MIN(created_at) AS createdAt FROM (
    SELECT c.created_at FROM community_members m
      JOIN live_communities c ON c.community_id = m.community_id WHERE m.account_id = ?1
    UNION ALL
    SELECT s.created_at FROM friendships f
      JOIN walls w ON w.account_id = f.friend_id
      JOIN live_spaces s ON s.community_id = w.community_id WHERE f.account_id = ?1
    UNION ALL
    SELECT s.created_at FROM walls w
      JOIN live_spaces s ON s.community_id = w.community_id WHERE w.account_id = ?1
  )`;

const cursorOf = (days: number, t: number, id?: string) =>
  id === undefined ? `${days}.${t}` : `${days}.${t}-${id}`;

/** The window after `days`; the widest goes on sliding back. */
function wider(days: number): number {
  return HOME_WINDOW_DAYS.find((width) => width > days) ?? days;
}

/** A cursor the contract let through: a width, then a time and maybe a post's id. */
function parseHomeCursor(cursor: string | undefined, now: number) {
  if (cursor === undefined) return { days: HOME_WINDOW_DAYS[0] as number, t: now, id: null };
  const dot = cursor.indexOf(".");
  const dash = cursor.indexOf("-", dot);
  return {
    days: Number(cursor.slice(0, dot)),
    t: Number(cursor.slice(dot + 1, dash < 0 ? undefined : dash)),
    id: dash < 0 ? null : cursor.slice(dash + 1),
  };
}

/**
 * One page of `viewer`'s home feed, newest first. A page that fills ends at its
 * last post and keeps its width. One that does not ends at the end of what it
 * read, wider, and the next page goes on from there, until no source of the
 * viewer's is that old. `rowsRead` and `statements` are for the budget test.
 */
export async function home(
  env: Env,
  viewer: Viewer,
  before: string | undefined,
  limit: number,
  tombstones: boolean,
  now = Date.now(),
): Promise<{ rows: IndexedPost[]; next: string | null; rowsRead: number; statements: number }> {
  let { days, t: upper, id } = parseHomeCursor(before, now);
  const rows: IndexedPost[] = [];
  let rowsRead = 0;
  let statements = 0;
  for (let read = 0; read < WINDOWS_PER_REQUEST; read++) {
    const room = limit - rows.length;
    const lower = upper - days * DAY_MS;
    const { results, meta } = await db(env)
      .prepare(WINDOW(tombstones))
      .bind(viewer.account, upper, lower, id, now, room + 1)
      .all<IndexedPost & HomeSource>();
    statements++;
    rowsRead += meta.rows_read;
    const taken = results.slice(0, room);
    for (const row of taken) {
      if (!readsHome(row, viewer)) continue;
      const { wallOwner: _wallOwner, friend: _friend, ...post } = row;
      rows.push(post);
    }
    const last = taken.at(-1);
    if (taken.length === room && last) {
      const next = cursorOf(days, last.createdAt, last.postId);
      return { rows, next, rowsRead, statements };
    }
    upper = lower;
    id = null;
    days = wider(days);
  }
  const oldest = await db(env)
    .prepare(OLDEST)
    .bind(viewer.account)
    .first<{ createdAt: number | null }>();
  statements++;
  const more = oldest?.createdAt != null && oldest.createdAt <= upper;
  return { rows, next: more ? cursorOf(days, upper) : null, rowsRead, statements };
}
