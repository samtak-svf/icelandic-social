import { useState } from "react";
import type { Problem } from "../problem.ts";
import { strings } from "../generated/brand/strings.ts";
import { Button, type ButtonTone, ProblemText, Status } from "../ui/kit.tsx";
import type { Outcome } from "./outcome.ts";

/** Deletes the author's own post or comment, once they confirm. */
export function DeleteButton({
  ask,
  remove,
  deleted,
  tone = "danger",
}: Readonly<{
  ask: string;
  remove: () => Promise<Outcome<unknown>>;
  deleted: () => void;
  tone?: ButtonTone;
}>) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  async function go() {
    if (!confirm(ask)) return;
    setBusy(true);
    setProblem(null);
    const done = await remove();
    setBusy(false);
    if (done.ok) deleted();
    else setProblem(done.problem);
  }
  return (
    <div className="flex flex-col items-end">
      <Button tone={tone} className="text-sm" disabled={busy} onClick={() => void go()}>
        {strings.delete}
      </Button>
      <Status inline>{problem && <ProblemText problem={problem} />}</Status>
    </div>
  );
}
