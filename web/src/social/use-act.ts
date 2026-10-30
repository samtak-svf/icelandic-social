import { useState } from "react";
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
  const act = (write: () => Promise<Outcome<unknown>>) => {
    setBusy(true);
    setProblem(null);
    void write().then((result) => {
      setBusy(false);
      if (result.ok) done();
      else setProblem(result.problem);
    });
  };
  return { busy, problem, act };
}
