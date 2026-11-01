import { db } from "../../env/index.ts";
import { stagedPosts } from "./connection-preview.ts";
import { previewReady } from "./file-jobs.ts";
import { dropFile, SYNC_AFTER_MS } from "./file.ts";

// What the two kinds of connection (decision 0120) decide alike. How a run ends stays with
// each, since one gives back what it spent and the other holds a lease.

export const HOUR_MS = 60 * 60 * 1000;
/** Posts one job reads: each may fetch and store several images. */
export const POSTS_PER_PART = 10;
/** The posts a first collection offers. */
export const BACKLOG_POSTS = 200;

/** Joined to a connection table named `c`: the source it belongs to and its file, if any. */
export const CONNECTION_JOINS = `JOIN import_sources s USING (import_id)
  LEFT JOIN import_files f USING (import_id)`;

/** How many of a connection's posts have come in. */
export async function postsBroughtIn(env: Env, importId: string): Promise<number> {
  const count = await db(env)
    .prepare(
      "SELECT COUNT(*) AS posts FROM imported_posts WHERE import_id = ? AND done_at IS NOT NULL",
    )
    .bind(importId)
    .first<{ posts: number }>();
  return count?.posts ?? 0;
}

/**
 * A first collection has been read: it now waits for the person if it holds anything, and
 * otherwise the connection goes on to sync. Says what the connection's row becomes, and
 * `also` holds what goes in the same batch.
 */
export async function firstCollectionEnd(env: Env, importId: string, runStart: number) {
  const { posts, latest } = await stagedPosts(env, importId);
  // Past a post written during the run, which the person has seen and may leave out.
  const lastOkAt = Math.max(runStart, latest + 1);
  if (posts === 0) {
    await dropFile(env, importId);
    const next = { phase: "sync" as const, nextRunAt: Date.now() + SYNC_AFTER_MS };
    return { lastOkAt, next, also: [] };
  }
  return { lastOkAt, next: { nextRunAt: null }, also: [previewReady(env, importId, 0)] };
}
