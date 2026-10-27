import { useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { notifications } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";

// The unseen count on the bell in the top bar (decisions 0104, 0109): asked for on every
// navigation, and when the notifications page has marked some read.

const listeners = new Set<() => void>();

/** Tells the bell to ask again. */
export function unreadChanged(): void {
  for (const listener of listeners) listener();
}

export function UnreadBadge({ className = "ml-1 px-2 text-sm" }: Readonly<{ className?: string }>) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [round, setRound] = useState(0);
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    const listener = () => setRound((n) => n + 1);
    listeners.add(listener);
    return () => void listeners.delete(listener);
  }, []);
  useEffect(() => {
    let live = true;
    notifications({ query: { limit: 1 } })
      .then((answer) => {
        if (live && answer.status === 200) setUnread(answer.data.unseen);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [path, round]);
  if (unread === 0) return null;
  return (
    <span className={`rounded-full bg-primary text-primary-fg ${className}`}>
      <span aria-hidden="true">{unread}</span>
      <span className="sr-only">{strings.notifications_unread({ count: unread })}</span>
    </span>
  );
}
