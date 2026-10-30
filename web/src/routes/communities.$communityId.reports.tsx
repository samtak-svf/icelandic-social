import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useId, useState } from "react";
import type { Problem } from "../problem.ts";
import {
  closeReport,
  communityReports,
  moderate,
  type Author,
  type Card,
  type Report,
} from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { ManageFrame } from "../social/manage-frame.tsx";
import { outcome, useLoad, when } from "../social/outcome.ts";
import { DAY, MUTES } from "../social/mute-lengths.ts";
import { authorName } from "../social/author-name.tsx";
import {
  Decision,
  isContent,
  Quoted,
  REASONS,
  useCards,
  type Content,
} from "../social/report-card.tsx";
import { RevealAuthor } from "../social/reveal-author.tsx";
import { verbs } from "../social/verbs.ts";
import { Button, ProblemText, Status } from "../ui/kit.tsx";

// A community's report queue (decision 0066), oldest first, open or closed:
// what was reported, as a card, and why. The moderator hides, removes or
// restores the content, mutes, unmutes, bans or unbans the member it is
// about, with a reason that is logged, or closes the report without acting.
// An action on an open report closes it; on a closed one it acts alone. Only
// the verbs that apply to the target as it stands now are offered (#361), and
// a closed report says what was decided, by whom and when (#360).
export const Route = createFileRoute("/communities/$communityId/reports")({
  component: ReportsPage,
  staticData: { width: "wide" },
});

/** How long a mute lasts, in days, as the moderator chooses it. */
type Queue = "open" | "closed";

function ReportsPage() {
  const { communityId } = Route.useParams();
  return (
    <ManageFrame communityId={communityId}>
      {(_, changed) => <Reports communityId={communityId} changed={changed} />}
    </ManageFrame>
  );
}

function Reports({ communityId, changed }: Readonly<{ communityId: string; changed: () => void }>) {
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
  const done = useCallback(() => {
    reload();
    changed();
  }, [reload, changed]);
  return (
    <>
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
        <ReportList reports={shown} state={state} communityId={communityId} done={done} />
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
      <Quoted report={report} card={card} />
      {report.targetAnonymous && isContent(target) && target.kind === "post" && (
        <RevealAuthor postId={target.id} />
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
