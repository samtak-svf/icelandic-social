import { unreadChanged } from "../ui/unread.tsx";
import type { Outcome } from "./outcome.ts";

/**
 * Passes `pending` through and, when it succeeded, tells the bell to ask for its
 * count again: the call ended a notice of the caller's (answering an invitation
 * or a friend request), so the count shown is one too high until it does.
 */
export async function endsNotice<T>(pending: Promise<Outcome<T>>): Promise<Outcome<T>> {
  const done = await pending;
  if (done.ok) unreadChanged();
  return done;
}
