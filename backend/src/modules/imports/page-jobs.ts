import { db } from "../../env/index.ts";
import { log } from "../../shared/log.ts";
import { job, type Handler } from "../jobs/index.ts";
import { openPreview, stageItem, stagedPosts } from "./connection-preview.ts";
import { importPost } from "./core.ts";
import { previewReady } from "./file-jobs.ts";
import { dropFile, SYNC_AFTER_MS } from "./file.ts";
import { type PageSettings, pageSettings, readPosts, TokenGone } from "./page.ts";
import { openToken, type PageRow, pageRowOf } from "./pages.ts";
import { sourcePost, type ScrapedItem } from "./scrape.ts";

// The runs of a page connection (decision 0120): one job takes the connection and the
// parts follow, each a job small enough for a Worker's limits. Nothing is read while the
// feed is switched off. A run's lease is `next_run_at`, pushed an hour ahead by each part,
// so a run that died is started again from the top, and every write it repeats is a
// no-op: a post has one row by its id, in the preview and in the feed.

const RUN = "imports.page.run";
const PART = "imports.page.part";
const HOUR_MS = 60 * 60 * 1000;
/** Posts one job reads: each may fetch and store several images. */
const POSTS_PER_PART = 10;
/** The posts a first collection offers. */
const BACKLOG_POSTS = 200;

/** Run by the minute cron: writes the job of each connection that is due. */
export async function startDuePages(env: Env, now = Date.now()): Promise<void> {
  if (!pageSettings(env)) return;
  const { results } = await db(env)
    .prepare(
      `SELECT c.import_id AS importId, c.next_run_at AS due
         FROM import_page_connections c JOIN import_sources s USING (import_id)
        WHERE c.next_run_at <= ? AND s.removing_at IS NULL LIMIT 25`,
    )
    .bind(now)
    .all<{ importId: string; due: number }>();
  if (results.length === 0) return;
  await db(env).batch(
    results.map(({ importId, due }) =>
      job(env, { kind: RUN, key: `${RUN}:${importId}:${due}`, payload: { importId, due } }),
    ),
  );
}

type Part = { importId: string; runStart: number; after: string | null; taken: number };

const partJob = (env: Env, part: Part, ifChanged = false) =>
  job(
    env,
    {
      kind: PART,
      key: `${PART}:${part.importId}:${part.runStart}:${part.after ?? ""}`,
      payload: part,
    },
    ifChanged,
  );

const takeRun: Handler = async (env, _key, payload) => {
  const { importId, due } = payload as { importId: string; due: number };
  const now = Date.now();
  const take = (runStart: number | null) =>
    db(env)
      .prepare(
        `UPDATE import_page_connections SET next_run_at = ?, run_started_at = ?
          WHERE import_id = ? AND next_run_at = ?`,
      )
      .bind(now + HOUR_MS, runStart, importId, due);
  // Switched off since this job was written: it looks again in an hour.
  if (!pageSettings(env)) {
    await take(null).run();
    return;
  }
  await db(env).batch([
    take(now),
    partJob(env, { importId, runStart: now, after: null, taken: 0 }, true),
  ]);
};

const endRun = (
  env: Env,
  importId: string,
  fields: {
    outcome: "expired" | "failed" | "ok";
    nextRunAt: number | null;
    lastOkAt?: number;
    phase?: "sync";
  },
) =>
  db(env)
    .prepare(
      `UPDATE import_page_connections
          SET outcome = ?1, next_run_at = ?2, run_started_at = NULL,
              last_ok_at = COALESCE(?3, last_ok_at), phase = COALESCE(?4, phase)
        WHERE import_id = ?5`,
    )
    .bind(
      fields.outcome,
      fields.nextRunAt,
      fields.lastOkAt ?? null,
      fields.phase ?? null,
      importId,
    );

/** The first collection is read: it now waits for the person, if it holds anything. */
async function endBacklog(env: Env, row: PageRow, runStart: number): Promise<void> {
  const { posts, latest } = await stagedPosts(env, row.importId);
  if (posts === 0) {
    await dropFile(env, row.importId);
    await endRun(env, row.importId, {
      outcome: "ok",
      phase: "sync",
      nextRunAt: Date.now() + SYNC_AFTER_MS,
      lastOkAt: runStart,
    }).run();
    return;
  }
  await db(env).batch([
    previewReady(env, row.importId, 0),
    endRun(env, row.importId, {
      outcome: "ok",
      nextRunAt: null,
      // Past a post written during the run, which the person has seen and may leave out.
      lastOkAt: Math.max(runStart, latest + 1),
    }),
  ]);
}

/** Brings in one part's new posts; whether the part reached what an earlier run saw. */
async function syncItems(env: Env, row: PageRow, items: ScrapedItem[]): Promise<boolean> {
  const source = {
    importId: row.importId,
    accountId: row.accountId,
    source: row.source,
    audience: row.audience,
  };
  for (const item of items) {
    // Newest first, and the person has seen anything older and may have left it out.
    if (item.createdAt < (row.lastOkAt ?? 0)) return true;
    await importPost(env, source, sourcePost(item), "sync");
  }
  return false;
}

async function readPart(env: Env, settings: PageSettings, row: PageRow, part: Part): Promise<void> {
  const token = await openToken(settings.key, row.token);
  // Sealed under a key since replaced: to the person it is the same as a lapsed token.
  if (token === null) throw new TokenGone("seal");
  const first = row.phase === "backlog";
  const count = first ? Math.min(POSTS_PER_PART, BACKLOG_POSTS - part.taken) : POSTS_PER_PART;
  const { items, after } = await readPosts(settings, row.pageId, token, part.after, count);
  let done = false;
  if (first) {
    if (part.after === null) await openPreview(env, row.importId);
    for (const item of items) await stageItem(env, row.importId, item);
  } else {
    done = await syncItems(env, row, items);
  }
  const taken = part.taken + items.length;
  if (after && !done && (!first || taken < BACKLOG_POSTS)) {
    await db(env).batch([
      db(env)
        .prepare("UPDATE import_page_connections SET next_run_at = ? WHERE import_id = ?")
        .bind(Date.now() + HOUR_MS, row.importId),
      partJob(env, { ...part, after, taken }),
    ]);
    return;
  }
  if (first) return endBacklog(env, row, part.runStart);
  await endRun(env, row.importId, {
    outcome: "ok",
    nextRunAt: Date.now() + SYNC_AFTER_MS,
    // From when the run began, so a post written while it ran is asked for next time.
    lastOkAt: part.runStart,
  }).run();
}

const runPart: Handler = async (env, _key, payload) => {
  const part = payload as Part;
  const row = await pageRowOf(env, part.importId);
  const settings = pageSettings(env);
  if (!row || row.runStartedAt !== part.runStart || !settings) return;
  try {
    await readPart(env, settings, row, part);
  } catch (error) {
    if (error instanceof TokenGone) {
      await endRun(env, part.importId, { outcome: "expired", nextRunAt: null }).run();
      log("imports.page_token_refused", { accountId: row.accountId });
      return;
    }
    await endRun(env, part.importId, { outcome: "failed", nextRunAt: Date.now() + HOUR_MS }).run();
    log("imports.page_failed", { accountId: row.accountId });
  }
};

/** The handlers of the jobs of a page connection. */
export const pageJobHandlers = (): Record<string, Handler> => ({
  [RUN]: takeRun,
  [PART]: runPart,
});
