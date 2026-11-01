import { db } from "../../env/index.ts";
import { unseal } from "../../shared/seal.ts";
import { CONNECTION_JOINS, postsBroughtIn } from "./connection-rules.ts";
import { connectionsHeld, MAX_CONNECTIONS } from "./connections.ts";
import { openImport } from "./core.ts";
import { SOURCE_KEY } from "./export-file.ts";
import { removeFile } from "./file.ts";
import { pageSettings, TOKEN_LABEL } from "./page.ts";

// A connection to a page the person manages (decision 0120): what the person does.
// page-sign-in.ts offers the pages and page-jobs.ts runs the connection. A token is
// never returned, and is opened only by the job that reads with it.

export type PageRow = {
  importId: string;
  accountId: string;
  source: string;
  audience: "friends" | "everyone";
  pageId: string;
  pageName: string;
  token: string;
  phase: "backlog" | "sync";
  nextRunAt: number | null;
  runStartedAt: number | null;
  outcome: "expired" | "failed" | "ok" | null;
  lastOkAt: number | null;
  fileState: string | null;
};

const COLUMNS = `c.import_id AS importId, s.account_id AS accountId, s.source, s.audience,
  c.page_id AS pageId, c.page_name AS pageName, c.token, c.phase, c.next_run_at AS nextRunAt,
  c.run_started_at AS runStartedAt, c.outcome, c.last_ok_at AS lastOkAt, f.state AS fileState`;

const TABLES = `import_page_connections c ${CONNECTION_JOINS}`;

/** A connection nobody has asked to remove. */
export const pageRowOf = (env: Env, importId: string) =>
  db(env)
    .prepare(`SELECT ${COLUMNS} FROM ${TABLES} WHERE c.import_id = ? AND s.removing_at IS NULL`)
    .bind(importId)
    .first<PageRow>();

export type PageConnection = {
  importId: string;
  pageId: string;
  pageName: string;
  state: "importing" | "preview" | "connected";
  outcome: PageRow["outcome"];
  posts: number;
  lastSyncAt: number | null;
};

async function connectionOf(env: Env, row: PageRow): Promise<PageConnection> {
  return {
    importId: row.importId,
    pageId: row.pageId,
    pageName: row.pageName,
    state: row.phase === "sync" ? "connected" : row.fileState === "ready" ? "preview" : "importing",
    outcome: row.outcome,
    posts: await postsBroughtIn(env, row.importId),
    lastSyncAt: row.lastOkAt,
  };
}

/** Whether the feed is on, the pages on offer and the connections the person has. */
export async function listPages(env: Env, accountId: string, now = Date.now()) {
  const offers = await db(env)
    .prepare(
      `SELECT page_id AS pageId, page_name AS pageName FROM import_page_offers
        WHERE account_id = ? AND expires_at > ? ORDER BY page_name`,
    )
    .bind(accountId, now)
    .all<{ pageId: string; pageName: string }>();
  const rows = await db(env)
    .prepare(
      `SELECT ${COLUMNS} FROM ${TABLES}
        WHERE s.account_id = ? AND s.removing_at IS NULL ORDER BY c.created_at`,
    )
    .bind(accountId)
    .all<PageRow>();
  return {
    available: pageSettings(env) !== null,
    offers: offers.results,
    connections: await Promise.all(rows.results.map((row) => connectionOf(env, row))),
  };
}

/**
 * Connects a page on offer to this person. A page they already connected keeps its
 * posts and takes the new token, and one the platform had stopped accepting runs again.
 */
export async function connectPage(
  env: Env,
  accountId: string,
  input: { pageId: string; audience?: "friends" | "everyone" | undefined },
  now = Date.now(),
): Promise<PageConnection | "unavailable" | "not_found" | "conflict"> {
  const settings = pageSettings(env);
  if (!settings) return "unavailable";
  const offer = await db(env)
    .prepare(
      `SELECT page_name AS pageName, token FROM import_page_offers
        WHERE account_id = ? AND page_id = ? AND expires_at > ?`,
    )
    .bind(accountId, input.pageId, now)
    .first<{ pageName: string; token: string }>();
  if (!offer) return "not_found";
  const spend = db(env)
    .prepare("DELETE FROM import_page_offers WHERE account_id = ? AND page_id = ?")
    .bind(accountId, input.pageId);
  const held = await db(env)
    .prepare(
      `SELECT c.import_id AS importId FROM import_page_connections c JOIN import_sources s USING (import_id)
        WHERE s.account_id = ? AND c.page_id = ? AND s.removing_at IS NULL`,
    )
    .bind(accountId, input.pageId)
    .first<{ importId: string }>();
  let importId = held?.importId;
  if (importId) {
    await db(env).batch([
      db(env)
        .prepare(
          `UPDATE import_page_connections
              SET token = ?1, page_name = ?2,
                  next_run_at = CASE WHEN outcome = 'expired' THEN ?3 ELSE next_run_at END,
                  outcome = CASE WHEN outcome = 'expired' THEN NULL ELSE outcome END
            WHERE import_id = ?4`,
        )
        .bind(offer.token, offer.pageName, now, importId),
      spend,
    ]);
  } else {
    if ((await connectionsHeld(env, accountId)) >= MAX_CONNECTIONS) return "conflict";
    // The export file's source key, so that a post both routes name exists once.
    const opened = await openImport(env, accountId, {
      kind: "page",
      source: SOURCE_KEY,
      audience: input.audience,
    });
    importId = opened.importId;
    await db(env).batch([
      db(env)
        .prepare(
          `INSERT INTO import_page_connections
             (import_id, page_id, page_name, token, phase, next_run_at, created_at)
           VALUES (?1, ?2, ?3, ?4, 'backlog', ?5, ?5)`,
        )
        .bind(importId, input.pageId, offer.pageName, offer.token, now),
      spend,
    ]);
  }
  const row = await pageRowOf(env, importId);
  if (!row) throw new Error(`import ${importId}: the connection is gone`);
  return connectionOf(env, row);
}

/** Stops a connection and removes what it brought in. */
export async function removePage(
  env: Env,
  accountId: string,
  importId: string,
): Promise<"ok" | "not_found"> {
  const row = await pageRowOf(env, importId);
  if (!row || row.accountId !== accountId) return "not_found";
  return removeFile(env, accountId, importId);
}

/** Drops the offers past their hour; how many. */
export async function expirePageOffers(env: Env, now = Date.now()): Promise<number> {
  const { results } = await db(env)
    .prepare("DELETE FROM import_page_offers WHERE expires_at <= ? RETURNING page_id")
    .bind(now)
    .all();
  return results.length;
}

export const openToken = (key: string, sealed: string) => unseal<string>(key, TOKEN_LABEL, sealed);
