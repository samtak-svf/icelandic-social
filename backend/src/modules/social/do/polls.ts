// A space's polls (decision 0090): the rows, the votes and the counts as one
// viewer sees them. Plain functions over the object's SQL, like comment-reads.
// Nothing here reads any account but the viewer's own vote row.

import type { Viewer } from "./comment-reads.ts";
import { optionId } from "./space-schema.ts";

/** A poll as one viewer sees it (decision 0090): counts only where the viewer may see them. */
export type PollView = {
  options: { optionId: string; text: string; votes: number | null }[];
  total: number;
  mine: string | null;
  closed: boolean;
};

/**
 * The polls among `ids` as `viewer` sees them (decision 0090). The counts of
 * the options are read only where the viewer has voted, wrote the poll,
 * moderates here, or the poll is closed; `total` is always shown. Nothing
 * here reads any account but the viewer's own row.
 */
export function readPolls(
  sql: SqlStorage,
  ids: string[],
  viewer: Viewer,
  authors: Map<string, string>,
): Map<string, PollView> {
  const wanted = JSON.stringify(ids);
  const options = sql
    .exec<{ post_id: string; option_id: string; text: string }>(
      `SELECT post_id, option_id, text FROM poll_options
          WHERE post_id IN (SELECT value FROM json_each(?)) ORDER BY post_id, position`,
      wanted,
    )
    .toArray();
  const out = new Map<string, PollView>();
  if (options.length === 0) return out;
  const counts = new Map(
    sql
      .exec<{ post_id: string; option_id: string; n: number }>(
        `SELECT post_id, option_id, COUNT(*) AS n FROM poll_votes
            WHERE post_id IN (SELECT value FROM json_each(?)) GROUP BY post_id, option_id`,
        wanted,
      )
      .toArray()
      .map((r) => [`${r.post_id}|${r.option_id}`, r.n]),
  );
  const mine = new Map(
    sql
      .exec<{ post_id: string; option_id: string }>(
        `SELECT post_id, option_id FROM poll_votes
            WHERE account = ? AND post_id IN (SELECT value FROM json_each(?))`,
        viewer.account,
        wanted,
      )
      .toArray()
      .map((r) => [r.post_id, r.option_id]),
  );
  const closed = new Set(
    sql
      .exec<{ post_id: string }>(
        "SELECT post_id FROM poll_closed WHERE post_id IN (SELECT value FROM json_each(?))",
        wanted,
      )
      .toArray()
      .map((r) => r.post_id),
  );
  for (const o of options) {
    const poll = out.get(o.post_id) ?? {
      options: [],
      total: 0,
      mine: mine.get(o.post_id) ?? null,
      closed: closed.has(o.post_id),
    };
    const votes = counts.get(`${o.post_id}|${o.option_id}`) ?? 0;
    const sees =
      poll.mine !== null ||
      poll.closed ||
      viewer.moderator ||
      authors.get(o.post_id) === viewer.account;
    poll.options.push({ optionId: o.option_id, text: o.text, votes: sees ? votes : null });
    poll.total += votes;
    out.set(o.post_id, poll);
  }
  return out;
}

/**
 * Sets, changes or (with null) withdraws `account`'s vote on a poll
 * (decision 0090): "absent" when there is no such poll here, "closed",
 * "unknown_option", or "ok".
 */
export function castVote(
  sql: SqlStorage,
  postId: string,
  account: string,
  option: string | null,
): "absent" | "closed" | "unknown_option" | "ok" {
  const isPoll = sql
    .exec("SELECT 1 FROM poll_options WHERE post_id = ? LIMIT 1", postId)
    .toArray().length;
  if (!isPoll) return "absent";
  if (sql.exec("SELECT 1 FROM poll_closed WHERE post_id = ?", postId).toArray().length) {
    return "closed";
  }
  if (option === null) {
    sql.exec("DELETE FROM poll_votes WHERE post_id = ? AND account = ?", postId, account);
    return "ok";
  }
  const known = sql
    .exec("SELECT 1 FROM poll_options WHERE post_id = ? AND option_id = ?", postId, option)
    .toArray().length;
  if (!known) return "unknown_option";
  sql.exec(
    `INSERT INTO poll_votes (post_id, account, option_id) VALUES (?, ?, ?)
       ON CONFLICT (post_id, account) DO UPDATE SET option_id = excluded.option_id`,
    postId,
    account,
    option,
  );
  return "ok";
}

/** Whether `postId` is no poll, an open one or a closed one (decision 0090). */
export function pollStatus(sql: SqlStorage, postId: string): "none" | "open" | "closed" {
  const isPoll = sql
    .exec("SELECT 1 FROM poll_options WHERE post_id = ? LIMIT 1", postId)
    .toArray().length;
  if (!isPoll) return "none";
  return sql.exec("SELECT 1 FROM poll_closed WHERE post_id = ?", postId).toArray().length
    ? "closed"
    : "open";
}

/** Closes a poll; closing a closed one changes nothing. */
export function closePoll(sql: SqlStorage, postId: string): void {
  sql.exec(
    "INSERT OR IGNORE INTO poll_closed (post_id, closed_at) VALUES (?, ?)",
    postId,
    Date.now(),
  );
}

export function purgePoll(sql: SqlStorage, postId: string): void {
  for (const table of ["poll_options", "poll_votes", "poll_closed"]) {
    sql.exec(`DELETE FROM ${table} WHERE post_id = ?`, postId);
  }
}

/** Stores a poll's options in the order given. */
export function addOptions(sql: SqlStorage, postId: string, texts: string[]): void {
  texts.forEach((text, position) => {
    sql.exec(
      "INSERT OR IGNORE INTO poll_options (post_id, option_id, position, text) VALUES (?, ?, ?, ?)",
      postId,
      optionId(position),
      position,
      text,
    );
  });
}
