import { Link } from "@tanstack/react-router";
import { useId, useState } from "react";
import type { OpenModerationReview } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import type { Problem } from "../problem.ts";
import { Button, ProblemText, Status } from "../ui/kit.tsx";
import { decisionText } from "./moderation-log.tsx";
import { when } from "./outcome.ts";
import type { Paged } from "./paged.ts";
import { act, reviewActionsFor, undecided, type Calls, type Row } from "./platform-moderation.ts";
import { LIMITS } from "../generated/limits.ts";
import { clipText } from "../lib/char-count.ts";

// The reviews people asked for, on Samtak's moderation page (decision 0115).
// Only someone who neither acted nor asked may answer; a review whose text
// was purged after its 90 days is answered without it, and says so.

/** The reviews as they have loaded; one answered leaves the list at once. */
export function ReviewList({
  reviews,
  calls,
  done,
}: Readonly<{ reviews: Paged<OpenModerationReview>; calls: Calls; done: () => void }>) {
  const [gone, setGone] = useState<ReadonlySet<number>>(new Set());
  if (reviews.items === null) {
    return reviews.problem === null ? (
      <Status>{strings.loading}</Status>
    ) : (
      <Status>
        <ProblemText problem={reviews.problem} />
      </Status>
    );
  }
  const open = undecided(reviews.items, gone);
  return (
    <>
      {open.length === 0 && <p className="text-muted-fg">{strings.platform_reviews_empty}</p>}
      <ul className="flex flex-col gap-4">
        {open.map((review) => (
          <li key={review.entryId}>
            <ReviewItem
              review={review}
              calls={calls}
              decided={() => {
                setGone((now) => new Set(now).add(review.entryId));
                done();
              }}
            />
          </li>
        ))}
      </ul>
      {reviews.problem !== null && (
        <Status>
          <ProblemText problem={reviews.problem} />
        </Status>
      )}
      {reviews.hasMore && <div ref={reviews.sentinel} />}
    </>
  );
}

/** One review: what was done and why, the text while it is kept, and the answers. */
export function ReviewItem({
  review,
  calls,
  decided,
}: Readonly<{ review: OpenModerationReview; calls: Calls; decided: () => void }>) {
  const id = useId();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const rows = reviewActionsFor(review);

  async function perform(row: Row<OpenModerationReview>) {
    if (!confirm(row.confirm)) return;
    setBusy(true);
    setProblem(null);
    const result = await act(calls, review, row, reason);
    setBusy(false);
    if (result.ok) decided();
    else setProblem(result.problem);
  }

  return (
    <article
      aria-label={decisionText(review)}
      className="flex flex-col gap-2 rounded-md border border-border p-4"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold">{decisionText(review)}</span>
        <time dateTime={new Date(review.askedAt).toISOString()} className="text-sm text-muted-fg">
          {when(review.askedAt)}
        </time>
      </header>
      {review.targetAccount !== null && (
        <p>
          {strings.platform_account}: {review.targetAccount.name ?? strings.person_unnamed}
        </p>
      )}
      {review.actor !== null && (
        <p className="text-sm text-muted-fg">
          {strings.platform_review_decider}: {review.actor.name ?? strings.person_unnamed}
        </p>
      )}
      <p>
        <span className="font-semibold">{strings.report_reason}:</span> {review.reason}
      </p>
      {review.body !== null ? (
        <blockquote className="whitespace-pre-wrap rounded-md bg-muted p-2">
          {review.body}
        </blockquote>
      ) : (
        review.target.kind !== "account" && (
          <p className="text-sm text-muted-fg">{strings.platform_review_text_gone}</p>
        )
      )}
      {review.postId !== null && (
        <Link to="/posts/$postId" params={{ postId: review.postId }} className="underline">
          {strings.post_tombstone_open}
        </Link>
      )}
      {rows.length === 0 ? (
        <p className="text-sm text-muted-fg">{strings.platform_review_not_yours}</p>
      ) : (
        <>
          <label htmlFor={`${id}-reason`}>{strings.report_reason}</label>
          <input
            id={`${id}-reason`}
            aria-describedby={`${id}-reason-help`}
            value={reason}
            onChange={(event) =>
              setReason(clipText(event.target.value, LIMITS.moderationNoteChars))
            }
            className="min-h-11 rounded-md border border-border-strong bg-surface px-3"
          />
          <p id={`${id}-reason-help`} className="text-sm text-muted-fg">
            {strings.moderation_reason_required}
          </p>
          <div className="flex flex-wrap gap-2">
            {rows.map((row) => (
              <Button
                key={row.id}
                disabled={busy || reason.trim() === ""}
                onClick={() => void perform(row)}
              >
                {row.label}
              </Button>
            ))}
          </div>
        </>
      )}
      <Status>{problem && <ProblemText problem={problem} />}</Status>
    </article>
  );
}
