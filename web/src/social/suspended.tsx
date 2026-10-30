import { Link } from "@tanstack/react-router";
import { useMe } from "../account.tsx";
import type { Me } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { formatIsDateTime } from "../lib/is-format.ts";

// What a suspended account sees (decision 0115): one notice on the signed-in
// pages (not a conversation's, where nothing is refused), and the writes it may
// not make disabled. The server decides; it refuses
// each of them with the code `suspended`, which is the backstop for a suspension
// that began while the page was open.

/** The suspension of `me` that stands at `now`; one whose end has passed does not. */
export function standing(me: Me, now: number = Date.now()): Me["suspension"] {
  const { suspension } = me;
  return suspension !== null && (suspension.until === null || suspension.until > now)
    ? suspension
    : null;
}

/** Whether the signed-in account is suspended now. */
export function useSuspended(): boolean {
  const me = useMe();
  return me !== null && standing(me) !== null;
}

/** The sentence for a suspension that stands. */
export function suspendedText(until: number | null): string {
  return until === null
    ? strings.suspended_notice
    : strings.suspended_notice_until({ date: formatIsDateTime(until) });
}

/** The notice, with the way to the reason and the review; nothing when none stands. */
export function SuspendedNotice() {
  const me = useMe();
  const suspension = me === null ? null : standing(me);
  if (suspension === null) return null;
  return (
    <div role="status" className="mb-6 rounded-md border border-border-strong bg-muted p-4">
      <p>{suspendedText(suspension.until)}</p>
      <p className="mt-2">
        <Link to="/statements" className="underline">
          {strings.statement_open}
        </Link>
      </p>
    </div>
  );
}
