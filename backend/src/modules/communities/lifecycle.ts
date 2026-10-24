import type { PostView } from "../../api/social.ts";
import { db } from "../../env/index.ts";
import { DECLINED_MS, READ_ONLY_MS } from "./communities.ts";

// A community's deletion (decision 0070). Deleting marks it, and it is gone
// for everyone at once; for 30 days a platform moderator can restore it. Then
// the daily job purges it: its space, its images and its graph go, and the
// row stays with its name, for the log and the reports that cascade from it,
// until a year after the deletion. A read-only community past its 90 days
// (decision 0063) is purged by the same path.

const DAY_MS = 24 * 60 * 60 * 1000;
/** A deleted community can be restored this long, then it is purged. */
const RESTORABLE_MS = 30 * DAY_MS;
/** A deleted community's row, its log and its reports are kept this long. */
const KEPT_MS = 365 * DAY_MS;

/** What a community's deletion leaves in other modules, written in its batch. */
type Event = "delete" | "restore" | "purge";

export type LifecycleHooks = {
  /**
   * The statement that logs a change of the community's picture or cover
   * (decision 0080), written in the batch of the change.
   */
  recordImage: (
    env: Env,
    communityId: string,
    by: string,
    kind: "photo" | "cover",
    change: "set" | "remove",
  ) => D1PreparedStatement;
  /** The statement that logs the owner switching anonymous posts on or off (decision 0091). */
  recordAnonymous: (env: Env, communityId: string, by: string, on: boolean) => D1PreparedStatement;
  /** The posts the account reads as featured in the community (decision 0088). */
  featured: (env: Env, accountId: string, communityId: string) => Promise<PostView[]>;
  /** What a purge removes beyond the graph: the space's content and images. */
  purgeContent: (env: Env, communityId: string) => Promise<void>;
  /**
   * The statements another module writes with a change: the log's entry and
   * the reports it closes. `by` is null for the daily job.
   */
  record: (
    env: Env,
    communityId: string,
    by: string | null,
    event: Event,
  ) => Promise<D1PreparedStatement[]>;
};

/** Marks a live community deleted by `by`; false when it was not live. */
export async function markDeleted(
  env: Env,
  communityId: string,
  by: string,
  hooks: LifecycleHooks,
): Promise<boolean> {
  const [marked] = await db(env).batch([
    db(env)
      .prepare(
        `UPDATE communities SET deleted_at = ?, deleted_by = ?
          WHERE community_id = ? AND deleted_at IS NULL`,
      )
      .bind(Date.now(), by, communityId),
    ...(await hooks.record(env, communityId, by, "delete")),
  ]);
  return (marked?.meta.changes ?? 0) > 0;
}

/** Restores a deleted community not yet purged; false when there was none. */
export async function restore(
  env: Env,
  communityId: string,
  by: string,
  hooks: LifecycleHooks,
): Promise<boolean> {
  const [restored] = await db(env).batch([
    db(env)
      .prepare(
        `UPDATE communities SET deleted_at = NULL, deleted_by = NULL
          WHERE community_id = ? AND deleted_at IS NOT NULL AND purged_at IS NULL`,
      )
      .bind(communityId),
    ...(await hooks.record(env, communityId, by, "restore")),
  ]);
  return (restored?.meta.changes ?? 0) > 0;
}

/**
 * Purges a community: its content first, then its graph, and the row is
 * marked so the content is never looked for again. A read-only one is
 * deleted by the purge, so its year starts there.
 */
async function purge(
  env: Env,
  communityId: string,
  hooks: LifecycleHooks,
  now: number,
): Promise<void> {
  await hooks.purgeContent(env, communityId);
  const graph = [
    "community_members",
    "community_join_requests",
    "community_invitations",
    "community_bans",
  ] as const;
  await db(env).batch([
    ...graph.map((table) =>
      db(env).prepare(`DELETE FROM ${table} WHERE community_id = ?`).bind(communityId),
    ),
    db(env)
      .prepare(
        `UPDATE communities SET deleted_at = COALESCE(deleted_at, ?1), purged_at = ?1
          WHERE community_id = ?2`,
      )
      .bind(now, communityId),
    ...(await hooks.record(env, communityId, null, "purge")),
  ]);
}

/**
 * The daily job (decisions 0063, 0070): purges the communities deleted 30
 * days ago and the read-only ones past their 90 days, deletes the rows of
 * those deleted a year ago, and the declined requests past their wait. How
 * many communities it purged or deleted.
 */
export async function expireCommunities(
  env: Env,
  hooks: LifecycleHooks,
  now = Date.now(),
): Promise<number> {
  const { results } = await db(env)
    .prepare(
      `SELECT community_id FROM communities
        WHERE purged_at IS NULL AND (deleted_at <= ?1 OR read_only_since <= ?2)`,
    )
    .bind(now - RESTORABLE_MS, now - READ_ONLY_MS)
    .all<{ community_id: string }>();
  for (const { community_id: communityId } of results) {
    await purge(env, communityId, hooks, now);
  }
  // The row goes with its log and reports, by their cascade.
  const [gone] = await db(env).batch([
    db(env)
      .prepare("DELETE FROM communities WHERE purged_at IS NOT NULL AND deleted_at <= ?")
      .bind(now - KEPT_MS),
    db(env)
      .prepare("DELETE FROM community_join_requests WHERE declined_at <= ?")
      .bind(now - DECLINED_MS),
  ]);
  return results.length + (gone?.meta.changes ?? 0);
}
