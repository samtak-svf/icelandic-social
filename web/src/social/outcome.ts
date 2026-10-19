import { useEffect, useState } from "react";
import { useAccount } from "../account.tsx";
import { refused, type Problem } from "../problem.ts";
import { formatIsDateTime } from "../lib/is-format.ts";

// What a call to the API came to, for the pages of the social slice: the body
// of the status the page waits for, or what went wrong. A 401 means this
// session ended elsewhere, so the account is asked again.

export type Outcome<T> =
  | { ok: true; data: T }
  | { ok: false; status: number | null; problem: Problem };

/** Waits for `pending` and keeps the body of status `ok`, or the problem. */
export async function outcome<A extends { status: number; data: unknown }, S extends A["status"]>(
  pending: Promise<A>,
  ok: S,
): Promise<Outcome<Extract<A, { status: S }>["data"]>> {
  try {
    const answer = await pending;
    if (answer.status === ok) {
      return { ok: true, data: answer.data as Extract<A, { status: S }>["data"] };
    }
    return { ok: false, status: answer.status, problem: refused(answer.data) };
  } catch {
    return { ok: false, status: null, problem: { kind: "unreachable" } };
  }
}

/**
 * Loads with `load` when it changes and on `reload`; null until the first
 * answer. A 401 asks for the account again, which shows the sign-in page.
 */
export function useLoad<T>(load: () => Promise<Outcome<T>>): [Outcome<T> | null, () => void] {
  const { refresh } = useAccount();
  const [state, setState] = useState<Outcome<T> | null>(null);
  const [round, setRound] = useState(0);
  useEffect(() => {
    let live = true;
    void load().then((result) => {
      if (!live) return;
      if (!result.ok && result.status === 401) void refresh();
      setState(result);
    });
    return () => {
      live = false;
    };
  }, [load, refresh, round]);
  return [state, () => setRound((n) => n + 1)];
}

/** A moment, as a person in Iceland reads it. */
export function when(ms: number): string {
  return formatIsDateTime(ms);
}
