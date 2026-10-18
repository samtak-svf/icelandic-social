import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useId, useState } from "react";
import type { Problem } from "../account.tsx";
import {
  closeReport,
  communityReports,
  moderate,
  resolveCards,
  type Card,
  type Report,
  type ReportTarget,
} from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { outcome, useLoad, when } from "../social/outcome.ts";
import { authorName } from "../social/post.tsx";
import { Button, ProblemText, Status } from "../ui/kit.tsx";

// A community's report queue (decision 0066), oldest first: what was
// reported, as a card, and why; the moderator hides or removes it, with a
// reason that is logged, or closes the report without acting.
export const Route = createFileRoute("/communities/$communityId/reports")({ component: Reports });

const REASONS = {
  unlawful: strings.report_reason_unlawful,
  harassment: strings.report_reason_harassment,
  spam: strings.report_reason_spam,
  other: strings.report_reason_other,
} as const;

function Reports() {
  const { communityId } = Route.useParams();
  const [queue, reload] = useLoad(
    useCallback(() => outcome(communityReports({ path: { communityId } }), 200), [communityId]),
  );
  const cards = useCards(queue?.ok ? queue.data.reports : []);
  return (
    <>
      <Link
        to="/communities/$communityId"
        params={{ communityId }}
        className="inline-flex min-h-11 items-center underline"
      >
        {strings.post_back}
      </Link>
      <h1 className="font-headline text-3xl">{strings.moderation_queue}</h1>
      {queue === null && <Status>{strings.loading}</Status>}
      {queue?.ok === false && (
        <Status>
          <ProblemText problem={queue.problem} />
        </Status>
      )}
      {queue?.ok && queue.data.reports.length === 0 && (
        <p className="mt-4 text-muted-fg">{strings.moderation_queue_empty}</p>
      )}
      {queue?.ok && (
        <ul className="mt-4 flex flex-col gap-4">
          {queue.data.reports.map((r) => (
            <li key={r.reportId}>
              <ReportItem
                report={r}
                card={cards.get(r.target.id)}
                communityId={communityId}
                done={reload}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

type Content = ReportTarget & { kind: "post" | "comment" };
const isContent = (target: ReportTarget): target is Content =>
  target.kind === "post" || target.kind === "comment";

/** The cards of the posts and comments reported, by id. */
function useCards(reports: Report[]): Map<string, Card> {
  const [cards, setCards] = useState(new Map<string, Card>());
  const refs = reports
    .map((r) => r.target)
    .filter(isContent)
    .map((t) => ({ kind: t.kind, id: t.id }));
  const key = refs.map((r) => r.id).join(",");
  useEffect(() => {
    let live = true;
    if (key !== "") {
      void outcome(resolveCards({ body: { refs } }), 200).then((resolved) => {
        if (live && resolved.ok) setCards(new Map(resolved.data.cards.map((c) => [c.ref.id, c])));
      });
    }
    return () => {
      live = false;
    };
    // The refs are the key's; a new array of the same refs is no new request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return cards;
}

function ReportItem({
  report,
  card,
  communityId,
  done,
}: Readonly<{ report: Report; card: Card | undefined; communityId: string; done: () => void }>) {
  const id = useId();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const { target } = report;

  async function act(pending: Promise<{ ok: true } | { ok: false; problem: Problem }>) {
    setBusy(true);
    setProblem(null);
    const result = await pending;
    setBusy(false);
    if (result.ok) done();
    else setProblem(result.problem);
  }
  const action = (content: Content, verb: "hide" | "remove") =>
    act(
      outcome(
        moderate({
          path: { communityId },
          body: {
            action: `${verb}_${content.kind}`,
            targetId: content.id,
            reason: reason.trim(),
            reportId: report.reportId,
          },
        }),
        204,
      ),
    );
  const dismiss = () =>
    act(
      outcome(
        closeReport({ path: { reportId: report.reportId }, body: { resolution: reason.trim() } }),
        204,
      ),
    );

  return (
    <article
      aria-label={REASONS[report.reason]}
      className="flex flex-col gap-2 rounded-md border border-border p-4"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold">{REASONS[report.reason]}</span>
        <time dateTime={new Date(report.createdAt).toISOString()} className="text-sm text-muted-fg">
          {when(report.createdAt)}
        </time>
      </header>
      {report.note !== "" && <p className="whitespace-pre-wrap">{report.note}</p>}
      {card && card.kind !== "unavailable" && card.kind !== "community" && (
        <blockquote className="rounded-md bg-muted p-3">
          <p className="font-semibold">{authorName(card.author)}</p>
          <p className="whitespace-pre-wrap">{card.excerpt}</p>
        </blockquote>
      )}
      <label htmlFor={`${id}-reason`}>{strings.report_reason}</label>
      <input
        id={`${id}-reason`}
        value={reason}
        maxLength={500}
        onChange={(event) => setReason(event.target.value)}
        className="min-h-11 rounded-md border border-border-strong bg-surface px-3"
      />
      <div className="flex flex-wrap gap-2">
        {isContent(target) && (
          <>
            <Button
              disabled={busy || reason.trim() === ""}
              onClick={() => void action(target, "hide")}
            >
              {strings.moderation_hide}
            </Button>
            <Button
              tone="danger"
              disabled={busy || reason.trim() === ""}
              onClick={() => void action(target, "remove")}
            >
              {strings.moderation_remove}
            </Button>
          </>
        )}
        <Button disabled={busy || reason.trim() === ""} onClick={() => void dismiss()}>
          {strings.moderation_dismiss}
        </Button>
      </div>
      <Status>{problem && <ProblemText problem={problem} />}</Status>
    </article>
  );
}
