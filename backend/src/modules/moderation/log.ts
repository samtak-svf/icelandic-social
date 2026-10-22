import type { Action, COMMUNITY_IMAGE_ACTIONS, REPORT_KINDS } from "../../api/moderation.ts";
import { db } from "../../env/index.ts";
import { authors, type Moderated } from "../social/index.ts";

// The moderation log (decision 0066): one entry per action, appended and
// never edited. Migration 0016's triggers refuse an edit or a deletion; an
// entry goes only with its community, and a deleted account's id becomes null.

type Logged =
  | Action
  | "close_report"
  | "delete_community"
  | "restore_community"
  | (typeof COMMUNITY_IMAGE_ACTIONS)[number];
type Kind = (typeof REPORT_KINDS)[number] | "report";

export type Entry = {
  communityId: string | null;
  actorId: string;
  asPlatform: boolean;
  action: Logged;
  targetKind: Kind;
  targetId: string;
  targetAccount: string | null;
  reason: string;
};

/** The statement that appends `e`, for the batch of the action it records. */
export function entry(env: Env, e: Entry): D1PreparedStatement {
  return db(env)
    .prepare(
      `INSERT INTO moderation_log
         (community_id, actor_id, as_platform, action, target_kind, target_id, target_account,
          reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      e.communityId,
      e.actorId,
      e.asPlatform ? 1 : 0,
      e.action,
      e.targetKind,
      e.targetId,
      e.targetAccount,
      e.reason,
      Date.now(),
    );
}

type Row = {
  entry_id: number;
  community_id: string | null;
  actor_id: string | null;
  as_platform: number;
  action: Logged;
  target_kind: Kind;
  target_id: string;
  target_account: string | null;
  reason: string;
  created_at: number;
};

/** A page of the log, newest first: one community's, or with null every community's. */
export async function logPage(
  env: Env,
  communityId: string | null,
  before: string | undefined,
  limit: number,
) {
  const { results } = await db(env)
    .prepare(
      `SELECT * FROM moderation_log
        WHERE (?1 IS NULL OR community_id = ?1) AND (?2 IS NULL OR entry_id < ?2)
        ORDER BY entry_id DESC LIMIT ?3`,
    )
    .bind(communityId, before === undefined ? null : Number(before), limit + 1)
    .all<Row>();
  const page = results.slice(0, limit);
  const names = await authors(
    env,
    page.flatMap((r) => [r.actor_id, r.target_account].filter((id) => id !== null)),
  );
  const named = (id: string | null) => (id === null ? null : (names.get(id) ?? null));
  return {
    entries: page.map((r) => ({
      entryId: r.entry_id,
      communityId: r.community_id,
      actor: named(r.actor_id),
      asPlatform: r.as_platform === 1,
      action: r.action,
      target: { kind: r.target_kind, id: r.target_id },
      targetAccount: named(r.target_account),
      reason: r.reason,
      createdAt: r.created_at,
    })),
    next: results.length > limit ? String(page.at(-1)?.entry_id) : null,
  };
}

const COMMENT_STATES = {
  hide_comment: "hidden",
  remove_comment: "removed",
  restore_comment: "visible",
} as const;

/**
 * Each comment's latest state in `communityId`'s log and when it was given,
 * for a space restored to a time before it (decision 0068).
 */
export async function commentModeration(env: Env, communityId: string): Promise<Moderated[]> {
  const { results } = await db(env)
    .prepare(
      `SELECT target_id, action, created_at FROM moderation_log
        WHERE entry_id IN (SELECT MAX(entry_id) FROM moderation_log
                            WHERE community_id = ? AND target_kind = 'comment'
                              AND action IN ('hide_comment', 'remove_comment', 'restore_comment')
                            GROUP BY target_id)`,
    )
    .bind(communityId)
    .all<{ target_id: string; action: keyof typeof COMMENT_STATES; created_at: number }>();
  return results.map((r) => ({
    commentId: r.target_id,
    state: COMMENT_STATES[r.action],
    at: r.created_at,
  }));
}
