import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useChat } from "../chat/chat.tsx";
import { ConversationRow } from "../chat/conversation-row.tsx";
import { strings } from "../generated/brand/strings.ts";
import type { Conversation } from "../generated/core.d.ts";
import { Status } from "../ui/kit.tsx";

// The conversations of this browser's store, as the core lists them, reloaded
// when it reports a change; who is typing comes from the same events.
export const Route = createFileRoute("/conversations/")({ component: List });

function List() {
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
  return (
    <>
      <h1 className="font-headline text-3xl">{strings.tab_conversations}</h1>
      {list === null && !failed && <Status>{strings.loading}</Status>}
      {failed && <Status>{strings.try_again}</Status>}
      {list?.length === 0 && <p className="mt-4 text-muted-fg">{strings.conversations_empty}</p>}
      <ul className="-mx-4 mt-4 divide-y divide-border border-y border-border">
        {list?.map((c) => (
          <li key={c.id}>
            <ConversationRow conversation={c} typing={typing.has(c.id)} now={now} />
          </li>
        ))}
      </ul>
    </>
  );
}
