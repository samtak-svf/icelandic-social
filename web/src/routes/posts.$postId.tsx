import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import {
  createComment,
  deleteComment,
  getPost,
  likeComment,
  unlikeComment,
  listComments,
  type Comment,
  type Post,
} from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { Avatar } from "../social/avatar.tsx";
import { relativeTime } from "../lib/relative-time.ts";
import { commentThreads, isTombstone } from "../social/comments.ts";
import { CommentImage } from "../social/comment-image.tsx";
import { CommentComposer } from "../social/comment-composer.tsx";
import { DeleteButton } from "../social/delete-button.tsx";
import { outcome, useLoad, when } from "../social/outcome.ts";
import { authorName, PersonName } from "../social/author-name.tsx";
import { PostView, StateMark, useMine } from "../social/post.tsx";
import { isPostTombstone } from "../social/post-tombstone.tsx";
import { RoleBadge } from "../social/roles.tsx";
import { PostHomeLink, useLeavePost, useModerates } from "../social/post-home.tsx";
import { RemoveWallComment } from "../social/wall-comment-remove.tsx";
import { useMe } from "../account.tsx";
import { ReportButton } from "../social/report.tsx";
import { useSuspended } from "../social/suspended.tsx";
import { Button, ProblemText, Status } from "../ui/kit.tsx";
import { CardPlaceholders, Loading } from "../ui/placeholder.tsx";

// One post and its comments (decision 0071): each top-level comment with the
// replies under it, oldest first, and the box to write in, answering a
// comment when Svara was pressed on one. A removed comment stands as a
// tombstone, so its replies stay anchored under it. A deleted post leaves
// for its community.
export const Route = createFileRoute("/posts/$postId")({ component: PostPage });

function PostPage() {
  const { postId } = Route.useParams();
  const [post, reloadPost] = useLoad(
    useCallback(() => outcome(getPost({ path: { postId } }), 200), [postId]),
  );
  if (post?.ok && isPostTombstone(post.data)) return <RemovedPost post={post.data} />;
  if (post?.ok) return <PostScreen post={post.data} reloadPost={reloadPost} />;
  return (
    <>
      <h1 className="sr-only">{strings.post_title}</h1>
      {post === null ? (
        <Loading>
          <CardPlaceholders count={1} />
        </Loading>
      ) : (
        <Status>
          <ProblemText problem={post.problem} />
        </Status>
      )}
    </>
  );
}

/** A removed post has no comments and nothing to write under; its author reads why elsewhere. */
function RemovedPost({ post }: Readonly<{ post: Post }>) {
  const gone = useLeavePost(post);
  return (
    <>
      <h1 className="sr-only">{strings.post_title}</h1>
      <PostView post={post} linked={false} changed={gone} deleted={gone} moderates={false} />
    </>
  );
}

function PostScreen({ post, reloadPost }: Readonly<{ post: Post; reloadPost: () => void }>) {
  const { postId, communityId } = post;
  const leave = useLeavePost(post);
  const moderates = useModerates(post);
  const me = useMe();
  const ownWall = post.wall !== undefined && post.wall.accountId === me?.accountId;
  const [comments, reloadComments] = useLoad(
    useCallback(() => outcome(listComments({ path: { postId } }), 200), [postId]),
  );
  const [replyingTo, setReplyingTo] = useState<Comment | null>(null);
  const changed = () => {
    reloadComments();
    reloadPost();
  };
  const threads = comments?.ok ? commentThreads(comments.data.comments) : null;
  return (
    <>
      <h1 className="sr-only">{strings.post_title}</h1>
      {/* -mt-6 takes back the page's top padding: the bar sits right under the header. */}
      <div className="sticky top-0 z-10 -mt-6 flex items-center gap-2 border-b border-border bg-bg">
        <PostHomeLink post={post} className="inline-flex min-h-11 items-center gap-1 font-medium">
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="size-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m15 18-6-6 6-6" />
          </svg>
          {strings.post_back}
        </PostHomeLink>
      </div>
      <PostView
        post={post}
        linked={false}
        changed={reloadPost}
        moderates={moderates}
        deleted={leave}
      />
      <section className="mt-3 flex flex-col gap-4">
        {comments?.ok && comments.data.comments.length === 0 && (
          <p className="text-muted-fg">{strings.comments_empty}</p>
        )}
        {comments?.ok === false && (
          <Status>
            <ProblemText problem={comments.problem} />
          </Status>
        )}
        {threads && (
          <ul className="flex flex-col gap-3">
            {threads.map((thread) => (
              <li key={thread.comment.commentId} className="flex flex-col gap-1">
                <CommentView
                  comment={thread.comment}
                  deleted={changed}
                  removable={ownWall}
                  onReply={
                    !isTombstone(thread.comment) && thread.comment.state !== "removed"
                      ? () => setReplyingTo(thread.comment)
                      : null
                  }
                />
                {thread.replies.length > 0 && (
                  <>
                    <p className="ml-4 pl-4 text-sm text-muted-fg">
                      {strings.comment_replies_count({ count: thread.replies.length })}
                    </p>
                    <ul className="ml-4 flex flex-col gap-3 border-l border-border pl-4">
                      {thread.replies.map((reply) => (
                        <li key={reply.commentId}>
                          <CommentView comment={reply} deleted={changed} removable={ownWall} />
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        {replyingTo !== null && (
          <div
            aria-label={strings.comment_reply}
            className="flex items-center justify-between gap-2 rounded-md bg-muted px-3 py-2 text-sm"
          >
            <span>{strings.comment_replying_to({ name: authorName(replyingTo.author) })}</span>
            <Button className="text-sm" onClick={() => setReplyingTo(null)} aria-label="×">
              ×
            </Button>
          </div>
        )}
        <div
          data-comment-composer
          // -mb-6 takes back the page's own bottom padding, so nothing empty sits under the box;
          // without the tab bar under it, the box itself clears the safe area.
          className="sticky bottom-[var(--tabbar-height,0px)] -mb-6 border-t border-border bg-bg py-2 medium:pb-[max(0.5rem,env(safe-area-inset-bottom))]"
        >
          <CommentComposer
            communityId={communityId}
            label={strings.comment_compose}
            placeholder={strings.post_write_comment}
            action={strings.comment_publish}
            max={2000}
            send={async (body, media) => {
              const sent = await outcome(
                createComment({
                  path: { postId },
                  body:
                    replyingTo === null
                      ? { body, media }
                      : { body, media, parentCommentId: replyingTo.commentId },
                }),
                200,
              );
              if (sent.ok) {
                changed();
                setReplyingTo(null);
              }
              return sent;
            }}
          />
        </div>
      </section>
    </>
  );
}

function CommentView({
  comment,
  deleted,
  onReply,
  removable = false,
}: Readonly<{
  comment: Comment;
  deleted: () => void;
  onReply?: (() => void) | null;
  /** Whether the reader owns the wall this comment is on, and may take it off. */
  removable?: boolean;
}>) {
  const mine = useMine(comment.author);
  const like = useCommentLike(comment);
  if (isTombstone(comment)) {
    return <p className="text-sm italic text-muted-fg">{strings.comment_tombstone}</p>;
  }
  return (
    <article aria-label={authorName(comment.author)} className="flex items-start gap-2">
      <Avatar
        kind="person"
        id={comment.author.accountId}
        name={comment.author.name}
        photo={comment.author.photo}
        className="size-8 shrink-0 rounded-full text-xs"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <StateMark state={comment.state} />
        <div className="flex w-fit max-w-full flex-col gap-1 rounded-2xl bg-muted px-3 py-2">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold">
            <PersonName author={comment.author} />
            <RoleBadge role={comment.author.role} />
          </span>
          {comment.body !== "" && <p className="whitespace-pre-wrap">{comment.body}</p>}
          {comment.media[0] !== undefined && (
            <CommentImage postId={comment.postId} media={comment.media[0]} />
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-1 px-1 text-sm text-muted-fg">
          <time
            className="px-2"
            dateTime={new Date(comment.createdAt).toISOString()}
            title={when(comment.createdAt)}
          >
            {relativeTime(comment.createdAt)}
          </time>
          {onReply !== null && (
            <Button tone="link" className="text-sm" onClick={onReply}>
              {strings.comment_reply}
            </Button>
          )}
          <LikeComment like={like} />
          <span className="ml-auto flex items-center gap-1">
            {removable && !mine && (
              <RemoveWallComment commentId={comment.commentId} removed={deleted} />
            )}
            {mine ? (
              <DeleteButton
                ask={strings.comment_delete_confirm}
                remove={() =>
                  outcome(deleteComment({ path: { commentId: comment.commentId } }), 204)
                }
                deleted={deleted}
                tone="link"
              />
            ) : (
              <ReportButton tone="link" target={{ kind: "comment", id: comment.commentId }} />
            )}
          </span>
        </div>
      </div>
    </article>
  );
}

type CommentLike = { liked: boolean; likes: number; busy: boolean; toggle: () => void };

/** A comment's 👍, shown at once and taken back when the call fails (decision 0080). */
function useCommentLike(comment: Comment): CommentLike {
  const [state, setState] = useState({ liked: comment.liked, likes: comment.likes });
  const [busy, setBusy] = useState(false);
  // The list loads again after a change elsewhere; follow what it says.
  useEffect(
    () => setState({ liked: comment.liked, likes: comment.likes }),
    [comment.liked, comment.likes],
  );
  async function toggle() {
    const before = state;
    const next = !before.liked;
    setState({ liked: next, likes: before.likes + (next ? 1 : -1) });
    setBusy(true);
    const path = { commentId: comment.commentId };
    const done = await outcome(next ? likeComment({ path }) : unlikeComment({ path }), 204);
    setBusy(false);
    if (!done.ok) setState(before);
  }
  return { ...state, busy, toggle: () => void toggle() };
}

/** Líkar þetta under a comment: bold while liked. */
function LikeComment({ like }: Readonly<{ like: CommentLike }>) {
  const suspended = useSuspended();
  return (
    <>
      <Button
        tone="link"
        className={`text-sm ${like.liked ? "font-bold text-fg" : ""}`}
        aria-pressed={like.liked}
        disabled={like.busy || (suspended && !like.liked)}
        onClick={like.toggle}
      >
        {strings.comment_like}
      </Button>
      {like.likes > 0 && (
        <span>
          <span aria-hidden="true">👍</span> {like.likes}
        </span>
      )}
    </>
  );
}
