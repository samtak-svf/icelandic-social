import { useCallback, useEffect, useState } from "react";
import { strings } from "../generated/brand/strings.ts";
import type { Conversation } from "../generated/core.d.ts";
import { Status } from "../ui/kit.tsx";
import { useChat } from "./chat.tsx";
import { ConversationRow } from "./conversation-row.tsx";
import type { CatchUp } from "./session.ts";

/** The rows, and whether they were read once the chat had caught up (0109). */
export interface Listed {
  rows: Conversation[];
  caughtUp: boolean;
}

/**
 * The line above the list, if any. "No conversations" is said only of a list
 * read after the chat caught up: before that, a newly linked browser's store
 * is empty only because its history and backlog are still arriving.
 */
export function listNotice(
  list: Listed | null,
  failed: boolean,
  catchUp: CatchUp,
): { text: string; status: boolean } | null {
  if (failed) return { text: strings.try_again, status: true };
  if (catchUp === "history") return { text: strings.device_link_web_receiving, status: true };
  if (list === null) return { text: strings.loading, status: true };
  if (list.rows.length > 0) return null;
  if (!list.caughtUp) return { text: strings.conversations_catching_up, status: true };
  return { text: strings.conversations_empty, status: false };
}

/**
 * The conversations of this browser's store, as the core lists them, reloaded
 * when it reports a change; who is typing comes from the same events. The
 * heading is the page's own unless a conversation is open beside it.
 */
export function ConversationList({ level }: Readonly<{ level: 1 | 2 }>) {
  const { call, subscribe, catchUp } = useChat();
  const [list, setList] = useState<Listed | null>(null);
  const [failed, setFailed] = useState(false);
  const [typing, setTyping] = useState<ReadonlySet<string>>(new Set());
  // Read again when the chat catches up: an imported history reports no event.
  const caughtUp = catchUp === "done";
  const load = useCallback(() => {
    if (call === undefined) return;
    call("conversations").then(
      (rows) => {
        setList({ rows, caughtUp });
        setFailed(false);
      },
      () => setFailed(true),
    );
  }, [call, caughtUp]);
  useEffect(load, [load]);
  useEffect(
    () =>
      subscribe((events) => {
        if (events.some((e) => e.kind !== "typing")) load();
        if (!events.some((e) => e.kind === "typing")) return;
        setTyping((was) => {
          const next = new Set(was);
          for (const e of events) {
            if (e.kind !== "typing") continue;
            if (e.active) next.add(e.conversation);
            else next.delete(e.conversation);
          }
          return next;
        });
      }),
    [subscribe, load],
  );

  // The stamps are read against the moment the list was drawn.
  const now = Date.now();
  const Heading = level === 1 ? "h1" : "h2";
  const notice = listNotice(list, failed, catchUp);
  return (
    <>
      <Heading className="font-headline text-3xl">{strings.tab_conversations}</Heading>
      {notice?.status === true && <Status>{notice.text}</Status>}
      {notice?.status === false && <p className="mt-4 text-muted-fg">{notice.text}</p>}
      <ul className="-mx-4 mt-4 divide-y divide-border border-y border-border expanded:mx-0 expanded:overflow-hidden expanded:rounded-md expanded:border">
        {list?.rows.map((c) => (
          <li key={c.id}>
            <ConversationRow conversation={c} typing={typing.has(c.id)} now={now} />
          </li>
        ))}
      </ul>
    </>
  );
}
