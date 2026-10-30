import { job } from "./queue.ts";

// The job that tells one account of something addressed to it (decisions
// 0063, 0067). The module that makes the change writes it; the notifications
// module runs it.

type NoticeKind = "comment" | "reply" | "reaction" | "join_approved" | "moderated";

/** Who is told what, by whom, about which thing. Ids only, never content. */
export type Notice = {
  kind: NoticeKind;
  accountId: string;
  actorId: string;
  /** None for a notice about the account itself (decision 0114). */
  communityId: string | null;
  postId?: string;
  commentId?: string;
  /** For `reply`, the comment replied to: its author is told (decision 0103). */
  parentCommentId?: string;
  action?: string;
  /** For `reaction`, the emoji (decision 0100). */
  emoji?: string;
};

/** The job of `notice`, keyed by `key`: one notification however often it is written or run. */
export function notice(env: Env, key: string, n: Notice, ifChanged = false): D1PreparedStatement {
  return job(env, { kind: "notice", key: `${n.kind}:${key}`, payload: n }, ifChanged);
}
