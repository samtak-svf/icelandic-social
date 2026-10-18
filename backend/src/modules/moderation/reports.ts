import { db } from "../../env/index.ts";
import type { REPORT_KINDS, REPORT_REASONS } from "../../api/moderation.ts";
import { standing } from "../communities/index.ts";
import { authors, commentAccess, postAccess } from "../social/index.ts";

// Reports (decision 0063): what an account saw and reported, kept without
// showing who reported it. A report goes to one queue, its community's or
// Samtak's, and stays open until a moderator closes it.

type Kind = (typeof REPORT_KINDS)[number];
type Reason = (typeof REPORT_REASONS)[number];

const hex = (n: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");

/** Where a report on what `reporter` sees goes; null when it sees no such thing. */
async function placeOf(
  env: Env,
  reporter: string,
  kind: Kind,
  id: string,
): Promise<{ communityId: string | null; targetAccount: string | null } | null> {
  switch (kind) {
    case "post": {
      const found = await postAccess(env, reporter, id);
      return found && { communityId: found.post.communityId, targetAccount: found.post.authorId };
    }
    case "comment": {
      const found = await commentAccess(env, reporter, id);
      return found && { communityId: found.post.communityId, targetAccount: found.comment.author };
    }
    case "community": {
      const found = await standing(env, reporter, id);
      return found && !found.banned ? { communityId: id, targetAccount: null } : null;
    }
    case "account":
      return (await authors(env, [id])).has(id) ? { communityId: null, targetAccount: id } : null;
  }
}

/** Files `reporter`'s report; false when it sees nothing by that reference. */
export async function fileReport(
  env: Env,
  reporter: string,
  input: { target: { kind: Kind; id: string }; reason: Reason; note: string; toPlatform: boolean },
): Promise<boolean> {
  const { kind, id } = input.target;
  const place = await placeOf(env, reporter, kind, id);
  if (!place) return false;
  // Samtak answers for unlawful content, and for communities and accounts (0063).
  const toPlatform =
    input.toPlatform || input.reason === "unlawful" || kind === "community" || kind === "account";
  await db(env)
    .prepare(
      `INSERT OR IGNORE INTO reports
         (report_id, community_id, target_kind, target_id, target_account, reporter_id, reason,
          note, to_platform, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      `r_${hex(16)}`,
      place.communityId,
      kind,
      id,
      place.targetAccount,
      reporter,
      input.reason,
      input.note,
      toPlatform ? 1 : 0,
      Date.now(),
    )
    .run();
  return true;
}

type Row = {
  report_id: string;
  community_id: string | null;
  target_kind: Kind;
  target_id: string;
  target_account: string | null;
  reason: Reason;
  note: string;
  state: "open" | "closed";
  created_at: number;
  closed_at: number | null;
};

/** A page of a queue, oldest first: a community's, or with null Samtak's. */
export async function reportPage(
  env: Env,
  communityId: string | null,
  query: { state: "open" | "closed"; after?: string; limit: number },
) {
  const cut = query.after?.indexOf("-") ?? -1;
  const after = query.after && {
    t: Number(query.after.slice(0, cut)),
    id: query.after.slice(cut + 1),
  };
  // Never the reporter: no column of it is read.
  const { results } = await db(env)
    .prepare(
      `SELECT report_id, community_id, target_kind, target_id, target_account, reason, note,
              state, created_at, closed_at
         FROM reports
        WHERE (CASE WHEN ?1 IS NULL THEN to_platform = 1
                    ELSE community_id = ?1 AND to_platform = 0 END)
          AND state = ?2
          AND (?3 IS NULL OR created_at > ?3 OR (created_at = ?3 AND report_id > ?4))
        ORDER BY created_at, report_id LIMIT ?5`,
    )
    .bind(
      communityId,
      query.state,
      after ? after.t : null,
      after ? after.id : null,
      query.limit + 1,
    )
    .all<Row>();
  const page = results.slice(0, query.limit);
  const names = await authors(
    env,
    page.flatMap((r) => (r.target_account === null ? [] : [r.target_account])),
  );
  const last = page.at(-1);
  return {
    reports: page.map((r) => ({
      reportId: r.report_id,
      communityId: r.community_id,
      target: { kind: r.target_kind, id: r.target_id },
      targetAccount: r.target_account === null ? null : (names.get(r.target_account) ?? null),
      reason: r.reason,
      note: r.note,
      state: r.state,
      createdAt: r.created_at,
      closedAt: r.closed_at,
    })),
    next: results.length > query.limit && last ? `${last.created_at}-${last.report_id}` : null,
  };
}

export type OpenReport = { reportId: string; communityId: string | null; toPlatform: boolean };

/** An open report's queue, or null when there is no such open report. */
export async function openReport(env: Env, reportId: string): Promise<OpenReport | null> {
  const row = await db(env)
    .prepare(
      `SELECT community_id AS communityId, to_platform AS toPlatform
         FROM reports WHERE report_id = ? AND state = 'open'`,
    )
    .bind(reportId)
    .first<{ communityId: string | null; toPlatform: number }>();
  return row && { reportId, communityId: row.communityId, toPlatform: row.toPlatform === 1 };
}

/** Whether `accountId` is on Samtak's list of platform moderators (decision 0063). */
export async function isPlatformModerator(env: Env, accountId: string): Promise<boolean> {
  const row = await db(env)
    .prepare("SELECT 1 FROM platform_moderators WHERE account_id = ?")
    .bind(accountId)
    .first();
  return row !== null;
}

/** The statement that closes a report, for the batch of the action or entry with it. */
export function closing(env: Env, reportId: string, by: string): D1PreparedStatement {
  return db(env)
    .prepare(
      `UPDATE reports SET state = 'closed', closed_at = ?, closed_by = ?
        WHERE report_id = ? AND state = 'open'`,
    )
    .bind(Date.now(), by, reportId);
}

/** A closed report is kept this long (decision 0063). */
export const CLOSED_KEPT_MS = 365 * 24 * 60 * 60 * 1000;

/** Deletes the reports closed more than a year before `now`; their count. */
export async function expireReports(env: Env, now = Date.now()): Promise<number> {
  const { meta } = await db(env)
    .prepare("DELETE FROM reports WHERE state = 'closed' AND closed_at < ?")
    .bind(now - CLOSED_KEPT_MS)
    .run();
  return meta.changes;
}
