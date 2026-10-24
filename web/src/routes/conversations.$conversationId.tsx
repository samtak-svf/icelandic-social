import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState, type SubmitEvent } from "react";
import { useChat } from "../chat/chat.tsx";
import { messageText } from "../chat/people.ts";
import { strings } from "../generated/brand/strings.ts";
import type { Message } from "../generated/core.d.ts";
import { Button, Status } from "../ui/kit.tsx";

const PAGE = 50;

// One conversation: the newest messages, older ones on request, and a
// composer. The thread reloads its newest page when the core reports a change
// in this conversation.
export const Route = createFileRoute("/conversations/$conversationId")({ component: Thread });

function Thread() {
  const { conversationId } = Route.useParams();
  const { call, subscribe } = useChat();
  const [messages, setMessages] = useState<Message[]>([]);
  const [more, setMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  // Replaces the newest page and keeps any older ones already loaded.
  const reload = useCallback(() => {
    if (call === undefined) return;
    call("history", conversationId, null, PAGE).then(
      (page) => {
        setFailed(false);
        setMessages((have) => {
          const oldest = page[0]?.seq ?? Infinity;
          return [...have.filter((m) => m.seq < oldest), ...page];
        });
        setMore((was) => was || page.length === PAGE);
      },
      () => setFailed(true),
    );
  }, [call, conversationId]);
  useEffect(() => {
    setMessages([]);
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
  const newest = messages.at(-1)?.seq;
  // A block body: Chromium's scroll methods now return a promise, which React
  // would take for the effect's cleanup.
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [newest]);

  async function older() {
    const before = messages[0]?.seq;
    if (call === undefined || before === undefined) return;
    try {
      const page = await call("history", conversationId, before, PAGE);
      setMessages((have) => [...page, ...have]);
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
      reload();
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
      {more && (
        <Button className="mt-2 w-full" onClick={() => void older()}>
          {strings.history_load_older}
        </Button>
      )}
      <ol className="mt-4 flex flex-col gap-2">
        {messages.map((m) => {
          const shown = messageText(m);
          if (shown === null) return null;
          return (
            <li
              key={m.seq}
              className={`max-w-[85%] whitespace-pre-wrap break-words rounded-md px-3 py-2 ${
                m.own ? "self-end bg-primary text-primary-fg" : "self-start bg-muted"
              }`}
            >
              {shown}
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
