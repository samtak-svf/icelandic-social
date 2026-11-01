import { useEffect, useState } from "react";
import type { Problem } from "../problem.ts";
import { votePoll, withdrawVote, type Poll, type Post } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { Button, ProblemText, Status } from "../ui/kit.tsx";
import { outcome } from "./outcome.ts";
import { useSuspended } from "./suspended.tsx";

// A poll on a post card (decision 0090). Before the reader votes the options
// are plain choices and only the total shows; once they have voted, wrote the
// poll, moderate, or the poll is closed, the API sends each option's count and
// the card draws the share as a bar. Nothing on this card, or in any answer it
// reads, says who voted or how: `mine` is the reader's own choice.

/** Whether the API sent the counts, which it does only where the reader may see them. */
export function showsResults(poll: Poll): boolean {
  return poll.options.every((o) => o.votes !== null);
}

/** A whole percentage of `part` in `total`; 0 for an empty poll. */
export function share(part: number, total: number): number {
  return total === 0 ? 0 : Math.round((part / total) * 100);
}

export function PollCard({ post, mayReply }: Readonly<{ post: Post; mayReply: boolean }>) {
  const suspended = useSuspended();
  const [poll, setPoll] = useState<Poll | undefined>(post.poll);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  // The page loads the post again after the poll was closed from the menu.
  useEffect(() => setPoll(post.poll), [post.poll]);
  if (poll === undefined) return null;

  async function send(pending: ReturnType<typeof votePoll> | ReturnType<typeof withdrawVote>) {
    setBusy(true);
    setProblem(null);
    const done = await outcome(pending, 200);
    setBusy(false);
    if (done.ok) setPoll(done.data.poll);
    else setProblem(done.problem);
  }

  const results = showsResults(poll);
  const open = !poll.closed;
  return (
    <section aria-label={post.body} className="flex flex-col gap-2">
      <div role="radiogroup" aria-label={post.body} className="flex flex-col gap-2">
        {poll.options.map((option) => {
          const mine = poll.mine === option.optionId;
          const percent = share(option.votes ?? 0, poll.total);
          return (
            <button
              key={option.optionId}
              type="button"
              role="radio"
              aria-checked={mine}
              disabled={busy || !open || mine || suspended || !mayReply}
              onClick={() =>
                void send(
                  votePoll({ path: { postId: post.postId }, body: { optionId: option.optionId } }),
                )
              }
              className={`relative flex min-h-11 items-center justify-between gap-3 overflow-hidden rounded-md border px-3 text-left ${mine ? "border-primary font-semibold" : "border-border-strong"}`}
            >
              {results && (
                <span
                  aria-hidden="true"
                  data-bar
                  style={{ width: `${percent}%` }}
                  className="absolute inset-y-0 left-0 bg-muted"
                />
              )}
              <span className="relative">
                {option.text}
                {mine && <span className="sr-only"> {strings.poll_your_choice}</span>}
                {mine && <span aria-hidden="true"> ✓</span>}
              </span>
              {results && (
                <span className="relative shrink-0 text-sm tabular-nums">
                  {option.votes} · {percent} %
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-fg">
        <span>
          {strings.poll_votes({ count: poll.total })}
          {poll.closed && <span> · {strings.poll_closed}</span>}
        </span>
        {open && poll.mine !== null && (
          <Button
            className="text-sm"
            disabled={busy}
            onClick={() => void send(withdrawVote({ path: { postId: post.postId } }))}
          >
            {strings.poll_withdraw}
          </Button>
        )}
      </div>
      <Status>{problem && <ProblemText problem={problem} />}</Status>
    </section>
  );
}
