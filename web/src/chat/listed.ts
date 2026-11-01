import { useCallback, useEffect, useRef, useState } from "react";
import type { Conversation, CoreEvent } from "../generated/core.d.ts";
import type { ChatCall } from "./protocol.ts";
import type { CatchUp } from "./session.ts";

/** The rows, and whether they were read once the chat had caught up (0108). */
export interface Listed {
  rows: Conversation[];
  caughtUp: boolean;
}

/**
 * The conversations of this browser's store, as the core lists them, reloaded
 * when it reports a change. `call` is defined while this tab runs the chat.
 */
export function useListed(
  call: ChatCall | undefined,
  subscribe: (listener: (events: CoreEvent[]) => void) => () => void,
  catchUp: CatchUp,
): { listed: Listed | null; failed: boolean; reload: () => void } {
  const [listed, setListed] = useState<Listed | null>(null);
  const [failed, setFailed] = useState(false);
  const asked = useRef(0);
  // Read again when the chat catches up: an imported history reports no event.
  const caughtUp = catchUp === "done";
  const reload = useCallback(() => {
    if (call === undefined) return;
    // Only the newest answer counts: one read before a mark must not bring its count back.
    const mine = ++asked.current;
    call("conversations").then(
      (rows) => {
        if (mine !== asked.current) return;
        setListed({ rows, caughtUp });
        setFailed(false);
      },
      () => {
        if (mine === asked.current) setFailed(true);
      },
    );
  }, [call, caughtUp]);
  useEffect(() => {
    if (call === undefined) {
      asked.current++;
      setListed(null);
      setFailed(false);
    }
  }, [call]);
  useEffect(reload, [reload]);
  useEffect(
    () =>
      subscribe((events) => {
        if (events.some((e) => e.kind !== "typing")) reload();
      }),
    [subscribe, reload],
  );
  return { listed, failed, reload };
}
