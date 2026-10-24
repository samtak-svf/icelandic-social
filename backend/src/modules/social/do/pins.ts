// The featured posts of a space (decisions 0080, 0088): plain functions over
// the object's SQL, like polls.ts.

import { MAX_FEATURED } from "./space-schema.ts";

/**
 * Features `postId` in the community's strip: "absent" when the post is not
 * here, "full" when three others are featured already, "pinned" when it is
 * now featured, "already" when it was.
 */
export function pinPost(sql: SqlStorage, postId: string): "absent" | "full" | "pinned" | "already" {
  const exists = sql.exec("SELECT 1 FROM posts WHERE post_id = ?", postId).toArray().length;
  if (!exists) return "absent";
  if (sql.exec("SELECT 1 FROM pinned_posts WHERE post_id = ?", postId).toArray().length) {
    return "already";
  }
  const count = sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM pinned_posts").one().n;
  if (count >= MAX_FEATURED) return "full";
  sql.exec("INSERT INTO pinned_posts (post_id, pinned_at) VALUES (?, ?)", postId, Date.now());
  return "pinned";
}

/** The ids of the featured posts, newest pin first. */
export function featured(sql: SqlStorage): string[] {
  return sql
    .exec<{ post_id: string }>(
      "SELECT post_id FROM pinned_posts ORDER BY pinned_at DESC, rowid DESC",
    )
    .toArray()
    .map((r) => r.post_id);
}
