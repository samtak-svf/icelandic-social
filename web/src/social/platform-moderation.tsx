import { useCallback, useId, useState } from "react";
import {
  openModerationReviews,
  platformModerationLog,
  platformReports,
  type Card,
  type ModerationLogEntry,
  type OpenModerationReview,
  type Report,
} from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import type { Problem } from "../problem.ts";
import { Button, ProblemText, Status } from "../ui/kit.tsx";
import { LogEntries } from "./moderation-log.tsx";
import { DAY, MUTES } from "./mute-lengths.ts";
import { outcome, when, type Outcome } from "./outcome.ts";
import { usePaged, type Paged } from "./paged.ts";
import {
  act,
  actionsFor,
  dismiss,
  live,
  without,
  type Calls,
  type Row,
} from "./platform-moderation.ts";
import { AuthorName } from "./author-name.tsx";
import { Quoted, REASONS, useCards } from "./report-card.tsx";
import { ReviewList } from "./platform-reviews.tsx";
import { LIMITS } from "../generated/limits.ts";
import { clipText } from "../lib/char-count.ts";

// Samtak's moderation page (decision 0115, step 2e): the open reports made to
// the platform, with the actions a platform moderator has on an account, the
// reviews people asked for, and the log of what was done. Only the server knows who may; a person it
// refuses sees the refusal and neither list.

/** The page: both lists, and a refusal in place of them when the server gives one. */
export function PlatformModeration({ calls = live }: Readonly<{ calls?: Calls }>) {
  const queue = usePaged<Report>(
    useCallback(async (after) => {
      const page = await outcome(
        platformReports({ query: { state: "open", ...(after ? { after } : {}) } }),
        200,
      );
      return page.ok
        ? { ok: true, data: { posts: page.data.reports, next: page.data.next } }
        : page;
    }, []),
    (report) => report.reportId,
  );
  const log = usePaged<ModerationLogEntry>(
    useCallback(async (before) => {
      const page = await outcome(platformModerationLog({ query: before ? { before } : {} }), 200);
      return page.ok
        ? { ok: true, data: { posts: page.data.entries, next: page.data.next } }
        : page;
    }, []),
    (entry) => String(entry.entryId),
  );
  const reviews = usePaged<OpenModerationReview>(
    useCallback(async (before) => {
      const page = await outcome(openModerationReviews({ query: before ? { before } : {} }), 200);
      return page.ok
        ? { ok: true, data: { posts: page.data.reviews, next: page.data.next } }
        : page;
    }, []),
    (review) => String(review.entryId),
  );
  const done = () => {
    queue.reload();
    reviews.reload();
    log.reload();
  };
  return <PlatformView queue={queue} reviews={reviews} log={log} calls={calls} done={done} />;
}

/** What is drawn of the two lists as they have loaded. */
export function PlatformView({
  queue,
  reviews,
  log,
  calls,
  done,
}: Readonly<{
  queue: Paged<Report>;
  reviews: Paged<OpenModerationReview>;
  log: Paged<ModerationLogEntry>;
  calls: Calls;
  done: () => void;
}>) {
  return (
    <>
      <h1 className="font-headline text-3xl">{strings.platform_title}</h1>
      {queue.problem !== null && queue.items === null ? (
        // The server refused, or could not be reached: no queue, and no log under it.
        <Status>
          <ProblemText problem={queue.problem} />
        </Status>
      ) : (
        <div className="mt-4 flex flex-col gap-8">
          <section aria-label={strings.moderation_queue} className="flex flex-col gap-2">
            <h2 className="text-xl font-semibold">{strings.moderation_queue}</h2>
            <Queue queue={queue} calls={calls} done={done} />
          </section>
          <section aria-label={strings.platform_reviews} className="flex flex-col gap-2">
            <h2 className="text-xl font-semibold">{strings.platform_reviews}</h2>
            <ReviewList reviews={reviews} calls={calls} done={done} />
          </section>
          <section aria-label={strings.moderation_log_title} className="flex flex-col gap-2">
            <h2 className="text-xl font-semibold">{strings.moderation_log_title}</h2>
            <LogList log={log} />
          </section>
        </div>
      )}
    </>
  );
}

function Queue({
  queue,
  calls,
  done,
}: Readonly<{ queue: Paged<Report>; calls: Calls; done: () => void }>) {
  // A report dealt with leaves the queue at once; the reload that follows confirms it.
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const items = queue.items === null ? null : without(queue.items, gone);
  if (items === null) return <Status>{strings.loading}</Status>;
  return (
    <>
      <QueueList
        reports={items}
        calls={calls}
        dealt={(id) => {
          setGone((now) => new Set(now).add(id));
          done();
        }}
      />
      {queue.problem !== null && (
        <Status>
          <ProblemText problem={queue.problem} />
        </Status>
      )}
      {queue.hasMore && <div ref={queue.sentinel} />}
    </>
  );
}

/** The open reports, each with its actions; the empty queue says so. */
export function QueueList({
  reports,
  calls,
  dealt,
}: Readonly<{ reports: Report[]; calls: Calls; dealt: (reportId: string) => void }>) {
  const cards = useCards(reports);
  if (reports.length === 0)
    return <p className="text-muted-fg">{strings.moderation_queue_empty}</p>;
  return (
    <ul className="flex flex-col gap-4">
      {reports.map((report) => (
        <li key={report.reportId}>
          <Item report={report} card={cards.get(report.target.id)} calls={calls} dealt={dealt} />
        </li>
      ))}
    </ul>
  );
}

function Item({
  report,
  card,
  calls,
  dealt,
}: Readonly<{
  report: Report;
  card: Card | undefined;
  calls: Calls;
  dealt: (reportId: string) => void;
}>) {
  const id = useId();
  const [reason, setReason] = useState("");
  const [days, setDays] = useState(0);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const blocked = busy || reason.trim() === "";
  const rows = actionsFor(report);

  async function run(pending: Promise<Outcome<undefined>>) {
    setBusy(true);
    setProblem(null);
    const result = await pending;
    setBusy(false);
    if (result.ok) dealt(report.reportId);
    else setProblem(result.problem);
  }
  const perform = (row: Row) => {
    if (!confirm(row.confirm)) return;
    const until = row.ends && days > 0 ? Date.now() + days * DAY : undefined;
    void run(act(calls, report, row, reason, until));
  };

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
      {report.targetAccount !== null && (
        <p>
          {strings.platform_account}: <AuthorName author={report.targetAccount} />
        </p>
      )}
      <Quoted report={report} card={card} />
      <label htmlFor={`${id}-reason`}>{strings.report_reason}</label>
      <input
        id={`${id}-reason`}
        aria-describedby={`${id}-reason-help`}
        value={reason}
        onChange={(event) => setReason(clipText(event.target.value, LIMITS.moderationNoteChars))}
        className="min-h-11 rounded-md border border-border-strong bg-surface px-3"
      />
      <p id={`${id}-reason-help`} className="text-sm text-muted-fg">
        {strings.moderation_reason_required}
      </p>
      {rows.some((row) => row.ends) && (
        <>
          <label htmlFor={`${id}-days`}>{strings.moderation_mute_for}</label>
          <select
            id={`${id}-days`}
            value={days}
            onChange={(event) => setDays(Number(event.target.value))}
            className="min-h-11 rounded-md border border-border-strong bg-surface px-3"
          >
            <option value={0}>{strings.platform_suspend_open}</option>
            {MUTES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </>
      )}
      <div className="flex flex-wrap gap-2">
        {rows.map((row) => (
          <Button key={row.id} tone="danger" disabled={blocked} onClick={() => perform(row)}>
            {row.label}
          </Button>
        ))}
        <Button disabled={blocked} onClick={() => void run(dismiss(calls, report, reason))}>
          {strings.moderation_dismiss}
        </Button>
      </div>
      <Status>{problem && <ProblemText problem={problem} />}</Status>
    </article>
  );
}

function LogList({ log }: Readonly<{ log: Paged<ModerationLogEntry> }>) {
  if (log.items === null) {
    return log.problem === null ? (
      <Status>{strings.loading}</Status>
    ) : (
      <Status>
        <ProblemText problem={log.problem} />
      </Status>
    );
  }
  return (
    <>
      {log.items.length === 0 && <p className="text-muted-fg">{strings.moderation_log_empty}</p>}
      <LogEntries entries={log.items} target />
      {log.problem !== null && (
        <Status>
          <ProblemText problem={log.problem} />
        </Status>
      )}
      {log.hasMore && <div ref={log.sentinel} />}
    </>
  );
}
