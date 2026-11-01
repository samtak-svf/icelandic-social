import { db, mediaBucket } from "../../env/index.ts";
import { abortUpload } from "../../shared/multipart.ts";
import { job } from "../jobs/index.ts";
import { checkpointKey, loadCheckpoint, zipKey } from "./checkpoint.ts";

// The exports table (decision 0126), written only here.

const DAY_MS = 24 * 60 * 60 * 1000;
/** A file is kept this long after it is ready. */
const KEPT_MS = 7 * DAY_MS;
/** One export per account in this long, unless the last failed. */
const SPACING_MS = DAY_MS;
/** A build still running after this long is dead: it counts as failed, and frees the account. */
const STALLED_MS = DAY_MS;
export const BUILD = "export.build";

export type ExportRow = {
  exportId: string;
  accountId: string;
  state: "building" | "ready" | "failed";
  failure: string | null;
  size: number | null;
  createdAt: number;
  expiresAt: number;
};

const COLUMNS = `export_id AS exportId, account_id AS accountId, state, failure, size,
                 created_at AS createdAt, expires_at AS expiresAt`;

/** A building row past STALLED_MS reads as failed, so the person sees an end and may ask again. */
export const asRead = (row: ExportRow, now: number): ExportRow =>
  row.state === "building" && row.createdAt <= now - STALLED_MS
    ? { ...row, state: "failed", failure: "stalled" }
    : row;

export async function getExport(env: Env, exportId: string): Promise<ExportRow | null> {
  return db(env)
    .prepare(`SELECT ${COLUMNS} FROM exports WHERE export_id = ?`)
    .bind(exportId)
    .first<ExportRow>();
}

/** The account's exports not yet expired, newest first. */
export async function exportsOf(env: Env, accountId: string, now: number): Promise<ExportRow[]> {
  const { results } = await db(env)
    .prepare(
      `SELECT ${COLUMNS} FROM exports WHERE account_id = ? AND expires_at > ?
        ORDER BY created_at DESC, export_id`,
    )
    .bind(accountId, now)
    .all<ExportRow>();
  return results.map((row) => asRead(row, now));
}

export const buildJob = (env: Env, exportId: string, run: number, ifChanged = false) =>
  job(
    env,
    { kind: BUILD, key: `export:${exportId}:${run}`, payload: { exportId, run } },
    ifChanged,
  );

/**
 * Asks for an export: the row and the first job in one batch. The row is written only when the
 * account has no build running and no file made within SPACING_MS, decided in the same
 * statement, so two requests at once make one. Null is that refusal.
 */
export async function startExport(
  env: Env,
  accountId: string,
  now: number,
): Promise<ExportRow | null> {
  const exportId = `ex_${crypto.randomUUID().replaceAll("-", "")}`;
  const [inserted] = await db(env).batch([
    db(env)
      .prepare(
        `INSERT INTO exports (export_id, account_id, state, created_at, expires_at)
         SELECT ?1, ?2, 'building', ?3, ?4
          WHERE NOT EXISTS (SELECT 1 FROM exports WHERE account_id = ?2
                               AND state IN ('building', 'ready') AND created_at > ?5)`,
      )
      .bind(exportId, accountId, now, now + KEPT_MS, now - Math.min(SPACING_MS, STALLED_MS)),
    buildJob(env, exportId, 1, true),
  ]);
  if (!inserted || inserted.meta.changes === 0) return null;
  return {
    exportId,
    accountId,
    state: "building",
    failure: null,
    size: null,
    createdAt: now,
    expiresAt: now + KEPT_MS,
  };
}

export async function markReady(env: Env, exportId: string, size: number, now: number) {
  await db(env)
    .prepare(
      "UPDATE exports SET state = 'ready', size = ?, expires_at = ? WHERE export_id = ? AND state = 'building'",
    )
    .bind(size, now + KEPT_MS, exportId)
    .run();
}

export async function markFailed(env: Env, exportId: string, failure: string) {
  await db(env)
    .prepare(
      "UPDATE exports SET state = 'failed', failure = ? WHERE export_id = ? AND state = 'building'",
    )
    .bind(failure, exportId)
    .run();
}

/** Removes every byte of an export: a running upload, its checkpoint and the file. */
async function dropBytes(env: Env, exportId: string): Promise<void> {
  const bucket = mediaBucket(env);
  const saved = await loadCheckpoint(env, exportId);
  if (saved) await abortUpload(bucket, zipKey(exportId), saved.checkpoint.uploadId);
  await bucket.delete([checkpointKey(exportId), zipKey(exportId)]);
}

/** Deletes the account's exports with their bytes, for the deletion of the account. */
export async function deleteAccountExports(env: Env, accountId: string): Promise<void> {
  const { results } = await db(env)
    .prepare("SELECT export_id AS id FROM exports WHERE account_id = ?")
    .bind(accountId)
    .all<{ id: string }>();
  for (const { id } of results) await dropBytes(env, id);
  await db(env).prepare("DELETE FROM exports WHERE account_id = ?").bind(accountId).run();
}

/** The daily sweep: deletes the exports past `expires_at` with their bytes; how many. */
export async function expireExports(env: Env, now = Date.now()): Promise<number> {
  const { results } = await db(env)
    .prepare("SELECT export_id AS id FROM exports WHERE expires_at <= ? LIMIT 200")
    .bind(now)
    .all<{ id: string }>();
  for (const { id } of results) {
    await dropBytes(env, id);
    await db(env).prepare("DELETE FROM exports WHERE export_id = ?").bind(id).run();
  }
  return results.length;
}
