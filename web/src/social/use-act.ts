import { useCallback, useState } from "react";
import type { Problem } from "../problem.ts";
import type { Outcome } from "./outcome.ts";

/** One write at a time: the busy flag, what it was refused for, and what follows success. */
export function useAct(done: () => void): {
  busy: boolean;
  problem: Problem | null;
  act: (write: () => Promise<Outcome<unknown>>) => void;
} {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  // A write that rejects is as unreachable as one that answers nothing, and
  // either way the busy flag must come down: a stuck true takes the form away.
  const act = useCallback(
    (write: () => Promise<Outcome<unknown>>) => {
      setBusy(true);
      setProblem(null);
      write()
        .then((result) => {
          setBusy(false);
          if (result.ok) done();
          else setProblem(result.problem);
        })
        .catch(() => {
          setBusy(false);
          setProblem({ kind: "unreachable" });
        });
    },
    [done],
  );
  return { busy, problem, act };
}
