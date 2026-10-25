// The Space's side of an anonymous post (decision 0091): a flag on the post
// beside its real author, which stays in the row. Readers never get the author
// from here; the Worker replaces the byline in bylines.ts.

/** Adds the `anonymous` column to a space made before decision 0091, as a repair on open (0050). */
export function ensureAnonymousColumn(sql: SqlStorage): void {
  const columns = sql.exec<{ name: string }>("PRAGMA table_info(posts)").toArray();
  if (!columns.some((c) => c.name === "anonymous")) {
    sql.exec("ALTER TABLE posts ADD COLUMN anonymous INTEGER NOT NULL DEFAULT 0");
  }
}

/** Moves a post to `at`, when a moderator publishes it: it enters the feed as of now (decision 0091). */
export function publish(sql: SqlStorage, postId: string, at: number): void {
  sql.exec("UPDATE posts SET created_at = ? WHERE post_id = ? AND anonymous = 1", at, postId);
}
