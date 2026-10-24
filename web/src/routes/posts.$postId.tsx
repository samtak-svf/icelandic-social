import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import {
  createComment,
  deleteComment,
  getCommunity,
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
import { CommentComposer } from "../social/composer.tsx";
import { outcome, useLoad, when } from "../social/outcome.ts";
import {
  AuthorName,
  authorName,
  DeleteButton,
  PostView,
  StateMark,
  useMine,
} from "../social/post.tsx";
import { moderatesAs, RoleBadge } from "../social/roles.tsx";
import { ReportButton } from "../social/report.tsx";
import { Button, ProblemText, Status } from "../ui/kit.tsx";

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
  if (post?.ok) return <PostScreen post={post.data} reloadPost={reloadPost} />;
  return (
    <>
      <h1 className="sr-only">{strings.post_title}</h1>
      {post === null ? (
        <Status>{strings.loading}</Status>
      ) : (
        <Status>
          <ProblemText problem={post.problem} />
        </Status>
      )}
    </>
  );
}

function PostScreen({ post, reloadPost }: Readonly<{ post: Post; reloadPost: () => void }>) {
  const { postId, communityId } = post;
  const navigate = useNavigate();
  const [comments, reloadComments] = useLoad(
    useCallback(() => outcome(listComments({ path: { postId } }), 200), [postId]),
  );
  const [community] = useLoad(
    useCallback(() => outcome(getCommunity({ path: { communityId } }), 200), [communityId]),
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
      <div className="sticky top-0 z-10 -mx-4 flex items-center gap-2 bg-bg px-4">
        <Link
          to="/communities/$communityId"
          params={{ communityId }}
          className="inline-flex min-h-11 items-center gap-1 font-medium"
        >
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
        </Link>
      </div>
      <PostView
        post={post}
        linked={false}
        changed={reloadPost}
        moderates={community?.ok === true && moderatesAs(community.data.role)}
        deleted={() => void navigate({ to: "/communities/$communityId", params: { communityId } })}
      />
      <section className="mt-6 flex flex-col gap-4">
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
                  onReply={
                    !isTombstone(thread.comment) && thread.comment.state !== "removed"
                      ? () => setReplyingTo(thread.comment)
                      : null
                  }
                />
                {thread.replies.length > 0 && (
                  <>
                    <p className="text-sm text-muted-fg">
                      {strings.comment_replies_count({ count: thread.replies.length })}
                    </p>
                    <ul className="ml-4 flex flex-col gap-3 border-l border-border pl-4">
                      {thread.replies.map((reply) => (
                        <li key={reply.commentId}>
                          <CommentView comment={reply} deleted={changed} />
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
          className="sticky bottom-[var(--tabbar-height,0px)] -mx-4 border-t border-border bg-bg px-4 py-2"
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
}: Readonly<{ comment: Comment; deleted: () => void; onReply?: (() => void) | null }>) {
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
        <div className="relative flex flex-col gap-1 rounded-2xl bg-muted px-3 py-2">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold">
            <AuthorName author={comment.author} />
            <RoleBadge role={comment.author.role} />
          </span>
          {comment.body !== "" && <p className="whitespace-pre-wrap">{comment.body}</p>}
          {comment.media[0] !== undefined && (
            <CommentImage postId={comment.postId} media={comment.media[0]} />
          )}
          {like.likes > 0 && (
            <span className="absolute -bottom-3 right-2 rounded-full border border-border bg-bg px-2 text-xs">
              <span aria-hidden="true">👍</span> {like.likes}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-2 px-3 text-sm text-muted-fg">
          <time
            dateTime={new Date(comment.createdAt).toISOString()}
            title={when(comment.createdAt)}
          >
            {relativeTime(comment.createdAt)}
          </time>
          {onReply !== null && (
            <>
              <span aria-hidden="true">·</span>
              <Button className="text-sm" onClick={onReply}>
                {strings.comment_reply}
              </Button>
            </>
          )}
          <LikeComment like={like} />
          <span className="ml-auto">
            {mine ? (
              <DeleteButton
                ask={strings.comment_delete_confirm}
                remove={() =>
                  outcome(deleteComment({ path: { commentId: comment.commentId } }), 204)
                }
                deleted={deleted}
              />
            ) : (
              <ReportButton target={{ kind: "comment", id: comment.commentId }} />
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
  return (
    <>
      <span aria-hidden="true">·</span>
      <Button
        className={`text-sm ${like.liked ? "font-bold text-fg" : ""}`}
        aria-pressed={like.liked}
        disabled={like.busy}
        onClick={like.toggle}
      >
        {strings.comment_like}
      </Button>
    </>
  );
}
