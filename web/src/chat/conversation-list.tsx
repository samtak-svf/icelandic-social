import { useCallback, useEffect, useState } from "react";
import { strings } from "../generated/brand/strings.ts";
import type { Conversation } from "../generated/core.d.ts";
import { Status } from "../ui/kit.tsx";
import { useChat } from "./chat.tsx";
import { ConversationRow } from "./conversation-row.tsx";

/**
 * The conversations of this browser's store, as the core lists them, reloaded
 * when it reports a change; who is typing comes from the same events. The
 * heading is the page's own unless a conversation is open beside it.
 */
export function ConversationList({ level }: Readonly<{ level: 1 | 2 }>) {
  const { call, subscribe } = useChat();
  const [list, setList] = useState<Conversation[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [typing, setTyping] = useState<ReadonlySet<string>>(new Set());
  const load = useCallback(() => {
    if (call === undefined) return;
    call("conversations").then(
      (rows) => {
        setList(rows);
        setFailed(false);
      },
      () => setFailed(true),
    );
  }, [call]);
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
  return (
    <>
      <Heading className="font-headline text-3xl">{strings.tab_conversations}</Heading>
      {list === null && !failed && <Status>{strings.loading}</Status>}
      {failed && <Status>{strings.try_again}</Status>}
      {list?.length === 0 && <p className="mt-4 text-muted-fg">{strings.conversations_empty}</p>}
      <ul className="-mx-4 mt-4 divide-y divide-border border-y border-border expanded:mx-0 expanded:overflow-hidden expanded:rounded-md expanded:border">
        {list?.map((c) => (
          <li key={c.id}>
            <ConversationRow conversation={c} typing={typing.has(c.id)} now={now} />
          </li>
        ))}
      </ul>
    </>
  );
}
