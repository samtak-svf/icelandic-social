import { useId, useState, type FormEvent } from "react";
import type { Problem } from "../problem.ts";
import { report, type ReportTarget } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { Button, type ButtonTone, ProblemText, Status } from "../ui/kit.tsx";
import { outcome } from "./outcome.ts";

// Reporting a post or comment to the moderators (decision 0066). Unlawful
// content goes to the platform's moderators; the rest to the community's.
// Nobody is ever told who reported.

const REASONS = [
  ["unlawful", strings.report_reason_unlawful],
  ["harassment", strings.report_reason_harassment],
  ["spam", strings.report_reason_spam],
  ["other", strings.report_reason_other],
] as const;
type Reason = (typeof REASONS)[number][0];

export function ReportButton({
  target,
  tone = "quiet",
}: Readonly<{ target: ReportTarget; tone?: ButtonTone }>) {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  if (sent) return <Status>{strings.report_sent}</Status>;
  if (!open) {
    return (
      <Button tone={tone} className="text-sm" onClick={() => setOpen(true)}>
        {strings.report}
      </Button>
    );
  }
  return <ReportForm target={target} onSent={() => setSent(true)} />;
}

export function ReportForm({
  target,
  onSent,
}: Readonly<{ target: ReportTarget; onSent: () => void }>) {
  const note = useId();
  const [reason, setReason] = useState<Reason | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);

  async function send(event: FormEvent) {
    event.preventDefault();
    if (reason === null) return;
    setBusy(true);
    setProblem(null);
    // A second report on the same thing while one is open is the same report.
    const sent = await outcome(report({ body: { target, reason, note: text.trim() } }), 204);
    setBusy(false);
    if (sent.ok) onSent();
    else setProblem(sent.problem);
  }

  return (
    <form
      onSubmit={(event) => void send(event)}
      className="mt-2 flex flex-col gap-3 rounded-md border border-border p-3"
    >
      <fieldset>
        <legend className="font-semibold">{strings.report_title}</legend>
        <p className="text-sm text-muted-fg">{strings.report_reason}</p>
        {REASONS.map(([value, label]) => (
          <label key={value} className="flex min-h-11 items-center gap-2">
            <input
              type="radio"
              name="reason"
              value={value}
              checked={reason === value}
              onChange={() => setReason(value)}
            />
            {label}
          </label>
        ))}
      </fieldset>
      <label htmlFor={note} className="text-sm">
        {strings.report_note}
      </label>
      <textarea
        id={note}
        value={text}
        maxLength={1000}
        onChange={(event) => setText(event.target.value)}
        className="rounded-md border border-border-strong bg-surface p-2"
      />
      <Button tone="primary" type="submit" disabled={busy || reason === null}>
        {strings.report_send}
      </Button>
      <Status>{problem && <ProblemText problem={problem} />}</Status>
    </form>
  );
}
