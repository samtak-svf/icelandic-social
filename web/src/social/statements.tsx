import { useCallback, useState } from "react";
import {
  askModerationReview,
  moderationStatements,
  type ModerationReview,
  type ModerationStatement,
} from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import type { Problem } from "../problem.ts";
import { Button, ProblemText, Status } from "../ui/kit.tsx";
import { decisionText } from "./moderation-log.tsx";
import { outcome, when } from "./outcome.ts";
import { usePaged, type Paged } from "./paged.ts";

// What moderators did to the reader's content and why (decisions 0063, 0115):
// the item, the moderator's own words and the one review. It never says who acted.

/** The screen: every statement the reader has, newest first. */
export function Statements() {
  const list = usePaged<ModerationStatement>(
    useCallback(async (before) => {
      const page = await outcome(moderationStatements({ query: before ? { before } : {} }), 200);
      return page.ok
        ? { ok: true, data: { posts: page.data.statements, next: page.data.next } }
        : page;
    }, []),
    (statement) => String(statement.entryId),
  );
  return <StatementsView list={list} />;
}

/** What is drawn of the list as it has loaded. */
export function StatementsView({ list }: Readonly<{ list: Paged<ModerationStatement> }>) {
  return (
    <>
      <h1 className="font-headline text-3xl">{strings.statements_title}</h1>
      {list.items === null ? (
        <Status>
          {list.problem === null ? strings.loading : <ProblemText problem={list.problem} />}
        </Status>
      ) : (
        <div className="mt-4 flex flex-col gap-4">
          {list.items.length === 0 && <p className="text-muted-fg">{strings.statements_empty}</p>}
          <ul className="flex flex-col gap-4">
            {list.items.map((statement) => (
              <li key={statement.entryId}>
                <StatementCard statement={statement} asked={list.reload} />
              </li>
            ))}
          </ul>
          {list.problem !== null && (
            <Status>
              <ProblemText problem={list.problem} />
            </Status>
          )}
          {list.hasMore && <div ref={list.sentinel} />}
        </div>
      )}
    </>
  );
}

/** The sentence a review's state reads as. */
export function reviewSentence(review: ModerationReview, action: string): string {
  if (review.state === "open") return strings.statement_review_open;
  if (review.state === "upheld") return strings.statement_review_upheld;
  if (action === "suspend_account") {
    return review.restored
      ? strings.statement_review_overturned_lifted
      : strings.statement_review_overturned_later_stands;
  }
  return review.restored
    ? strings.statement_review_overturned
    : strings.statement_review_overturned_not_restored;
}

/** One statement: what was done, why, the text while it is kept, and the review. */
export function StatementCard({
  statement,
  asked,
  ask = askModerationReview,
}: Readonly<{
  statement: ModerationStatement;
  asked: () => void;
  ask?: typeof askModerationReview;
}>) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const { review } = statement;

  async function askOnce() {
    if (!confirm(strings.statement_ask_confirm)) return;
    setBusy(true);
    setProblem(null);
    const done = await outcome(ask({ path: { entryId: String(statement.entryId) } }), 204);
    setBusy(false);
    if (done.ok) asked();
    else setProblem(done.problem);
  }

  return (
    <article
      aria-label={decisionText(statement)}
      className="flex flex-col gap-2 rounded-md border border-border p-4"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold">{decisionText(statement)}</span>
        <time
          dateTime={new Date(statement.createdAt).toISOString()}
          className="text-sm text-muted-fg"
        >
          {when(statement.createdAt)}
        </time>
      </header>
      <p className="whitespace-pre-wrap">
        <span className="font-semibold">{strings.report_reason}:</span> {statement.reason}
      </p>
      {statement.body !== null ? (
        <blockquote className="whitespace-pre-wrap rounded-md bg-muted p-2">
          {statement.body}
        </blockquote>
      ) : (
        statement.target.kind !== "account" && (
          <p className="text-sm text-muted-fg">{strings.statement_text_gone}</p>
        )
      )}
      {review !== null && (
        <div className="flex flex-col gap-1">
          <p className="font-medium">{reviewSentence(review, statement.action)}</p>
          {review.reason !== null && (
            <p className="whitespace-pre-wrap">
              <span className="font-semibold">{strings.statement_review_reason}:</span>{" "}
              {review.reason}
            </p>
          )}
        </div>
      )}
      {statement.canAsk && (
        <div className="flex flex-col items-start gap-1">
          <p className="text-sm text-muted-fg">{strings.statement_ask_once}</p>
          <Button disabled={busy} onClick={() => void askOnce()}>
            {strings.statement_ask}
          </Button>
        </div>
      )}
      <Status>{problem && <ProblemText problem={problem} />}</Status>
    </article>
  );
}
