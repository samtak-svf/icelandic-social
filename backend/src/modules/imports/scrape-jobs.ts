import { db } from "../../env/index.ts";
import { log } from "../../shared/log.ts";
import { job, type Handler } from "../jobs/index.ts";
import { rowOf, type Row } from "./connections.ts";
import { openPreview, stageItem, stagedPosts } from "./connection-preview.ts";
import { importPost, type ImportSource } from "./core.ts";
import { previewReady } from "./file-jobs.ts";
import { dropFile, SYNC_AFTER_MS } from "./file.ts";
import {
  loadImage,
  readItems,
  readRun,
  runCeiling,
  scrapeSettings,
  startRun,
  type ScrapedItem,
} from "./scrape.ts";

// The runs of a connection (decision 0120): a run is started by a job, polled by a job
// a minute, and read in job-sized parts.

const START = "imports.scrape.start";
const COLLECT = "imports.scrape.collect";
const ITEMS = "imports.scrape.items";

const LIMIT = { unproven: 5, backlog: 200, sync: 20 } as const;
/** Posts one job reads: each may fetch and store several images. */
const ITEMS_PER_RUN = 10;
/** How many minutes a run may take before it counts as failed. */
const POLLS = 30;
const HOUR_MS = 60 * 60 * 1000;
/** A claim whose run never got stored, because the Worker died, is taken back after this. */
const LOST_RUN_MS = 30 * 60 * 1000;
/** A run whose jobs have given up, its figure never read, is written off after this. */
const DEAD_RUN_MS = 6 * HOUR_MS;

const monthOf = (at: number) => new Date(at).toISOString().slice(0, 7);

/**
 * Run by the minute cron: writes the job of each connection that is due, and frees
 * one whose Worker died between taking it and storing its run. Reads nothing while
 * the feed is switched off, and no new run starts.
 */
export async function startDueScrapes(env: Env, now = Date.now()): Promise<void> {
  if (!scrapeSettings(env)) return;
  await db(env)
    .prepare(
      `UPDATE import_connections SET next_run_at = ?1, run_started_at = NULL
        WHERE run_id IS NULL AND next_run_at IS NULL AND run_started_at < ?2`,
    )
    .bind(now, now - LOST_RUN_MS)
    .run();
  await db(env)
    .prepare(
      `UPDATE import_connections
          SET run_id = NULL, run_started_at = NULL, run_month = NULL, run_ceiling = NULL,
              outcome = 'failed',
              next_run_at = CASE WHEN phase = 'unproven' THEN NULL ELSE ?1 END
        WHERE run_id IS NOT NULL AND run_started_at < ?2`,
    )
    .bind(now + HOUR_MS, now - DEAD_RUN_MS)
    .run();
  const { results } = await db(env)
    .prepare(
      `SELECT import_id AS importId, next_run_at AS due FROM import_connections
        WHERE next_run_at <= ? LIMIT 25`,
    )
    .bind(now)
    .all<{ importId: string; due: number }>();
  if (results.length === 0) return;
  await db(env).batch(
    results.map(({ importId, due }) =>
      job(env, {
        kind: START,
        key: `${START}:${importId}:${due}`,
        payload: { importId, due },
      }),
    ),
  );
}

/** Puts a due connection off, so that a new job, under a new key, takes it later. */
const putOff = (env: Env, importId: string, due: number, at: number, outcome: Row["outcome"]) =>
  db(env)
    .prepare(
      "UPDATE import_connections SET next_run_at = ?, outcome = ? WHERE import_id = ? AND next_run_at = ?",
    )
    .bind(at, outcome, importId, due)
    .run();

/** Adds a run's ceiling to the month, unless that would pass the cap. */
async function reserve(env: Env, month: string, micros: number, cap: number): Promise<boolean> {
  const reserved = await db(env)
    .prepare(
      `INSERT INTO import_scrape_spend (month, micros) SELECT ?1, ?2 WHERE ?2 <= ?3
       ON CONFLICT (month) DO UPDATE SET micros = micros + ?2 WHERE micros + ?2 <= ?3`,
    )
    .bind(month, micros, cap)
    .run();
  return reserved.meta.changes > 0;
}

const refund = (env: Env, month: string, micros: number) =>
  db(env)
    .prepare("UPDATE import_scrape_spend SET micros = MAX(0, micros - ?) WHERE month = ?")
    .bind(micros, month);

const startScrape: Handler = async (env, _key, payload) => {
  const { importId, due } = payload as { importId: string; due: number };
  const row = await rowOf(env, importId);
  if (!row || row.nextRunAt !== due) return;
  const now = Date.now();
  const settings = scrapeSettings(env);
  if (!settings) {
    await putOff(env, importId, due, now + HOUR_MS, row.outcome);
    return;
  }
  const limit = LIMIT[row.phase];
  const ceiling = runCeiling(settings, limit);
  const month = monthOf(now);
  if (!(await reserve(env, month, ceiling, settings.monthlyCapMicros))) {
    await putOff(env, importId, due, now + HOUR_MS, "capped");
    log("imports.scrape_capped", { code: month });
    return;
  }
  const taken = await db(env)
    .prepare(
      `UPDATE import_connections SET next_run_at = NULL, run_started_at = ?
        WHERE import_id = ? AND next_run_at = ?`,
    )
    .bind(now, importId, due)
    .run();
  if (taken.meta.changes === 0) {
    await refund(env, month, ceiling).run();
    return;
  }
  let runId: string;
  try {
    ({ runId } = await startRun(settings, {
      url: row.profileUrl,
      limit,
      since: row.phase === "sync" ? row.lastOkAt : null,
    }));
  } catch {
    await db(env).batch([
      refund(env, month, ceiling),
      db(env)
        .prepare(
          `UPDATE import_connections SET run_started_at = NULL, outcome = 'failed',
             next_run_at = CASE WHEN phase = 'unproven' THEN NULL ELSE ? END
           WHERE import_id = ?`,
        )
        .bind(now + HOUR_MS, importId),
    ]);
    log("imports.scrape_failed", { code: "start" });
    return;
  }
  await db(env).batch([
    db(env)
      .prepare(
        "UPDATE import_connections SET run_id = ?, run_month = ?, run_ceiling = ? WHERE import_id = ?",
      )
      .bind(runId, month, ceiling, importId),
    collectJob(env, importId, runId, 0),
  ]);
};

const collectJob = (env: Env, importId: string, runId: string, part: number) =>
  job(env, {
    kind: COLLECT,
    key: `${COLLECT}:${importId}:${runId}:${part}`,
    payload: { importId, runId, part },
  });

const itemsJob = (env: Env, importId: string, runId: string, datasetId: string, offset: number) =>
  job(env, {
    kind: ITEMS,
    key: `${ITEMS}:${importId}:${runId}:${offset}`,
    payload: { importId, runId, datasetId, offset },
  });

/**
 * Ends a run: what the connection does next, and the provider's own figure in place
 * of the ceiling when it has come through. A figure of zero means it has not, so the
 * ceiling stands; the month can only be counted too high.
 */
async function endRun(
  env: Env,
  row: Row,
  next: { micros: number; phase?: Row["phase"]; authorId?: string | null } & {
    nextRunAt: number | null;
    outcome: Row["outcome"];
    synced?: number | null;
    also?: D1PreparedStatement[];
  },
): Promise<void> {
  const back = next.micros > 0 ? Math.max(0, (row.runCeiling ?? 0) - next.micros) : 0;
  await db(env).batch([
    db(env)
      .prepare(
        `UPDATE import_connections
            SET run_id = NULL, run_started_at = NULL, run_month = NULL, run_ceiling = NULL,
                phase = ?, author_id = ?, outcome = ?, next_run_at = ?, last_ok_at = ?
          WHERE import_id = ? AND run_id = ?`,
      )
      .bind(
        next.phase ?? row.phase,
        next.authorId === undefined ? row.authorId : next.authorId,
        next.outcome,
        next.nextRunAt,
        next.synced ?? row.lastOkAt,
        row.importId,
        row.runId,
      ),
    // Only by the run that ended it, so a repeat of this job gives nothing back twice.
    db(env)
      .prepare(
        "UPDATE import_scrape_spend SET micros = MAX(0, micros - ?) WHERE month = ? AND changes() > 0",
      )
      .bind(back, row.runMonth),
    ...(next.also ?? []),
  ]);
}

const collect: Handler = async (env, _key, payload) => {
  const { importId, runId, part } = payload as { importId: string; runId: string; part: number };
  const row = await rowOf(env, importId);
  const settings = scrapeSettings(env);
  if (!row || row.runId !== runId || !settings) return;
  const run = await readRun(settings, runId);
  const retry = row.phase === "unproven" ? null : Date.now() + HOUR_MS;
  if (run.state === "running" && part < POLLS) {
    await collectJob(env, importId, runId, part + 1).run();
    return;
  }
  if (run.state !== "done") {
    await endRun(env, row, { micros: run.micros, outcome: "failed", nextRunAt: retry });
    log("imports.scrape_failed", { code: run.state });
    return;
  }
  if (row.phase !== "unproven") {
    await itemsJob(env, importId, runId, run.datasetId, 0).run();
    return;
  }
  const { items, answer } = await readItems(settings, run.datasetId, 0, LIMIT.unproven);
  const proof = items.find((item) => item.body.includes(row.code));
  if (!proof) {
    const outcome = answer === "failed" ? "failed" : "not_found";
    await endRun(env, row, { micros: run.micros, outcome, nextRunAt: null });
    return;
  }
  await endRun(env, row, {
    micros: run.micros,
    outcome: "ok",
    phase: "backlog",
    authorId: proof.authorId,
    nextRunAt: Date.now(),
  });
  log("imports.connection_proven", { accountId: row.accountId });
};

/** The run's last part is read: the first collection now waits for the person, if it holds anything. */
async function endFirstCollection(env: Env, row: Row, micros: number): Promise<void> {
  const { posts, latest } = await stagedPosts(env, row.importId);
  if (posts === 0) await dropFile(env, row.importId);
  await endRun(env, row, {
    micros,
    outcome: "ok",
    // Past a post written while the run ran, which the person has seen and may leave out.
    synced: Math.max(row.runStartedAt ?? 0, latest + 1),
    ...(posts > 0
      ? { nextRunAt: null, also: [previewReady(env, row.importId, 0)] }
      : { phase: "sync" as const, nextRunAt: Date.now() + SYNC_AFTER_MS }),
  });
}

/**
 * The code was found a moment ago and now the profile shows nothing, which says the
 * collection failed rather than that there is nothing to bring. Repeating it could cost a
 * ceiling every hour, so the person asks again, within the checks a connection has.
 */
async function giveBackFirstCollection(env: Env, row: Row, micros: number): Promise<void> {
  await dropFile(env, row.importId);
  await endRun(env, row, {
    micros,
    outcome: "failed",
    phase: "unproven",
    authorId: null,
    nextRunAt: null,
  });
  log("imports.scrape_failed", { code: "first_collection" });
}

function sourcePost(item: ScrapedItem) {
  return {
    id: item.id,
    createdAt: item.createdAt,
    body: item.body,
    images: item.images.map((url) => () => loadImage(url)),
    link: item.videoLink ?? undefined,
  };
}

/** Stages or imports one part's posts by the connection's phase; how many came in. */
async function takeItems(env: Env, row: Row, items: ScrapedItem[]): Promise<number> {
  const source: ImportSource = {
    importId: row.importId,
    accountId: row.accountId,
    source: row.source,
    audience: row.audience,
  };
  let imported = 0;
  for (const item of items) {
    // Another person's post on the profile, or the post that showed the code.
    if (item.authorId !== row.authorId || item.body.includes(row.code)) continue;
    if (row.phase === "backlog") {
      await stageItem(env, row.importId, item);
      continue;
    }
    // Older than the first collection, so the person has seen it and may have left it out.
    if (item.createdAt < (row.lastOkAt ?? 0)) continue;
    const { outcome } = await importPost(env, source, sourcePost(item), "sync");
    if (outcome === "imported") imported += 1;
  }
  return imported;
}

const importItems: Handler = async (env, _key, payload) => {
  const { importId, runId, datasetId, offset } = payload as {
    importId: string;
    runId: string;
    datasetId: string;
    offset: number;
  };
  const row = await rowOf(env, importId);
  const settings = scrapeSettings(env);
  if (!row || row.runId !== runId || !settings) return;
  const { items, read, answer } = await readItems(settings, datasetId, offset, ITEMS_PER_RUN);
  const first = row.phase === "backlog";
  if (first && offset === 0) await openPreview(env, importId);
  const imported = await takeItems(env, row, items);
  if (imported > 0) log("imports.scraped", { accountId: row.accountId, count: imported });
  if (read === ITEMS_PER_RUN) {
    await itemsJob(env, importId, runId, datasetId, offset + read).run();
    return;
  }
  // Read after the last part, since the figure lags the end of the run.
  const run = await readRun(settings, runId);
  // A later part only follows a full one, so that run has answered with rows.
  const said = offset > 0 ? "posts" : answer;
  if (first) {
    if (said !== "posts") return giveBackFirstCollection(env, row, run.micros);
    return endFirstCollection(env, row, run.micros);
  }
  if (said === "failed") {
    await endRun(env, row, {
      micros: run.micros,
      outcome: "failed",
      nextRunAt: Date.now() + HOUR_MS,
    });
    log("imports.scrape_failed", { code: "answer" });
    return;
  }
  await endRun(env, row, {
    micros: run.micros,
    outcome: "ok",
    nextRunAt: Date.now() + SYNC_AFTER_MS,
    // From when the run began, so that a post written while it ran is asked for next time.
    // An empty answer moves nothing: it may be an outage, and the next run asks from here.
    ...(said === "posts" && { synced: row.runStartedAt }),
  });
};

/** What the month has cost so far, and whether the cap stops the next run. */
export async function scrapeHealth(
  env: Env,
  now = Date.now(),
): Promise<{ spentMicros: number; capped: boolean } | null> {
  const settings = scrapeSettings(env);
  if (!settings) return null;
  const spent = await db(env)
    .prepare("SELECT micros FROM import_scrape_spend WHERE month = ?")
    .bind(monthOf(now))
    .first<{ micros: number }>();
  const spentMicros = spent?.micros ?? 0;
  return {
    spentMicros,
    capped: spentMicros + runCeiling(settings, LIMIT.sync) > settings.monthlyCapMicros,
  };
}

/** The handlers of the jobs of a connection. */
export const connectionJobHandlers = (): Record<string, Handler> => ({
  [START]: startScrape,
  [COLLECT]: collect,
  [ITEMS]: importItems,
});
