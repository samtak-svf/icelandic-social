import { useId, useState, type FormEvent } from "react";
import type { Problem } from "../problem.ts";
import { removeWallComment } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { Dialog } from "../ui/dialog.tsx";
import { Button, ProblemText, Status } from "../ui/kit.tsx";
import { outcome } from "./outcome.ts";

// The owner of a wall takes a comment off it (decision 0115): with a reason,
// and the one who wrote it is told. Reporting stays with every reader.

export function RemoveWallComment({
  commentId,
  removed,
}: Readonly<{ commentId: string; removed: () => void }>) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    const done = await outcome(
      removeWallComment({ path: { commentId }, body: { reason: reason.trim() } }),
      204,
    );
    setBusy(false);
    if (done.ok) {
      setOpen(false);
      removed();
    } else setProblem(done.problem);
  }
  return (
    <>
      <Button tone="link" className="text-sm" onClick={() => setOpen(true)}>
        {strings.wall_comment_remove}
      </Button>
      {open && (
        <Dialog title={strings.wall_comment_remove} onClose={() => setOpen(false)}>
          <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3">
            <p>{strings.wall_comment_remove_confirm}</p>
            <label htmlFor={id} className="text-sm font-medium">
              {strings.wall_comment_remove_reason}
            </label>
            <textarea
              id={id}
              value={reason}
              rows={3}
              maxLength={500}
              onChange={(event) => setReason(event.target.value)}
              className="rounded-md border border-border-strong bg-surface p-2"
            />
            <div className="flex justify-end gap-2">
              <Button onClick={() => setOpen(false)}>{strings.cancel}</Button>
              <Button tone="danger" type="submit" disabled={busy || reason.trim() === ""}>
                {strings.wall_comment_remove}
              </Button>
            </div>
            <Status>{problem !== null && <ProblemText problem={problem} />}</Status>
          </form>
        </Dialog>
      )}
    </>
  );
}
