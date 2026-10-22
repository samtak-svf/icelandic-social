import type { Comment } from "../generated/api.ts";

// The comment list as threads (decision 0071): each top-level comment, and
// under it the replies it has, oldest first, one level deep.

export type Thread = { comment: Comment; replies: Comment[] };

/**
 * Groups a post's comments into its top-level comments, each with its
 * replies, keeping the order the list came in. A reply whose parent is not a
 * top-level comment here — its parent is itself a reply, or did not come —
 * stands at the top level, so no comment the caller may see is lost.
 */
export function commentThreads(comments: Comment[]): Thread[] {
  const byParent = new Map<string, Thread>();
  const threads: Thread[] = [];
  for (const comment of comments) {
    if (comment.parentCommentId !== null) continue;
    const thread = { comment, replies: [] as Comment[] };
    byParent.set(comment.commentId, thread);
    threads.push(thread);
  }
  for (const comment of comments) {
    if (comment.parentCommentId === null) continue;
    const thread = { comment, replies: [] as Comment[] };
    const parent = byParent.get(comment.parentCommentId);
    if (parent === undefined) threads.push(thread);
    else parent.replies.push(comment);
  }
  return threads;
}

/** The mark in a comment list where a removed comment stands with its body gone (decision 0071). */
export function isTombstone(comment: Comment): boolean {
  return comment.body === "" && comment.state === "removed";
}
