// What is unread in this browser's chat (decision 0124), for the count on the
// place of the conversations, the bell and the notifications page. It is read
// from the store and carries no message, so it can go to the other tabs of this
// browser: they cannot open the store while one tab holds it. It travels in
// memory over a channel of this origin and is never written anywhere.

import type { Conversation } from "../generated/core.d.ts";

/** A conversation with something unread: who, how many, and never what. */
export type UnreadRow = Conversation & { last: null };

type UnreadMessage =
  | { kind: "ask" }
  /** All of them: an empty list means nothing is unread. */
  | { kind: "rows"; rows: readonly UnreadRow[] };

/** The conversations that count, without their last message. A muted one does not count. */
export function unreadRows(rows: readonly Conversation[]): UnreadRow[] {
  return rows
    .filter((c) => c.unread > 0 && c.mute.kind === "off")
    .map((c) => ({ ...c, last: null }));
}

export function unreadTotal(rows: readonly UnreadRow[]): number {
  return rows.reduce((sum, c) => sum + c.unread, 0);
}

/** The other tabs of this browser. */
export interface UnreadChannel {
  post(message: UnreadMessage): void;
  listen(listener: (message: UnreadMessage) => void): void;
  close(): void;
}

export function browserUnreadChannel(): UnreadChannel {
  const channel = new BroadcastChannel("spjall-chat-unread");
  return {
    post: (message) => channel.postMessage(message),
    listen(listener) {
      channel.onmessage = (event: MessageEvent<UnreadMessage>) => listener(event.data);
    },
    close: () => channel.close(),
  };
}
