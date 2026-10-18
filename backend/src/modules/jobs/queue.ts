import { db } from "../../env/index.ts";
import { log } from "../../log.ts";

// The jobs table (decision 0067): retryable work written in the same D1
// batch as the change that causes it, since there are no Cloudflare Queues
// (no jurisdiction) and D1 and a Durable Object share no transaction. The
// minute cron runs what is due, a bounded batch at a time.

/** What a job is for, and what its handler is given. */
export type Job = { kind: string; key: string; payload: Record<string, unknown> };

/** Runs one job; throws to have it tried again. Run twice, it has one effect. */
export type Handler = (env: Env, key: string, payload: Record<string, unknown>) => Promise<void>;

/** The most jobs one run takes. */
const BATCH = 25;
/** A job taken and not finished is taken again after this long. */
const LEASE_MS = 5 * 60 * 1000;
/** A job that has failed this many times is not tried again. */
export const MAX_ATTEMPTS = 5;
/** Finished jobs are kept this long, for a look at what failed. */
const FINISHED_KEPT_MS = 30 * 24 * 60 * 60 * 1000;

/** How long after its `attempts`th failure a job is tried again: 1, 2, 4, 8 minutes. */
const backoff = (attempts: number) => 60_000 * 2 ** (attempts - 1);

/**
 * The statement that writes `job`, for the batch of the change that causes
 * it. With `ifChanged` it writes only when the statement just before it in
 * the batch changed a row. A key already written is not written again.
 */
export function job(env: Env, { kind, key, payload }: Job, ifChanged = false): D1PreparedStatement {
  return db(env)
    .prepare(
      `INSERT INTO jobs (key, kind, payload, run_after, created_at)
       SELECT ?1, ?2, ?3, ?4, ?4 WHERE ${ifChanged ? "changes() > 0" : "1"}
       ON CONFLICT (key) DO NOTHING`,
    )
    .bind(key, kind, JSON.stringify(payload), Date.now());
}

type Taken = { job_id: number; key: string; kind: string; payload: string; attempts: number };

/** Runs the jobs due at `now` with `handlers`; how many finished, are retried, failed for good. */
export async function runJobs(
  env: Env,
  handlers: Record<string, Handler>,
  now = Date.now(),
): Promise<{ done: number; retried: number; failed: number }> {
  // Taking a job leases it, so a run that overlaps this one takes others.
  const { results } = await db(env)
    .prepare(
      `UPDATE jobs SET run_after = ?1 + ?2, attempts = attempts + 1
        WHERE job_id IN (SELECT job_id FROM jobs WHERE state = 'pending' AND run_after <= ?1
                          ORDER BY run_after LIMIT ?3)
        RETURNING job_id, key, kind, payload, attempts`,
    )
    .bind(now, LEASE_MS, BATCH)
    .all<Taken>();
  const counts = { done: 0, retried: 0, failed: 0 };
  for (const taken of results) {
    const outcome = await run(env, handlers, taken, now);
    counts[outcome] += 1;
  }
  return counts;
}

async function run(
  env: Env,
  handlers: Record<string, Handler>,
  taken: Taken,
  now: number,
): Promise<"done" | "retried" | "failed"> {
  const finish = (state: "pending" | "done" | "failed", error: string | null, runAfter = now) =>
    db(env)
      .prepare(
        `UPDATE jobs SET state = ?2, error = ?3, run_after = ?4,
                finished_at = CASE WHEN ?2 = 'pending' THEN NULL ELSE ?5 END
          WHERE job_id = ?1`,
      )
      .bind(taken.job_id, state, error, runAfter, now)
      .run();
  try {
    const handler = handlers[taken.kind];
    if (!handler) throw new Error(`no handler for ${taken.kind}`);
    await handler(env, taken.key, JSON.parse(taken.payload) as Record<string, unknown>);
    await finish("done", null);
    return "done";
  } catch (error) {
    // The message stays in the row, never in a log line (decision 0008).
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 200);
    const failed = taken.attempts >= MAX_ATTEMPTS;
    await finish(failed ? "failed" : "pending", message, now + backoff(taken.attempts));
    log(failed ? "job.failed" : "job.retried", { code: taken.kind, count: taken.attempts });
    return failed ? "failed" : "retried";
  }
}

/** Deletes the jobs finished more than 30 days before `now`; their count. */
export async function expireJobs(env: Env, now = Date.now()): Promise<number> {
  const { meta } = await db(env)
    .prepare("DELETE FROM jobs WHERE state != 'pending' AND finished_at < ?")
    .bind(now - FINISHED_KEPT_MS)
    .run();
  return meta.changes;
}

/** A pending job still not taken this long after its time is stuck: the cron is not running it. */
const STUCK_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** The most runs one drain makes, BATCH jobs each. */
const DRAIN_RUNS = 40;

type State = "pending" | "done" | "failed";

/**
 * Every job's count by state and kind, and the failed ones with their errors
 * (decision 0068). The errors are read by the maintainer, never logged.
 */
export async function jobsOverview(env: Env, now = Date.now()) {
  const [counts, failed, stuck] = await db(env).batch<Record<string, unknown>>([
    db(env).prepare(
      "SELECT state, kind, COUNT(*) AS count FROM jobs GROUP BY state, kind ORDER BY state, kind",
    ),
    db(env).prepare(
      `SELECT job_id AS jobId, kind, attempts, error, finished_at AS finishedAt FROM jobs
        WHERE state = 'failed' ORDER BY finished_at DESC LIMIT 100`,
    ),
    db(env)
      .prepare(
        `SELECT job_id AS jobId, kind, attempts, run_after AS runAfter FROM jobs
          WHERE state = 'pending' AND run_after < ? ORDER BY run_after LIMIT 100`,
      )
      .bind(now - STUCK_MS),
  ]);
  return {
    counts: (counts?.results ?? []) as { state: State; kind: string; count: number }[],
    failed: (failed?.results ?? []) as {
      jobId: number;
      kind: string;
      attempts: number;
      error: string | null;
      finishedAt: number;
    }[],
    stuck: (stuck?.results ?? []) as {
      jobId: number;
      kind: string;
      attempts: number;
      runAfter: number;
    }[],
  };
}

/**
 * The jobs that need a look, as counts by kind: the ones that failed for good
 * in the day before `now`, and the ones stuck (decision 0068).
 */
export async function jobHealth(
  env: Env,
  now = Date.now(),
): Promise<{ failed: Record<string, number>; stuck: Record<string, number> }> {
  const byKind = (rows: { kind: string; count: number }[]) =>
    Object.fromEntries(rows.map((r) => [r.kind, r.count]));
  const [failed, stuck] = await db(env).batch<{ kind: string; count: number }>([
    db(env)
      .prepare(
        `SELECT kind, COUNT(*) AS count FROM jobs
          WHERE state = 'failed' AND finished_at > ? GROUP BY kind`,
      )
      .bind(now - DAY_MS),
    db(env)
      .prepare(
        `SELECT kind, COUNT(*) AS count FROM jobs
          WHERE state = 'pending' AND run_after < ? GROUP BY kind`,
      )
      .bind(now - STUCK_MS),
  ]);
  return { failed: byKind(failed?.results ?? []), stuck: byKind(stuck?.results ?? []) };
}

/**
 * Makes failed jobs pending again with their attempts back at zero, so the
 * next run takes them: the ones named, or every failed one. How many.
 */
export async function retryJobs(
  env: Env,
  which: { jobIds: number[] } | { allFailed: true },
  now = Date.now(),
): Promise<number> {
  const { meta } = await db(env)
    .prepare(
      `UPDATE jobs SET state = 'pending', attempts = 0, error = NULL, run_after = ?1,
              finished_at = NULL
        WHERE state = 'failed' AND (?2 IS NULL OR job_id IN (SELECT value FROM json_each(?2)))`,
    )
    .bind(now, "jobIds" in which ? JSON.stringify(which.jobIds) : null)
    .run();
  return meta.changes;
}

/**
 * Runs the jobs due at `now` until none is left or DRAIN_RUNS runs have
 * gone, for the maintainer after an outage (decision 0068). A job that fails
 * waits its backoff, so a drain takes each job at most once.
 */
export async function drainJobs(
  env: Env,
  handlers: Record<string, Handler>,
  now = Date.now(),
): Promise<{ done: number; retried: number; failed: number; runs: number }> {
  const total = { done: 0, retried: 0, failed: 0, runs: 0 };
  while (total.runs < DRAIN_RUNS) {
    const ran = await runJobs(env, handlers, now);
    total.runs += 1;
    total.done += ran.done;
    total.retried += ran.retried;
    total.failed += ran.failed;
    if (ran.done + ran.retried + ran.failed === 0) break;
  }
  return total;
}
