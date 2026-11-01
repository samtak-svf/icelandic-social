import { useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useChat } from "../chat/chat.tsx";
import { unreadTotal } from "../chat/unread.ts";
import { notifications } from "../generated/api.ts";
import { strings } from "../generated/brand/strings.ts";
import { settled } from "../social/notice-writes.ts";

// The count on the bell in the top bar (decisions 0104, 0109, 0124): what the server says is
// unseen, asked for on every navigation and when the notifications page has marked some read
// (it waits for the notification writes in flight, so the count shows them), and the unread
// conversations from this browser's store, which only reading them clears.

const listeners = new Set<() => void>();

/** Tells the bell to ask again. */
export function unreadChanged(): void {
  for (const listener of listeners) listener();
}

/** Up to 99, then `99+` (0109). */
export function badgeCount(count: number): string {
  return count > 99 ? "99+" : String(count);
}

/** A count in a pill, with its words for a screen reader. */
export function CountBadge({
  count,
  label,
  className,
}: Readonly<{ count: number; label: string; className: string }>) {
  return (
    <span className={`rounded-full bg-primary text-primary-fg ${className}`}>
      <span aria-hidden="true">{badgeCount(count)}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function UnreadBadge({ className }: Readonly<{ className: string }>) {
  const chat = unreadTotal(useChat().unread);
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
    settled()
      .then(() => notifications({ query: { limit: 1 } }))
      .then((answer) => {
        if (live && answer.status === 200) setUnread(answer.data.unseen);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [path, round]);
  const count = unread + chat;
  if (count === 0) return null;
  return (
    <CountBadge
      count={count}
      label={strings.notifications_unread({ count })}
      className={className}
    />
  );
}
