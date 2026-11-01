import { useCallback, useEffect, useRef, useState } from "react";
import type { ImportStatus } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import type { Problem } from "../problem.ts";
import { ProblemText } from "../ui/kit.tsx";

// What the import screens share: the sentences for what the server answered, and
// asking again while something is being worked on elsewhere.

/** Sentences for refusals only these screens meet, by the code the API gives. */
export type ProblemNames = Readonly<Record<string, string>>;

/** A problem in the sentence named for its code, else in the app's general words. */
export function ImportProblem({
  problem,
  names = {},
}: Readonly<{ problem: Problem; names?: ProblemNames }>) {
  const named =
    problem.kind === "refused" && problem.code !== null
      ? { rate_limited: strings.imports_rate_limited, ...names }[problem.code]
      : undefined;
  return named === undefined ? <ProblemText problem={problem} /> : <span>{named}</span>;
}

const FAILURES: Readonly<Record<string, string>> = {
  truncated: strings.imports_failed_truncated,
  zip64: strings.imports_failed_zip64,
  encrypted: strings.imports_failed_encrypted,
  unsupported: strings.imports_failed_unsupported,
  too_big: strings.imports_failed_too_big,
  corrupt: strings.imports_failed_corrupt,
  no_posts: strings.imports_failed_no_posts,
};

/** Why an import failed; one with no reason ran out of time while it was being published. */
export function failureSentence(failure: string | null): string {
  return (failure === null ? undefined : FAILURES[failure]) ?? strings.imports_failed_expired;
}

/** An earlier import's state, for the list. */
export const STATE_WORD: Readonly<Record<ImportStatus["state"], string>> = {
  uploading: strings.imports_state_uploading,
  parsing: strings.imports_state_parsing,
  ready: strings.imports_state_ready,
  publishing: strings.imports_state_publishing,
  done: strings.imports_state_done,
  failed: strings.imports_state_failed,
  removing: strings.imports_wait_removing,
};

/**
 * A section's one request at a time: `act` holds `busy` while the request runs, keeps what
 * it refused, reloads the list and says whether it went through.
 */
export function useAct(reload: () => void) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const act = useCallback(
    async (pending: Promise<{ ok: true } | { ok: false; problem: Problem }>) => {
      setBusy(true);
      setProblem(null);
      const result = await pending;
      setBusy(false);
      if (!result.ok) setProblem(result.problem);
      reload();
      return result.ok;
    },
    [reload],
  );
  return { busy, problem, act };
}

/** Calls `reload` every `ms` for as long as `active` holds. */
export function usePoll(active: boolean, reload: () => void, ms = 3000) {
  const latest = useRef(reload);
  latest.current = reload;
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => latest.current(), ms);
    return () => clearInterval(timer);
  }, [active, ms]);
}
