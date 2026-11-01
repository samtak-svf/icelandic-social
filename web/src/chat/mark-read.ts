import { useEffect, useRef, useSyncExternalStore } from "react";
import type { Item } from "../generated/core.d.ts";
import { useChat } from "./chat.tsx";

// Opening a conversation marks it read, as the apps do (decision 0124): the newest
// item is on screen once the timeline is read, so everything up to it is read.
// A tab nobody can see reads nothing. The mark also goes out as a read receipt
// when the reader's setting allows it (0022).

/** The newest item with a place in the conversation; one being sent has none yet. */
export interface Newest {
  conversation: string;
  seq: number;
}

export function newestSeq(items: readonly Pick<Item, "seq">[]): number | null {
  let newest: number | null = null;
  for (const { seq } of items) if (seq !== null && (newest === null || seq > newest)) newest = seq;
  return newest;
}

/** The seq to mark in `conversation`, or null when there is nothing new to mark. */
export function toMark(
  conversation: string,
  newest: Newest | null,
  marked: Newest | null,
): number | null {
  if (newest === null || newest.conversation !== conversation) return null;
  if (marked?.conversation === conversation && newest.seq <= marked.seq) return null;
  return newest.seq;
}

function watchVisibility(changed: () => void): () => void {
  document.addEventListener("visibilitychange", changed);
  return () => document.removeEventListener("visibilitychange", changed);
}

export function useMarkRead(conversation: string, newest: Newest | null): void {
  const { call, sync, reloadConversations } = useChat();
  const visible = useSyncExternalStore(
    watchVisibility,
    () => document.visibilityState === "visible",
    () => false,
  );
  const marked = useRef<Newest | null>(null);
  useEffect(() => {
    if (call === undefined || !visible) return;
    const seq = toMark(conversation, newest, marked.current);
    if (seq === null) return;
    marked.current = { conversation, seq };
    call("markRead", conversation, seq).then(
      () => {
        sync();
        reloadConversations();
      },
      () => {
        // Asked again with the next item, or the next time the page shows.
        marked.current = null;
      },
    );
  }, [call, conversation, newest, visible, sync, reloadConversations]);
}
