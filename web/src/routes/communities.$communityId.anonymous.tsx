import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import {
  approveAnonymousPost,
  declineAnonymousPost,
  listPendingAnonymousPosts,
  type Post,
} from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import type { Problem } from "../problem.ts";
import { ManageFrame } from "../social/manage-frame.tsx";
import { outcome, useLoad, when, type Outcome } from "../social/outcome.ts";
import { Images } from "../social/post.tsx";
import { RevealAuthor } from "../social/reveal-author.tsx";
import { Button, ProblemText, Status } from "../ui/kit.tsx";

// The anonymous posts that wait for a moderator (decision 0091), newest first.
// The list names no author. A moderator publishes a post, or declines it and
// the author is told; Sýna höfund reveals the author and is logged.
export const Route = createFileRoute("/communities/$communityId/anonymous")({
  component: AnonymousPage,
  staticData: { width: "wide" },
});

function AnonymousPage() {
  const { communityId } = Route.useParams();
  return (
    <ManageFrame communityId={communityId}>
      {(_, changed) => <Anonymous communityId={communityId} changed={changed} />}
    </ManageFrame>
  );
}

function Anonymous({
  communityId,
  changed,
}: Readonly<{ communityId: string; changed: () => void }>) {
  const [queue, reload] = useLoad(
    useCallback(
      () => outcome(listPendingAnonymousPosts({ path: { communityId } }), 200),
      [communityId],
    ),
  );
  // What waits is counted in the side navigation too, so it is reloaded with the queue.
  const answered = useCallback(() => {
    reload();
    changed();
  }, [reload, changed]);
  return (
    <>
      <h1 className="font-headline text-3xl">{strings.anonymous_queue_title}</h1>
      {queue === null && <Status>{strings.loading}</Status>}
      {queue?.ok === false && (
        <Status>
          <ProblemText problem={queue.problem} />
        </Status>
      )}
      {queue?.ok && queue.data.posts.length === 0 && (
        <p className="mt-4 text-muted-fg">{strings.anonymous_queue_empty}</p>
      )}
      {queue?.ok && queue.data.posts.length > 0 && (
        <ul className="mt-4 flex flex-col gap-4">
          {queue.data.posts.map((post) => (
            <li key={post.postId}>
              <Waiting post={post} answered={answered} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function Waiting({ post, answered }: Readonly<{ post: Post; answered: () => void }>) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const path = { postId: post.postId };
  async function answer(pending: Promise<Outcome<unknown>>) {
    setBusy(true);
    setProblem(null);
    const done = await pending;
    setBusy(false);
    if (done.ok) answered();
    else setProblem(done.problem);
  }
  return (
    <article className="flex flex-col gap-2 rounded-md border border-border p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold">{strings.post_anonymous_author}</span>
        <time dateTime={new Date(post.createdAt).toISOString()} className="text-sm text-muted-fg">
          {when(post.createdAt)}
        </time>
      </header>
      {post.body !== "" && <p className="whitespace-pre-wrap break-words">{post.body}</p>}
      {post.media.length > 0 && <Images postId={post.postId} media={post.media} />}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          tone="primary"
          disabled={busy}
          onClick={() => void answer(outcome(approveAnonymousPost({ path }), 204))}
        >
          {strings.anonymous_approve}
        </Button>
        <Button
          tone="danger"
          disabled={busy}
          onClick={() => void answer(outcome(declineAnonymousPost({ path }), 204))}
        >
          {strings.anonymous_decline}
        </Button>
        <RevealAuthor postId={post.postId} />
      </div>
      <Status>{problem && <ProblemText problem={problem} />}</Status>
    </article>
  );
}
