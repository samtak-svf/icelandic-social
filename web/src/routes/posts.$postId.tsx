import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import {
  createComment,
  deleteComment,
  getPost,
  listComments,
  type Comment,
} from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
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
import { ProblemText, Status } from "../ui/kit.tsx";

// One post and its comments, oldest first, with the box to add one. A
// deleted post leaves for its community.
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
        {comments?.ok && (
          <ul className="flex flex-col gap-3">
            {comments.data.comments.map((comment) => (
              <li key={comment.commentId}>
                <CommentView comment={comment} deleted={changed} />
              </li>
            ))}
          </ul>
        )}
        <Composer
          label={strings.comment_compose}
          action={strings.comment_publish}
          max={2000}
          send={async (body) => {
            const sent = await outcome(createComment({ path: { postId }, body: { body } }), 200);
            if (sent.ok) changed();
            return sent;
          }}
        />
      </section>
    </>
  );
}

function CommentView({ comment, deleted }: Readonly<{ comment: Comment; deleted: () => void }>) {
  const mine = useMine(comment.author);
  return (
    <article
      aria-label={authorName(comment.author)}
      className="flex flex-col gap-1 rounded-md bg-muted p-3"
    >
      <StateMark state={comment.state} />
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <AuthorName author={comment.author} />
        <time
          dateTime={new Date(comment.createdAt).toISOString()}
          className="text-sm text-muted-fg"
        >
          {when(comment.createdAt)}
        </time>
      </header>
      <p className="whitespace-pre-wrap">{comment.body}</p>
      <div className="self-end">
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
