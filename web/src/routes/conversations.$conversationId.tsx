import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState, type SubmitEvent } from "react";
import { useChat } from "../chat/chat.tsx";
import { conversationTitle, isCard, isGroup, itemLine } from "../chat/people.ts";
import { strings } from "../generated/brand/strings.ts";
import type { Conversation, Item } from "../generated/core.d.ts";
import { Button, Status } from "../ui/kit.tsx";

const PAGE = 50;

// One conversation: the newest items of its timeline, older ones on request,
// and a composer, under the conversation's title. The thread reloads its newest page when the core reports a
// change in this conversation. An item still being sent has no seq yet; the
// newest page ends with those.
export const Route = createFileRoute("/conversations/$conversationId")({ component: Thread });

function Thread() {
  const { conversationId } = Route.useParams();
  const { call, subscribe, sync } = useChat();
  const [items, setItems] = useState<Item[]>([]);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [more, setMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  // Replaces the newest page and keeps any older ones already loaded.
  const reload = useCallback(() => {
    if (call === undefined) return;
    call("timeline", conversationId, null, PAGE).then(
      (page) => {
        setFailed(false);
        setItems((have) => {
          const oldest = firstSeq(page) ?? Infinity;
          return [...have.filter((m) => m.seq !== null && m.seq < oldest), ...page];
        });
        setMore((was) => was || page.length === PAGE);
      },
      () => setFailed(true),
    );
    // The title, and whether it is a group, which the cards' wording follows.
    call("conversations").then(
      (all) => setConversation(all.find((c) => c.id === conversationId) ?? null),
      () => setFailed(true),
    );
  }, [call, conversationId]);
  useEffect(() => {
    setItems([]);
    setConversation(null);
    setMore(false);
    reload();
  }, [reload]);
  useEffect(
    () =>
      subscribe((events) => {
        const here = events.some((e) => "conversation" in e && e.conversation === conversationId);
        if (here) reload();
      }),
    [subscribe, reload, conversationId],
  );
  const last = items.at(-1);
  const newest = last === undefined ? undefined : itemKey(last, items.length - 1);
  // A block body: Chromium's scroll methods now return a promise, which React
  // would take for the effect's cleanup.
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [newest]);

  async function older() {
    const before = firstSeq(items);
    if (call === undefined || before === undefined) return;
    try {
      const page = await call("timeline", conversationId, before, PAGE);
      setItems((have) => [...page, ...have]);
      setMore(page.length === PAGE);
    } catch {
      setFailed(true);
    }
  }

  async function send(event: SubmitEvent) {
    event.preventDefault();
    const body = text.trim();
    if (call === undefined || body === "" || sending) return;
    setSending(true);
    try {
      await call("send", conversationId, body);
      setText("");
      // Queued: it shows as being sent now, and goes out with the sync.
      reload();
      sync();
    } catch {
      setFailed(true);
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <Link to="/conversations" className="inline-flex min-h-11 items-center underline">
        {strings.back}
      </Link>
      {conversation !== null && (
        <h1 className="mt-2 truncate font-headline text-2xl">{conversationTitle(conversation)}</h1>
      )}
      {more && (
        <Button className="mt-2 w-full" onClick={() => void older()}>
          {strings.history_load_older}
        </Button>
      )}
      <ol className="mt-4 flex flex-col gap-2">
        {items.map((m, i) => {
          const group = conversation !== null && isGroup(conversation);
          const line = itemLine(m, group);
          // A card says what happened to the conversation, between the bubbles.
          if (isCard(m)) {
            return (
              <li
                key={itemKey(m, i)}
                className="self-center px-3 text-center text-sm text-muted-fg"
              >
                {line}
              </li>
            );
          }
          return (
            <li
              key={itemKey(m, i)}
              className={`max-w-[85%] whitespace-pre-wrap break-words rounded-md px-3 py-2 ${
                m.own ? "self-end bg-primary text-primary-fg" : "self-start bg-muted"
              }`}
            >
              {line}
            </li>
          );
        })}
      </ol>
      <div ref={bottom} />
      <Status>{failed && strings.message_failed}</Status>
      <form onSubmit={(e) => void send(e)} className="mt-4 flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={strings.composer_placeholder}
          aria-label={strings.composer_placeholder}
          className="min-h-11 min-w-0 flex-1 rounded-md border border-border-strong bg-surface px-3"
        />
        <Button tone="primary" type="submit" disabled={sending || text.trim() === ""}>
          {strings.send}
        </Button>
      </form>
    </>
  );
}

/** The seq of the oldest item that has one: where the next older page ends. */
function firstSeq(items: Item[]): number | undefined {
  return items.find((m) => m.seq !== null)?.seq ?? undefined;
}

/** A stable key: the seq once stored, else the envelope id, else the place. */
function itemKey(item: Item, index: number): string {
  return item.seq !== null ? `s${item.seq}` : (item.envelopeId ?? `i${index}`);
}
