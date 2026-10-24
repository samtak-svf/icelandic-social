import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useChat } from "../chat/chat.tsx";
import { conversationTitle, lastLine } from "../chat/people.ts";
import { strings } from "../generated/brand/strings.ts";
import type { Conversation } from "../generated/core.d.ts";
import { Status } from "../ui/kit.tsx";

// The conversations of this browser's store, as the core lists them, reloaded
// when it reports a change.
export const Route = createFileRoute("/conversations/")({ component: List });

function List() {
  const { call, subscribe } = useChat();
  const [list, setList] = useState<Conversation[] | null>(null);
  const [failed, setFailed] = useState(false);
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
      }),
    [subscribe, load],
  );

  return (
    <>
      <h1 className="font-headline text-3xl">{strings.tab_conversations}</h1>
      {list === null && !failed && <Status>{strings.loading}</Status>}
      {failed && <Status>{strings.try_again}</Status>}
      {list?.length === 0 && <p className="mt-4 text-muted-fg">{strings.conversations_empty}</p>}
      <ul className="mt-4 flex flex-col gap-2">
        {list?.map((c) => (
          <li key={c.id}>
            <Link
              to="/conversations/$conversationId"
              params={{ conversationId: c.id }}
              className="flex min-h-11 flex-col gap-1 rounded-md border border-border px-4 py-2"
            >
              <span className="flex items-baseline justify-between gap-2">
                <span className={c.unread > 0 ? "truncate font-semibold" : "truncate"}>
                  {conversationTitle(c)}
                </span>
                {c.unread > 0 && (
                  <span className="shrink-0 text-sm font-semibold">
                    {strings.unread_count({ count: c.unread })}
                  </span>
                )}
              </span>
              <span className="truncate text-sm text-muted-fg">{lastLine(c)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
