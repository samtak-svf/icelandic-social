import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useId, useState } from "react";
import type { Problem } from "../problem.ts";
import {
  closeReport,
  communityReports,
  moderate,
  resolveCards,
  type Author,
  type Card,
  type Report,
  type ReportTarget,
} from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { outcome, useLoad, when } from "../social/outcome.ts";
import { AuthorName, authorName } from "../social/post.tsx";
import { verbs } from "../social/verbs.ts";
import { Button, ProblemText, Status } from "../ui/kit.tsx";

// A community's report queue (decision 0066), oldest first, open or closed:
// what was reported, as a card, and why. The moderator hides, removes or
// restores the content, mutes, unmutes, bans or unbans the member it is
// about, with a reason that is logged, or closes the report without acting.
// An action on an open report closes it; on a closed one it acts alone. Only
// the verbs that apply to the target as it stands now are offered (#361), and
// a closed report says what was decided, by whom and when (#360).
export const Route = createFileRoute("/communities/$communityId/reports")({ component: Reports });

const REASONS = {
  unlawful: strings.report_reason_unlawful,
  harassment: strings.report_reason_harassment,
  spam: strings.report_reason_spam,
  other: strings.report_reason_other,
} as const;

const DECISIONS: Record<NonNullable<Report["decision"]>, string> = {
  hide_post: strings.moderation_decision_hide_post,
  remove_post: strings.moderation_decision_remove_post,
  restore_post: strings.moderation_decision_restore_post,
  hide_comment: strings.moderation_decision_hide_comment,
  remove_comment: strings.moderation_decision_remove_comment,
  restore_comment: strings.moderation_decision_restore_comment,
  mute_member: strings.moderation_decision_mute_member,
  unmute_member: strings.moderation_decision_unmute_member,
  remove_member: strings.moderation_decision_remove_member,
  ban_member: strings.moderation_decision_ban_member,
  unban_member: strings.moderation_decision_unban_member,
  dismissed: strings.moderation_decision_dismissed,
  community_deleted: strings.moderation_decision_community_deleted,
};

const DAY = 24 * 60 * 60 * 1000;

/** How long a mute lasts, in days, as the moderator chooses it. */
const MUTES = [
  [1, strings.moderation_mute_day],
  [7, strings.moderation_mute_week],
  [30, strings.moderation_mute_month],
] as const;

type Queue = "open" | "closed";

function Reports() {
  const { communityId } = Route.useParams();
  const [state, setState] = useState<Queue>("open");
  const [queue, reload] = useLoad(
    useCallback(async () => {
      const page = await outcome(
        communityReports({ path: { communityId }, query: { state } }),
        200,
      );
      return page.ok ? { ok: true as const, data: { ...page.data, state } } : page;
    }, [communityId, state]),
  );
  // A queue is shown only once it is the one chosen, not the one before.
  const shown = queue?.ok && queue.data.state === state ? queue.data.reports : null;
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
      <div role="group" aria-label={strings.moderation_queue} className="mt-4 flex gap-2">
        {(
          [
            ["open", strings.moderation_open],
            ["closed", strings.moderation_closed],
          ] as const
        ).map(([value, label]) => (
          <Button
            key={value}
            aria-pressed={state === value}
            className="aria-pressed:border-primary aria-pressed:bg-muted"
            onClick={() => setState(value)}
          >
            {label}
          </Button>
        ))}
      </div>
      {queue?.ok === false ? (
        <Status>
          <ProblemText problem={queue.problem} />
        </Status>
      ) : shown === null ? (
        <Status>{strings.loading}</Status>
      ) : (
        <ReportList reports={shown} state={state} communityId={communityId} done={reload} />
      )}
    </>
  );
}

function ReportList({
  reports,
  state,
  communityId,
  done,
}: Readonly<{ reports: Report[]; state: Queue; communityId: string; done: () => void }>) {
  const cards = useCards(reports);
  if (reports.length === 0) {
    return (
      <p className="mt-4 text-muted-fg">
        {state === "open" ? strings.moderation_queue_empty : strings.moderation_closed_empty}
      </p>
    );
  }
  return (
    <ul className="mt-4 flex flex-col gap-4">
      {reports.map((r) => (
        <li key={r.reportId}>
          <ReportItem
            report={r}
            card={cards.get(r.target.id)}
            communityId={communityId}
            done={done}
          />
        </li>
      ))}
    </ul>
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

type Action = Parameters<typeof moderate>[0]["body"]["action"];

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
  const [acted, setActed] = useState(false);
  const { target } = report;
  const open = report.state === "open";
  const member = report.targetAccount;

  async function act(pending: Promise<{ ok: true } | { ok: false; problem: Problem }>) {
    setBusy(true);
    setProblem(null);
    setActed(false);
    const result = await pending;
    setBusy(false);
    if (result.ok) {
      setActed(true);
      done();
    } else setProblem(result.problem);
  }
  const action = (verb: Action, targetId: string, until?: number) =>
    act(
      outcome(
        moderate({
          path: { communityId },
          body: {
            action: verb,
            targetId,
            reason: reason.trim(),
            ...(until === undefined ? {} : { until }),
            // A closed report is closed already; the action stands alone.
            ...(open ? { reportId: report.reportId } : {}),
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
  const blocked = busy || reason.trim() === "";
  const can = verbs(report);

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
      {!open && <Decision report={report} />}
      {card && card.kind !== "unavailable" && card.kind !== "community" && (
        <blockquote className="rounded-md bg-muted p-3">
          <p>
            <AuthorName author={card.author} />
          </p>
          <p className="whitespace-pre-wrap">{card.excerpt}</p>
        </blockquote>
      )}
      <label htmlFor={`${id}-reason`}>{strings.report_reason}</label>
      <input
        id={`${id}-reason`}
        aria-describedby={`${id}-reason-help`}
        value={reason}
        maxLength={500}
        onChange={(event) => setReason(event.target.value)}
        className="min-h-11 rounded-md border border-border-strong bg-surface px-3"
      />
      <p id={`${id}-reason-help`} className="text-sm text-muted-fg">
        {strings.moderation_reason_required}
      </p>
      <div className="flex flex-wrap gap-2">
        {isContent(target) && (
          <ContentActions target={target} can={can} blocked={blocked} action={action} />
        )}
        {open && (
          <Button disabled={blocked} onClick={() => void dismiss()}>
            {strings.moderation_dismiss}
          </Button>
        )}
      </div>
      {member !== null && (
        <MemberActions member={member} can={can} blocked={blocked} action={action} />
      )}
      <Status>
        {problem ? <ProblemText problem={problem} /> : acted && strings.moderation_done}
      </Status>
    </article>
  );
}

/** What a closed report came to: the decision, its reason, who and when (#360). */
function Decision({ report }: Readonly<{ report: Report }>) {
  const date = report.closedAt === null ? null : when(report.closedAt);
  return (
    <div className="flex flex-col gap-1 rounded-md bg-muted p-3">
      {report.decision !== null && <p className="font-semibold">{DECISIONS[report.decision]}</p>}
      {report.resolution !== null && report.resolution !== "" && (
        <p className="whitespace-pre-wrap">{report.resolution}</p>
      )}
      {date !== null && (
        <p className="text-sm text-muted-fg">
          {report.closedBy === null
            ? strings.moderation_closed_at({ date })
            : strings.moderation_closed_by({ name: authorName(report.closedBy), date })}
        </p>
      )}
    </div>
  );
}

type Act = (verb: Action, targetId: string, until?: number) => Promise<void>;
type Verbs = ReturnType<typeof verbs>;

/** The verbs on a post or comment that apply to it as it stands. */
function ContentActions({
  target,
  can,
  blocked,
  action,
}: Readonly<{ target: Content; can: Verbs; blocked: boolean; action: Act }>) {
  return (
    <>
      {can.hide && (
        <Button disabled={blocked} onClick={() => void action(`hide_${target.kind}`, target.id)}>
          {strings.moderation_hide}
        </Button>
      )}
      {can.remove && (
        <Button
          tone="danger"
          disabled={blocked}
          onClick={() => void action(`remove_${target.kind}`, target.id)}
        >
          {strings.moderation_remove}
        </Button>
      )}
      {can.restore && (
        <Button disabled={blocked} onClick={() => void action(`restore_${target.kind}`, target.id)}>
          {strings.moderation_restore}
        </Button>
      )}
    </>
  );
}

/** The verbs on the reported account that apply to its standing, if any do. */
function MemberActions({
  member,
  can,
  blocked,
  action,
}: Readonly<{ member: Author; can: Verbs; blocked: boolean; action: Act }>) {
  const id = useId();
  const [days, setDays] = useState<number>(MUTES[0][0]);
  if (!(can.mute || can.unmute || can.ban || can.unban)) return null;
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="font-semibold">
        {strings.moderation_member}: {authorName(member)}
      </legend>
      {can.mute && (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={`${id}-days`}>{strings.moderation_mute_for}</label>
          <select
            id={`${id}-days`}
            value={days}
            onChange={(event) => setDays(Number(event.target.value))}
            className="min-h-11 rounded-md border border-border-strong bg-surface px-3"
          >
            {MUTES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <Button
            disabled={blocked}
            onClick={() => void action("mute_member", member.accountId, Date.now() + days * DAY)}
          >
            {strings.moderation_mute}
          </Button>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {can.unmute && (
          <Button disabled={blocked} onClick={() => void action("unmute_member", member.accountId)}>
            {strings.moderation_unmute}
          </Button>
        )}
        {can.ban && (
          <Button
            tone="danger"
            disabled={blocked}
            onClick={() => void action("ban_member", member.accountId)}
          >
            {strings.moderation_ban}
          </Button>
        )}
        {can.unban && (
          <Button disabled={blocked} onClick={() => void action("unban_member", member.accountId)}>
            {strings.moderation_unban}
          </Button>
        )}
      </div>
    </fieldset>
  );
}
