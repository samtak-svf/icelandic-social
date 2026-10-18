import { useId, useState, type FormEvent } from "react";
import type { Problem } from "../account.tsx";
import { Button, ProblemText, Status } from "../ui/kit.tsx";
import type { Outcome } from "./outcome.ts";

// The one text box a post and a comment are both written in.

export function Composer({
  label,
  action,
  max,
  send,
}: Readonly<{
  label: string;
  action: string;
  max: number;
  send: (text: string) => Promise<Outcome<unknown>>;
}>) {
  const id = useId();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    const sent = await send(text.trim());
    setBusy(false);
    if (sent.ok) setText("");
    else setProblem(sent.problem);
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-2">
      <label htmlFor={id} className="font-semibold">
        {label}
      </label>
      <textarea
        id={id}
        value={text}
        maxLength={max}
        rows={3}
        onChange={(event) => setText(event.target.value)}
        className="rounded-md border border-border-strong bg-surface p-2"
      />
      <Button
        tone="primary"
        type="submit"
        disabled={busy || text.trim() === ""}
        className="self-end"
      >
        {action}
      </Button>
      <Status>{problem && <ProblemText problem={problem} />}</Status>
    </form>
  );
}
