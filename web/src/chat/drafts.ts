// The unsent text of each conversation's composer (#324), kept while the page
// lives: leaving a conversation and coming back finds it where it was, and
// switching between conversations in two panes never carries one's text into
// another.
//
// Memory only, on purpose: a draft is message text this client otherwise keeps
// only in the core's encrypted store, so it is never written to web storage.
import { useCallback, useState } from "react";

const drafts = new Map<string, string>();

/** The draft of `conversation`, or "". */
export function draftOf(conversation: string): string {
  return drafts.get(conversation) ?? "";
}

/** Keeps `text` for `conversation`; a blank one is no draft. */
export function keepDraft(conversation: string, text: string): void {
  if (text.trim() === "") drafts.delete(conversation);
  else drafts.set(conversation, text);
}

/** Signing out takes every draft with it. */
export function clearDrafts(): void {
  drafts.clear();
}

/** The composer's text for `conversation`, kept across leaving it. */
export function useDraft(conversation: string): [string, (text: string) => void] {
  const [held, setHeld] = useState(() => ({ conversation, text: draftOf(conversation) }));
  const text = held.conversation === conversation ? held.text : draftOf(conversation);
  const setText = useCallback(
    (next: string) => {
      keepDraft(conversation, next);
      setHeld({ conversation, text: next });
    },
    [conversation],
  );
  return [text, setText];
}
