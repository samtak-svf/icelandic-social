import { db } from "../../env/index.ts";
import { openImport } from "./core.ts";
import { SOURCE_KEY } from "./export-file.ts";
import { removeFile } from "./file.ts";
import { profileAddress, scrapeSettings } from "./scrape.ts";

// A connection to a public profile (decision 0120). A scraper reads anyone's public
// profile, so nothing comes in until the person has published a one-time code there;
// the author of that post is pinned, and only that author's posts come in afterwards.
// This file is what the person does; scrape-jobs.ts is the runs.

/** Connections per person, and checks per connection: each check is a paid run. */
const MAX_CONNECTIONS = 3;
const MAX_CHECKS = 10;
/** A connection never proven is dropped after this. */
const UNPROVEN_KEPT_MS = 30 * 24 * 60 * 60 * 1000;

export type Row = {
  importId: string;
  accountId: string;
  source: string;
  audience: "friends" | "everyone";
  profileUrl: string;
  code: string;
  authorId: string | null;
  phase: "unproven" | "backlog" | "sync";
  checks: number;
  nextRunAt: number | null;
  runId: string | null;
  runStartedAt: number | null;
  runMonth: string | null;
  runCeiling: number | null;
  outcome: "not_found" | "capped" | "failed" | "ok" | null;
  lastOkAt: number | null;
  /** The state of the preview of the first collection, while there is one. */
  fileState: string | null;
};

const COLUMNS = `c.import_id AS importId, s.account_id AS accountId, s.source, s.audience,
  c.profile_url AS profileUrl, c.code, c.author_id AS authorId, c.phase, c.checks,
  c.next_run_at AS nextRunAt, c.run_id AS runId, c.run_started_at AS runStartedAt,
  c.run_month AS runMonth, c.run_ceiling AS runCeiling, c.outcome, c.last_ok_at AS lastOkAt,
  f.state AS fileState`;

const TABLES = `import_connections c JOIN import_sources s USING (import_id)
  LEFT JOIN import_files f USING (import_id)`;

/** A connection nobody has asked to remove. */
export const rowOf = (env: Env, importId: string) =>
  db(env)
    .prepare(`SELECT ${COLUMNS} FROM ${TABLES} WHERE c.import_id = ? AND s.removing_at IS NULL`)
    .bind(importId)
    .first<Row>();

export type Connection = {
  importId: string;
  profileUrl: string;
  /** What the person publishes on the profile; null once it has been found. */
  code: string | null;
  /** `preview`: the first collection waits for the person to choose from it. */
  state: "unproven" | "checking" | "importing" | "preview" | "connected";
  outcome: Row["outcome"];
  posts: number;
  lastSyncAt: number | null;
};

async function connectionOf(env: Env, row: Row): Promise<Connection> {
  const count = await db(env)
    .prepare(
      "SELECT COUNT(*) AS posts FROM imported_posts WHERE import_id = ? AND done_at IS NOT NULL",
    )
    .bind(row.importId)
    .first<{ posts: number }>();
  const out = row.runId !== null || row.nextRunAt !== null;
  return {
    importId: row.importId,
    profileUrl: row.profileUrl,
    code: row.authorId ? null : row.code,
    state:
      row.phase === "unproven"
        ? out
          ? "checking"
          : "unproven"
        : row.phase === "backlog"
          ? row.fileState === "ready"
            ? "preview"
            : "importing"
          : "connected",
    outcome: row.outcome,
    posts: count?.posts ?? 0,
    lastSyncAt: row.lastOkAt,
  };
}

/** Starts a connection, unproven. Nothing is public unless the person chose it. */
export async function createConnection(
  env: Env,
  accountId: string,
  input: { profileUrl: string; audience?: "friends" | "everyone" | undefined },
): Promise<Connection | "unavailable" | "invalid_request" | "conflict"> {
  const settings = scrapeSettings(env);
  if (!settings) return "unavailable";
  const profileUrl = profileAddress(settings, input.profileUrl);
  if (!profileUrl) return "invalid_request";
  const held = await db(env)
    .prepare(
      `SELECT COUNT(*) AS held FROM import_connections c JOIN import_sources s USING (import_id)
        WHERE s.account_id = ? AND s.removing_at IS NULL`,
    )
    .bind(accountId)
    .first<{ held: number }>();
  if ((held?.held ?? 0) >= MAX_CONNECTIONS) return "conflict";
  // The export file's source key, so that a post both routes name exists once.
  const opened = await openImport(env, accountId, {
    kind: "profile",
    source: SOURCE_KEY,
    audience: input.audience,
  });
  const random = crypto.getRandomValues(new Uint8Array(6));
  const code = Array.from(random, (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
  await db(env)
    .prepare(
      `INSERT INTO import_connections (import_id, profile_url, code, phase, created_at)
       VALUES (?, ?, ?, 'unproven', ?)`,
    )
    .bind(opened.importId, profileUrl, code, Date.now())
    .run();
  const row = await rowOf(env, opened.importId);
  if (!row) throw new Error(`import ${opened.importId}: the connection is gone`);
  return connectionOf(env, row);
}

/** The person's connections. */
export async function listConnections(env: Env, accountId: string): Promise<Connection[]> {
  const { results } = await db(env)
    .prepare(
      `SELECT ${COLUMNS} FROM ${TABLES}
        WHERE s.account_id = ? AND s.removing_at IS NULL ORDER BY c.created_at`,
    )
    .bind(accountId)
    .all<Row>();
  return Promise.all(results.map((row) => connectionOf(env, row)));
}

/** Asks for the code to be looked for on the profile. */
export async function askForCheck(
  env: Env,
  accountId: string,
  importId: string,
): Promise<Connection | "unavailable" | "not_found" | "conflict"> {
  if (!scrapeSettings(env)) return "unavailable";
  const row = await rowOf(env, importId);
  if (!row || row.accountId !== accountId) return "not_found";
  const asked = await db(env)
    .prepare(
      `UPDATE import_connections SET next_run_at = ?, checks = checks + 1, outcome = NULL
        WHERE import_id = ? AND phase = 'unproven' AND run_id IS NULL AND next_run_at IS NULL
          AND run_started_at IS NULL AND checks < ?`,
    )
    .bind(Date.now(), importId, MAX_CHECKS)
    .run();
  if (asked.meta.changes === 0) return "conflict";
  const now = await rowOf(env, importId);
  if (!now) return "not_found";
  return connectionOf(env, now);
}

/**
 * Stops a connection and removes what it brought in. A run still out at the provider
 * finds no connection when its job next looks, and its figure stays counted.
 */
export async function removeConnection(
  env: Env,
  accountId: string,
  importId: string,
): Promise<"ok" | "not_found"> {
  const row = await rowOf(env, importId);
  if (!row || row.accountId !== accountId) return "not_found";
  return removeFile(env, accountId, importId);
}

/** Drops the connections never proven, with their imports; how many. */
export async function expireUnproven(env: Env, now = Date.now()): Promise<number> {
  // RETURNING, because the count of changes takes in the connection the cascade removes.
  const { results } = await db(env)
    .prepare(
      `DELETE FROM import_sources WHERE import_id IN (
         SELECT import_id FROM import_connections
          WHERE author_id IS NULL AND run_id IS NULL AND created_at < ?)
       RETURNING import_id`,
    )
    .bind(now - UNPROVEN_KEPT_MS)
    .all();
  return results.length;
}
