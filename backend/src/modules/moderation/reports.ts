import { db } from "../../env/index.ts";
import type {
  Action,
  PlatformAction,
  REPORT_KINDS,
  REPORT_REASONS,
  TARGET_STANDINGS,
  TARGET_STATES,
} from "../../api/moderation.ts";
import { suspendedAmong } from "../../identity/index.ts";
import { standing } from "../communities/index.ts";
import {
  authors,
  commentAccess,
  commentContent,
  commentMedia,
  postAccess,
  postContent,
} from "../social/index.ts";

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
      // An anonymous post's report keeps no author: a moderator reveals it, logged (0091).
      return (
        found && {
          communityId: found.post.communityId,
          targetAccount: found.post.anonymous === 1 ? null : found.post.authorId,
        }
      );
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
  closed_by: string | null;
  decision: Decision | null;
  resolution: string | null;
};

/**
 * Where the account a report reaches stands in its community now, so a
 * moderator is offered only what still applies (decision 0070): `gone` once
 * the account is deleted, null for a community, or an account reported to
 * Samtak, which stands in no community.
 */
async function standingOf(
  env: Env,
  r: Row,
  known: boolean,
): Promise<(typeof TARGET_STANDINGS)[number] | null> {
  if (r.target_kind === "community") return null;
  // A deleted account's reports keep no account (ON DELETE SET NULL).
  if (r.target_account === null || !known) return "gone";
  if (r.community_id === null) return null;
  const there = await standing(env, r.target_account, r.community_id, { deleted: true });
  if (!there?.role) return there?.banned ? "banned" : "not_member";
  if (there.role === "owner") return "owner";
  return there.mutedUntil !== null && there.mutedUntil > Date.now() ? "muted" : there.role;
}

/** What has become of a reported post or comment; null for anything else. */
async function stateOf(env: Env, r: Row): Promise<(typeof TARGET_STATES)[number] | null> {
  if (r.target_kind !== "post" && r.target_kind !== "comment") return null;
  const content = await (r.target_kind === "post" ? postContent : commentContent)(env, r.target_id);
  return content?.state ?? "gone";
}

/** Which of the posts `ids` are anonymous. */
async function anonymousPosts(env: Env, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { results } = await db(env)
    .prepare(
      `SELECT post_id FROM post_index
        WHERE anonymous = 1 AND post_id IN (SELECT value FROM json_each(?))`,
    )
    .bind(JSON.stringify(ids))
    .all<{ post_id: string }>();
  return new Set(results.map((r) => r.post_id));
}

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
              state, created_at, closed_at, closed_by, decision, resolution
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
    page.flatMap((r) => [r.target_account, r.closed_by].filter((id) => id !== null)),
  );
  const named = (id: string | null) => (id === null ? null : (names.get(id) ?? null));
  const known = (id: string | null) => id !== null && names.has(id);
  const media = await commentMedia(
    env,
    page.filter((r) => r.target_kind === "comment").map((r) => r.target_id),
  );
  const anonymous = await anonymousPosts(
    env,
    page.filter((r) => r.target_kind === "post").map((r) => r.target_id),
  );
  // Only the platform's own queue is told of a suspension (decision 0115).
  const suspended =
    communityId === null
      ? await suspendedAmong(
          env,
          page.flatMap((r) => r.target_account ?? []),
        )
      : new Set<string>();
  const last = page.at(-1);
  return {
    reports: await Promise.all(
      page.map(async (r) => ({
        reportId: r.report_id,
        communityId: r.community_id,
        target: { kind: r.target_kind, id: r.target_id },
        targetAccount: named(r.target_account),
        targetSuspended: r.target_account !== null && suspended.has(r.target_account),
        targetAnonymous: anonymous.has(r.target_id),
        reason: r.reason,
        note: r.note,
        state: r.state,
        createdAt: r.created_at,
        closedAt: r.closed_at,
        decision: r.decision,
        resolution: r.resolution,
        closedBy: named(r.closed_by),
        // An anonymous post's author stands nowhere a report shows (decision 0091).
        targetStanding: anonymous.has(r.target_id)
          ? null
          : await standingOf(env, r, known(r.target_account)),
        targetState: await stateOf(env, r),
        // A comment's report carries its image, so the moderator sees it (decision 0082).
        targetMedia: (media.get(r.target_id) ?? []).map((m) => m.mediaId),
      })),
    ),
    next: results.length > query.limit && last ? `${last.created_at}-${last.report_id}` : null,
  };
}

export type OpenReport = {
  reportId: string;
  communityId: string | null;
  toPlatform: boolean;
  targetAccount: string | null;
};

/** An open report's queue, or null when there is no such open report. */
export async function openReport(env: Env, reportId: string): Promise<OpenReport | null> {
  const row = await db(env)
    .prepare(
      `SELECT community_id AS communityId, to_platform AS toPlatform,
              target_account AS targetAccount
         FROM reports WHERE report_id = ? AND state = 'open'`,
    )
    .bind(reportId)
    .first<{ communityId: string | null; toPlatform: number; targetAccount: string | null }>();
  return row && { ...row, reportId, toPlatform: row.toPlatform === 1 };
}

/** Whether `accountId` is on Samtak's list of platform moderators (decision 0063). */
export async function isPlatformModerator(env: Env, accountId: string): Promise<boolean> {
  const row = await db(env)
    .prepare("SELECT 1 FROM platform_moderators WHERE account_id = ?")
    .bind(accountId)
    .first();
  return row !== null;
}

/**
 * How a report was closed (decision 0070): the action a moderator took on its
 * target, `dismissed` when it took none, or `community_deleted`.
 */
export type Decision = Action | PlatformAction | "dismissed" | "community_deleted";

/** The statement that closes a report, for the batch of the action or entry with it. */
export function closing(
  env: Env,
  reportId: string,
  by: string,
  decision: Decision,
  resolution: string,
): D1PreparedStatement {
  return db(env)
    .prepare(
      `UPDATE reports SET state = 'closed', closed_at = ?, closed_by = ?, decision = ?,
                          resolution = ?
        WHERE report_id = ? AND state = 'open'`,
    )
    .bind(Date.now(), by, decision, resolution, reportId);
}

/** The statement that closes every open report on a community deleted by `by` (decision 0070). */
export function closingAll(env: Env, communityId: string, by: string | null): D1PreparedStatement {
  return db(env)
    .prepare(
      `UPDATE reports SET state = 'closed', closed_at = ?, closed_by = ?,
                          decision = 'community_deleted', resolution = ''
        WHERE community_id = ? AND state = 'open'`,
    )
    .bind(Date.now(), by, communityId);
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
