import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type SubmitEvent } from "react";
import { useChat } from "../chat/chat.tsx";
import { ConversationAvatar } from "../chat/conversation-avatar.tsx";
import {
  canSend,
  conversationBanner,
  conversationTitle,
  isCard,
  isGroup,
  itemLine,
} from "../chat/people.ts";
import { strings } from "../generated/brand/strings.ts";
import type { Conversation, Item } from "../generated/core.d.ts";
import { Button, Status } from "../ui/kit.tsx";
import { LAYOUTS } from "../ui/layout.ts";
import { useSizeClass } from "../ui/size-class.ts";

const PAGE = 50;

// One conversation: the newest items of its timeline, older ones on request,
// and a composer, under the conversation's title. The thread reloads its
// newest page when the core reports a change in this conversation. An item
// still being sent has no seq yet; the newest page ends with those. The
// items scroll in their own box between the title and the composer, so the
// page itself stays put; the box's height is the window less the shell's
// chrome (the name and tab bar on compact, the main padding from medium).
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
  // Whether the newest page has come: before it, an empty thread is not news.
  const [loaded, setLoaded] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  // The height under the older items as they were asked for, to keep the
  // reader's place when they are put above.
  const above = useRef<number | null>(null);

  // Replaces the newest page and keeps any older ones already loaded.
  const reload = useCallback(() => {
    if (call === undefined) return;
    call("timeline", conversationId, null, PAGE).then(
      (page) => {
        setFailed(false);
        setLoaded(true);
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
    setLoaded(false);
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
  useLayoutEffect(() => {
    const box = scroller.current;
    if (box !== null) box.scrollTop = box.scrollHeight;
  }, [newest]);
  const first = items[0];
  const oldest = first === undefined ? undefined : itemKey(first, 0);
  useLayoutEffect(() => {
    const box = scroller.current;
    if (box === null || above.current === null) return;
    box.scrollTop = box.scrollHeight - above.current;
    above.current = null;
  }, [oldest]);

  async function older() {
    const before = firstSeq(items);
    if (call === undefined || before === undefined) return;
    try {
      const page = await call("timeline", conversationId, before, PAGE);
      const box = scroller.current;
      if (box !== null) above.current = box.scrollHeight - box.scrollTop;
      setItems((have) => [...page, ...have]);
      setMore(page.length === PAGE);
    } catch {
      setFailed(true);
    }
  }

  async function send(event: SubmitEvent) {
    event.preventDefault();
    const body = text.trim();
    if (call === undefined || body === "" || sending || !writable) return;
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

  const group = conversation !== null && isGroup(conversation);
  const banner = conversation === null ? null : conversationBanner(conversation);
  const writable = conversation !== null && canSend(conversation);
  // Beside the list (0093) there is nothing to go back to.
  const beside = LAYOUTS[useSizeClass()].conversations === "list-and-thread";
  return (
    <div className="flex h-[calc(100dvh-10rem)] flex-col medium:h-[calc(100dvh-3rem)]">
      {!beside && (
        <Link
          to="/conversations"
          className="inline-flex min-h-11 items-center self-start underline"
        >
          {strings.back}
        </Link>
      )}
      <ThreadHeader conversation={conversation} group={group} />
      {banner !== null && (
        <p role="status" className="mt-2 rounded-md bg-secondary-subtle px-3 py-3 text-sm">
          {banner}
        </p>
      )}
      <div ref={scroller} className="mt-4 min-h-0 flex-1 overflow-y-auto">
        {more && (
          <Button className="mb-2 w-full" onClick={() => void older()}>
            {strings.history_load_older}
          </Button>
        )}
        {loaded && items.length === 0 && (
          <p className="px-3 py-8 text-center text-sm text-muted-fg">
            {strings.history_device_local_notice}
          </p>
        )}
        <ol className="flex flex-col gap-2">
          {items.map((m, i) => {
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
      </div>
      <Status>{failed && strings.message_failed}</Status>
      <form onSubmit={(e) => void send(e)} className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={strings.composer_placeholder}
          aria-label={strings.composer_placeholder}
          disabled={!writable}
          className="min-h-11 min-w-0 flex-1 rounded-md border border-border-strong bg-surface px-3 disabled:opacity-60"
        />
        <Button tone="primary" type="submit" disabled={!writable || sending || text.trim() === ""}>
          {strings.send}
        </Button>
      </form>
    </div>
  );
}

/** The picture and title, held in place while they load; a group's open its info (0094). */
function ThreadHeader({
  conversation,
  group,
}: Readonly<{ conversation: Conversation | null; group: boolean }>) {
  // The title's line is held while it loads, so nothing below it moves.
  const shown = conversation !== null && (
    <>
      <ConversationAvatar conversation={conversation} className="size-10 rounded-full" />
      <h1 className="min-w-0 truncate font-headline text-2xl">{conversationTitle(conversation)}</h1>
    </>
  );
  return (
    <div className="mt-2 flex min-h-11 items-center gap-3">
      {conversation !== null && group ? (
        <Link
          to="/conversations/$conversationId/info"
          params={{ conversationId: conversation.id }}
          aria-label={strings.conversation_info}
          className="flex min-w-0 items-center gap-3"
        >
          {shown}
        </Link>
      ) : (
        shown
      )}
    </div>
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
