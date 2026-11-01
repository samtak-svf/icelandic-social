import type { ItemClass } from "../../api/imports.ts";
import { MAX_POST_MEDIA } from "../../api/post-fields.ts";
import { db, mediaBucket } from "../../env/index.ts";
import { toHex } from "../../shared/bytes.ts";
import { log } from "../../shared/log.ts";
import { ensureWall, wallOf } from "../communities/index.ts";
import { job, type Handler } from "../jobs/index.ts";
import {
  createPost,
  deletePosts,
  deleteUnlessModerated,
  newPostId,
  upload,
} from "../social/index.ts";
import { MAX_BODY } from "./export-file.ts";

// The one core of decisions 0119 and 0120. A post has one row here whichever route
// brought it, written before the post is, so that a repeat or a retry finds it: a
// finished row answers `already`, an unfinished one belongs to a run until LEASE_MS
// has passed and is then taken over. A log line carries ids, never a text (0008).

/** How long a run holds a post it has claimed: as long as the job queue holds a job. */
const LEASE_MS = 5 * 60 * 1000;
/** How many posts one run of a removal deletes, within a run's subrequests. */
const REMOVED_PER_RUN = 50;

const REMOVE = "imports.remove";

export const keyOf = (importId: string) => `imports/${importId}`;

/** Deletes an import's bytes: the upload, and what a connection's preview stored under it. */
export async function deleteBytes(env: Env, importId: string): Promise<void> {
  const bucket = mediaBucket(env);
  await bucket.delete(keyOf(importId));
  let cursor: string | undefined;
  do {
    const page = await bucket.list({
      prefix: `${keyOf(importId)}/`,
      ...(cursor ? { cursor } : {}),
    });
    if (page.objects.length > 0) await bucket.delete(page.objects.map((o) => o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

export type ImportSource = {
  importId: string;
  accountId: string;
  source: string;
  audience: "friends" | "everyone";
};

/** A post as a feed delivers it. An image is loaded only when it will be used. */
export type SourcePost = {
  id: string;
  createdAt: number;
  body: string;
  images: (() => Promise<Uint8Array>)[];
  /** The original's address, for what does not come over; outside the fingerprint. */
  link?: string | undefined;
  /** The kind of post it is, which the person opens by; a connection's daily post has none. */
  class?: ItemClass | undefined;
};

export type ImportResult = {
  outcome: "imported" | "already" | "empty" | "stopped";
  postId: string | null;
  /** Images past what a post holds, and those that were no image. */
  imagesLeftOut: number;
  /** The text was longer than a post holds. */
  shortened: boolean;
};

const nothing = (outcome: "empty" | "stopped"): ImportResult => ({
  outcome,
  postId: null,
  imagesLeftOut: 0,
  shortened: false,
});

/** Starts an upload or a connection. Nothing is public unless the person chose it. */
export async function openImport(
  env: Env,
  accountId: string,
  input: {
    kind: "file" | "profile" | "page";
    source: string;
    audience?: "friends" | "everyone" | undefined;
  },
): Promise<ImportSource> {
  const importId = `im_${crypto.randomUUID().replaceAll("-", "")}`;
  const audience = input.audience ?? "friends";
  await db(env)
    .prepare(
      `INSERT INTO import_sources (import_id, account_id, kind, source, audience, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(importId, accountId, input.kind, input.source, audience, Date.now())
    .run();
  return { importId, accountId, source: input.source, audience };
}

/** What finds a post a second route names by another id; null when it has no text. */
async function fingerprintOf(createdAt: number, body: string): Promise<string | null> {
  if (body === "") return null;
  const text = `${Math.floor(createdAt / 1000)}\n${body}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return toHex(new Uint8Array(digest));
}

/** The text within what a post holds, in the code points the post's schema counts. */
function withinLength(body: string, room: number = MAX_BODY): string {
  const chars = Array.from(body);
  return chars.length <= room ? body : chars.slice(0, room).join("");
}

/** The post id this run writes under, or the post already there; throws while another run holds it. */
async function claim(
  env: Env,
  source: ImportSource,
  communityId: string,
  sourcePostId: string,
  fingerprint: string | null,
): Promise<{ postId: string; done: boolean }> {
  const postId = newPostId();
  const now = Date.now();
  const inserted = await db(env)
    .prepare(
      `INSERT OR IGNORE INTO imported_posts
         (account_id, source, source_post_id, fingerprint, import_id, post_id, claimed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(source.accountId, source.source, sourcePostId, fingerprint, source.importId, postId, now)
    .run();
  if (inserted.meta.changes > 0) return { postId, done: false };
  const held = await db(env)
    .prepare(
      `SELECT source_post_id AS sourcePostId, post_id AS postId, claimed_at AS claimedAt,
              done_at AS doneAt
         FROM imported_posts
        WHERE account_id = ?1 AND source = ?2 AND (source_post_id = ?3 OR fingerprint = ?4)`,
    )
    .bind(source.accountId, source.source, sourcePostId, fingerprint)
    .first<{ sourcePostId: string; postId: string; claimedAt: number; doneAt: number | null }>();
  if (held?.doneAt) return { postId: held.postId, done: true };
  if (!held || held.claimedAt > now - LEASE_MS) {
    throw new Error(`import ${source.importId}: a post is in progress`);
  }
  // The run that held it is gone, and what it wrote goes first: if two runs get
  // here, only one wins the row below, and neither has written yet.
  await deletePosts(env, communityId, [held.postId]);
  const taken = await db(env)
    .prepare(
      `UPDATE imported_posts SET post_id = ?, claimed_at = ?, import_id = ?
        WHERE account_id = ? AND source = ? AND source_post_id = ?
          AND claimed_at = ? AND done_at IS NULL`,
    )
    .bind(
      postId,
      now,
      source.importId,
      source.accountId,
      source.source,
      held.sourcePostId,
      held.claimedAt,
    )
    .run();
  if (taken.meta.changes === 0) {
    throw new Error(`import ${source.importId}: a post is in progress`);
  }
  return { postId, done: false };
}

/** Lets go of a post nothing was written for, so that a later run starts it afresh. */
const release = (env: Env, source: ImportSource, postId: string) =>
  db(env)
    .prepare("DELETE FROM imported_posts WHERE account_id = ? AND post_id = ? AND done_at IS NULL")
    .bind(source.accountId, postId)
    .run();

/** Copies the images a post holds into our own bucket (decision 0120); those that were images. */
async function carryImages(
  env: Env,
  communityId: string,
  accountId: string,
  images: SourcePost["images"],
): Promise<string[]> {
  const carried: string[] = [];
  for (const load of images.slice(0, MAX_POST_MEDIA)) {
    const bytes = await load();
    const stored = await upload(
      env,
      communityId,
      accountId,
      new Blob([bytes]).stream(),
      bytes.byteLength,
    );
    if (stored !== "invalid_image") carried.push(stored.mediaId);
  }
  return carried;
}

/**
 * Brings one post onto the person's wall, under its original date, with no notice
 * to anyone. A `backlog` post is held until the person opens it (decision 0127) and
 * stays out of the home feed after that; a `sync` post is what the person is posting
 * now, so it goes straight to the audience they chose and enters the feed.
 * Throws when another run holds the post, for the job's retry to settle.
 */
export async function importPost(
  env: Env,
  source: ImportSource,
  post: SourcePost,
  mark: "backlog" | "sync",
): Promise<ImportResult> {
  const body = post.body.trim();
  if (body === "" && !post.link && post.images.length === 0) return nothing("empty");
  const open = await db(env)
    .prepare("SELECT 1 FROM import_sources WHERE import_id = ? AND removing_at IS NULL")
    .bind(source.importId)
    .first();
  if (!open) return nothing("stopped");
  const { communityId } = await ensureWall(env, source.accountId);
  const fingerprint = await fingerprintOf(post.createdAt, body);
  const { postId, done } = await claim(env, source, communityId, post.id, fingerprint);
  if (done) return { outcome: "already", postId, imagesLeftOut: 0, shortened: false };

  let media: string[];
  try {
    media = await carryImages(env, communityId, source.accountId, post.images);
  } catch (error) {
    await release(env, source, postId);
    throw error;
  }
  if (body === "" && !post.link && media.length === 0) {
    await release(env, source, postId);
    return nothing("empty");
  }
  const link = post.link ? `\n\n${post.link}` : "";
  const text = withinLength(body, MAX_BODY - Array.from(link).length);
  const written = await createPost(env, communityId, source.accountId, {
    body: `${text}${link}`.trim(),
    media,
    audience: source.audience,
    postId,
    // A date ahead of now would hold the post at the top of every list.
    createdAt: Math.min(post.createdAt, Date.now()),
    imported: mark,
    held: mark === "backlog",
  });
  if (written === "invalid_media")
    throw new Error(`import ${source.importId}: images went missing`);
  const finished = await db(env)
    .prepare(
      `UPDATE imported_posts SET done_at = ?, class = ?
        WHERE account_id = ? AND post_id = ? AND done_at IS NULL`,
    )
    .bind(Date.now(), post.class ?? null, source.accountId, postId)
    .run();
  // A removal or a later run took the row while this one wrote: what it wrote goes.
  if (finished.meta.changes === 0) {
    await deletePosts(env, communityId, [postId]);
    return nothing("stopped");
  }
  return {
    outcome: "imported",
    postId,
    imagesLeftOut: post.images.length - media.length,
    shortened: text !== body,
  };
}

const removalJob = (env: Env, importId: string, share: number, part: number) =>
  job(env, {
    kind: REMOVE,
    key: `${REMOVE}:${importId}:${part}`,
    payload: { importId, share, part },
  });

/**
 * Stops an import and starts removing what it brought; false when it is not this
 * person's. A post a moderator took down stays down (decision 0119).
 */
export async function requestRemoval(
  env: Env,
  accountId: string,
  importId: string,
  share = REMOVED_PER_RUN,
): Promise<boolean> {
  const found = await db(env)
    .prepare("SELECT 1 FROM import_sources WHERE import_id = ? AND account_id = ?")
    .bind(importId, accountId)
    .first();
  if (!found) return false;
  await db(env).batch([
    db(env)
      .prepare(
        "UPDATE import_sources SET removing_at = ? WHERE import_id = ? AND removing_at IS NULL",
      )
      .bind(Date.now(), importId),
    removalJob(env, importId, share, 0),
  ]);
  return true;
}

/**
 * One run of a removal. A moderated post's row stays with no import, so that
 * bringing the same post in again finds it; every other row goes with its post.
 */
const removePart: Handler = async (env, _key, payload) => {
  const { importId, share, part } = payload as { importId: string; share: number; part: number };
  const source = await db(env)
    .prepare("SELECT account_id AS accountId FROM import_sources WHERE import_id = ?")
    .bind(importId)
    .first<{ accountId: string }>();
  if (!source) return;
  const { results } = await db(env)
    .prepare("SELECT post_id AS postId FROM imported_posts WHERE import_id = ? LIMIT ?")
    .bind(importId, share)
    .all<{ postId: string }>();
  const ids = results.map((r) => r.postId);
  const wall = await wallOf(env, source.accountId);
  const kept = new Set(wall ? await deleteUnlessModerated(env, wall.communityId, ids) : []);
  // Also what a collection still running stored after the removal was asked for.
  if (ids.length < share) await deleteBytes(env, importId);
  await db(env).batch([
    db(env)
      .prepare(
        `UPDATE imported_posts SET import_id = NULL
          WHERE import_id = ? AND post_id IN (SELECT value FROM json_each(?))`,
      )
      .bind(importId, JSON.stringify([...kept])),
    db(env)
      .prepare(
        `DELETE FROM imported_posts
          WHERE import_id = ? AND post_id IN (SELECT value FROM json_each(?))`,
      )
      .bind(importId, JSON.stringify(ids.filter((id) => !kept.has(id)))),
    ids.length === share
      ? removalJob(env, importId, share, part + 1)
      : db(env).prepare("DELETE FROM import_sources WHERE import_id = ?").bind(importId),
  ]);
  log("imports.removal", { accountId: source.accountId, count: ids.length });
};

/** The handlers of the jobs this module runs. */
export const jobHandlers = (): Record<string, Handler> => ({ [REMOVE]: removePart });
