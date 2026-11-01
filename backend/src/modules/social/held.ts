import type { ItemClass } from "../../api/imports.ts";
import { db } from "../../env/index.ts";
import type { IndexedPost } from "./access.ts";
import { INDEXED, parseCursor } from "./post-page.ts";
import { render, type Post } from "./posts.ts";

// What an import holds until the person opens it (decision 0127): reviewed as the real
// posts, and opened all at once or by kind or year. Opening sets the state and the
// audience in one statement, so no post is ever out to an audience it was not given.

/** Which held posts are meant: all of them, or one kind, or one year, or both. */
export type HeldFilter = { class?: ItemClass | undefined; year?: number | undefined };

const YEAR = "CAST(strftime('%Y', p.created_at / 1000, 'unixepoch') AS INTEGER)";

/** A held post of this import: `?1` the account, `?2` the import, written to the end. */
const HELD = `FROM imported_posts i JOIN post_index p ON p.post_id = i.post_id
        WHERE i.account_id = ?1 AND i.import_id = ?2 AND i.done_at IS NOT NULL
          AND p.state = 'held'`;

/** How much the import still holds, by kind and year. */
export async function heldGroups(
  env: Env,
  accountId: string,
  importId: string,
): Promise<{ posts: number; groups: { class: ItemClass; year: number; posts: number }[] }> {
  const { results } = await db(env)
    .prepare(
      `SELECT i.class AS class, ${YEAR} AS year, COUNT(*) AS posts ${HELD}
        GROUP BY i.class, year ORDER BY year DESC, i.class`,
    )
    .bind(accountId, importId)
    .all<{ class: ItemClass; year: number; posts: number }>();
  return { posts: results.reduce((sum, group) => sum + group.posts, 0), groups: results };
}

/** A page of the held posts, newest first, rendered as their author reads them. */
export async function heldPosts(
  env: Env,
  accountId: string,
  importId: string,
  query: HeldFilter & { before?: string | undefined },
  limit: number,
): Promise<{ posts: Post[]; next: string | null }> {
  const cursor = parseCursor(query.before);
  const { results } = await db(env)
    .prepare(
      `SELECT ${INDEXED} ${HELD}
          AND (?3 IS NULL OR i.class = ?3) AND (?4 IS NULL OR ${YEAR} = ?4)
          AND (?5 IS NULL OR p.created_at < ?5 OR (p.created_at = ?5 AND p.post_id < ?6))
        ORDER BY p.created_at DESC, p.post_id DESC LIMIT ?7`,
    )
    .bind(
      accountId,
      importId,
      query.class ?? null,
      query.year ?? null,
      cursor?.t ?? null,
      cursor?.id ?? "",
      limit + 1,
    )
    .all<IndexedPost>();
  const rows = results.slice(0, limit);
  const last = rows.at(-1);
  return {
    posts: await render(env, rows, { account: accountId, hidden: [], moderator: false }),
    next: results.length > limit && last ? `${last.createdAt}-${last.postId}` : null,
  };
}

/** Opens what the import holds to `audience`; how many. The import checks that it may. */
export async function openHeldPosts(
  env: Env,
  accountId: string,
  importId: string,
  choice: HeldFilter & { audience: "friends" | "everyone" },
): Promise<number> {
  const opened = await db(env)
    .prepare(
      `UPDATE post_index SET state = 'visible', audience = ?3
        WHERE state = 'held' AND post_id IN (
          SELECT i.post_id ${HELD}
            AND (?4 IS NULL OR i.class = ?4) AND (?5 IS NULL OR ${YEAR} = ?5)
            AND EXISTS (SELECT 1 FROM import_sources s
                         WHERE s.import_id = i.import_id AND s.removing_at IS NULL))`,
    )
    .bind(accountId, importId, choice.audience, choice.class ?? null, choice.year ?? null)
    .run();
  return opened.meta.changes;
}
