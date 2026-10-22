import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import {
  createComment,
  deleteComment,
  getPost,
  listComments,
  type Comment,
} from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { Avatar } from "../social/avatar.tsx";
import { commentThreads, isTombstone } from "../social/comments.ts";
import { Composer } from "../social/composer.tsx";
import { outcome, useLoad, when } from "../social/outcome.ts";
import {
  AuthorName,
  authorName,
  DeleteButton,
  PostView,
  StateMark,
  useMine,
} from "../social/post.tsx";
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
  const navigate = useNavigate();
  const [post, reloadPost] = useLoad(
    useCallback(() => outcome(getPost({ path: { postId } }), 200), [postId]),
  );
  const [comments, reloadComments] = useLoad(
    useCallback(() => outcome(listComments({ path: { postId } }), 200), [postId]),
  );
  const [replyingTo, setReplyingTo] = useState<Comment | null>(null);
  if (post === null) {
    return (
      <>
        <h1 className="sr-only">{strings.post_title}</h1>
        <Status>{strings.loading}</Status>
      </>
    );
  }
  if (!post.ok) {
    return (
      <>
        <h1 className="sr-only">{strings.post_title}</h1>
        <Status>
          <ProblemText problem={post.problem} />
        </Status>
      </>
    );
  }
  const { communityId } = post.data;
  const changed = () => {
    reloadComments();
    reloadPost();
  };
  const threads = comments?.ok ? commentThreads(comments.data.comments) : null;
  return (
    <>
      <h1 className="sr-only">{strings.post_title}</h1>
      <Link
        to="/communities/$communityId"
        params={{ communityId }}
        className="inline-flex min-h-11 items-center underline"
      >
        {strings.post_back}
      </Link>
      <PostView
        post={post.data}
        linked={false}
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
        <Composer
          label={strings.comment_compose}
          action={strings.comment_publish}
          max={2000}
          send={async (body) => {
            const sent = await outcome(
              createComment({
                path: { postId },
                body:
                  replyingTo === null ? { body } : { body, parentCommentId: replyingTo.commentId },
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
  if (isTombstone(comment)) {
    return <p className="text-sm italic text-muted-fg">{strings.comment_tombstone}</p>;
  }
  return (
    <article
      aria-label={authorName(comment.author)}
      className="flex flex-col gap-1 rounded-md bg-muted p-3"
    >
      <StateMark state={comment.state} />
      <header className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <Avatar
            kind="person"
            id={comment.author.accountId}
            name={comment.author.name}
            className="size-7 rounded-md text-xs"
          />
          <AuthorName author={comment.author} />
        </span>
        <time
          dateTime={new Date(comment.createdAt).toISOString()}
          className="text-sm text-muted-fg"
        >
          {when(comment.createdAt)}
        </time>
      </header>
      <p className="whitespace-pre-wrap">{comment.body}</p>
      <div className="flex items-center justify-end gap-2">
        {onReply !== null && (
          <Button className="text-sm" onClick={onReply}>
            {strings.comment_reply}
          </Button>
        )}
        {mine ? (
          <DeleteButton
            ask={strings.comment_delete_confirm}
            remove={() => outcome(deleteComment({ path: { commentId: comment.commentId } }), 204)}
            deleted={deleted}
          />
        ) : (
          <ReportButton target={{ kind: "comment", id: comment.commentId }} />
        )}
      </div>
    </article>
  );
}
