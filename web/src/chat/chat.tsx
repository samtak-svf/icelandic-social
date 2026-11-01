import {
  createContext,
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CoreEvent } from "../generated/core.d.ts";
import { type Listed, useListed } from "./listed.ts";
import { type ChatCall } from "./protocol.ts";
import { ownChat, showChat, startChat } from "./owner.ts";
import { loadSealed } from "./store-key.ts";
import {
  type CatchUp,
  type ChatSession,
  type ChatState,
  chatSession,
  type SessionDeps,
} from "./session.ts";
import { chatSocket, socketUrl } from "./socket.ts";
import { browserUnreadChannel, type UnreadChannel, type UnreadRow, unreadRows } from "./unread.ts";

// The chat of this browser (decisions 0064, 0081, 0124), around every signed-in
// page, so the count of what is unread comes from the store it lives in and
// the server learns nothing new. A browser with no chat linked starts nothing
// until the chat's pages are open, so it loads no core. A tab that only counts
// gives the store up to one showing the chat's pages (`foreground`), and tabs
// without the store read the count from the one that has it. Nothing here runs
// while rendering on the server; the session starts in an effect.

interface ChatValue {
  state: ChatState;
  /** What a ready chat still waits on before its store shows everything (0108). */
  catchUp: CatchUp;
  /** The worker's calls; defined once this tab owns the chat. */
  call: ChatCall | undefined;
  /** Takes the chat over from the tab that holds it. */
  useHere: () => void;
  /** Asks the worker again where it stands, after a link completed. */
  restart: () => void;
  /** Sends what the core has queued, as after a send. */
  sync: () => void;
  /** The conversations, read in this tab when it runs the chat. */
  listed: Listed | null;
  listFailed: boolean;
  /** Reads the conversations again, as after marking one read. */
  reloadConversations: () => void;
  /** What is unread and not muted, without any message; from any tab of this browser. */
  unread: readonly UnreadRow[];
  /** Calls `listener` with each batch of events the core reports; returns the way to stop. */
  subscribe: (listener: (events: CoreEvent[]) => void) => () => void;
}

const ChatContext = createContext<ChatValue | null>(null);

/** What the provider asks of the browser. */
export interface ChatDeps extends SessionDeps {
  /** Whether a chat is linked in this browser. */
  linked(): Promise<boolean>;
  unreadChannel(): UnreadChannel;
}

function browserDeps(): ChatDeps {
  return {
    linked: async () => (await loadSealed()) !== undefined,
    unreadChannel: browserUnreadChannel,
    show: (options) => showChat(navigator.locks, options),
    own: (options) =>
      ownChat(
        {
          locks: navigator.locks,
          spawn: () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
        },
        options,
      ),
    start: startChat,
    socket: chatSocket,
    socketUrl: () => socketUrl(location),
    connect: (url) => new WebSocket(url),
  };
}

/**
 * `deps` is for tests; the page passes none. `active` is whether someone is
 * signed in, `foreground` whether this tab shows the chat's pages.
 */
export function ChatProvider({
  deps,
  active = true,
  foreground = true,
  onSignedOut,
  children,
}: Readonly<{
  deps?: ChatDeps;
  active?: boolean;
  foreground?: boolean;
  onSignedOut?: () => void;
  children: ReactNode;
}>) {
  const chatDeps = useMemo(() => deps ?? browserDeps(), [deps]);
  const [linked, setLinked] = useState(false);
  const wanted = active && (foreground || linked);
  const [state, setState] = useState<ChatState>("starting");
  const [catchUp, setCatchUp] = useState<CatchUp>("history");
  const session = useRef<ChatSession | null>(null);
  const listeners = useRef(new Set<(events: CoreEvent[]) => void>());
  useEffect(() => {
    if (!active) {
      setLinked(false);
      return undefined;
    }
    let live = true;
    chatDeps.linked().then(
      (on) => {
        if (live && on) setLinked(true);
      },
      // A browser that keeps nothing here has nothing to count.
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [active, chatDeps]);
  useEffect(() => {
    if (!wanted) return undefined;
    const own = chatSession(
      chatDeps,
      setState,
      (events) => {
        for (const listener of listeners.current) listener(events);
      },
      setCatchUp,
    );
    session.current = own;
    return () => {
      own.close();
      session.current = null;
      setState("starting");
      setCatchUp("history");
    };
  }, [wanted, chatDeps]);
  useEffect(() => {
    session.current?.foreground(wanted && foreground);
  }, [wanted, foreground]);
  useEffect(() => {
    // A link completed here: the chat stays when the reader leaves its pages.
    if (state === "ready") setLinked(true);
    if (state === "signed-out") onSignedOut?.();
  }, [state, onSignedOut]);
  const useHere = useCallback(() => session.current?.useHere(), []);
  const restart = useCallback(() => session.current?.restart(), []);
  const sync = useCallback(() => session.current?.sync(), []);
  const subscribe = useCallback((listener: (events: CoreEvent[]) => void) => {
    listeners.current.add(listener);
    return () => void listeners.current.delete(listener);
  }, []);
  const call = state === "starting" ? undefined : session.current?.call();
  const ready = state === "ready";
  const { listed, failed, reload } = useListed(ready ? call : undefined, subscribe, catchUp);
  const own = useMemo(() => {
    if (ready) return listed === null ? null : unreadRows(listed.rows);
    // This tab holds a store with nothing to count: the others must not keep showing it.
    return state === "lost" || state === "unlinked" ? [] : null;
  }, [ready, state, listed]);
  const channel = useRef<UnreadChannel | null>(null);
  const answer = useRef(own);
  const [others, setOthers] = useState<readonly UnreadRow[]>([]);
  useEffect(() => {
    if (!active) {
      setOthers([]);
      return undefined;
    }
    const opened = chatDeps.unreadChannel();
    channel.current = opened;
    opened.listen((message) => {
      if (message.kind === "rows") setOthers(message.rows);
      else if (answer.current !== null) opened.post({ kind: "rows", rows: answer.current });
    });
    opened.post({ kind: "ask" });
    return () => {
      opened.close();
      channel.current = null;
    };
  }, [active, chatDeps]);
  useEffect(() => {
    answer.current = own;
    if (own !== null) channel.current?.post({ kind: "rows", rows: own });
  }, [own]);
  const unread = active ? (ready ? (own ?? []) : others) : [];
  const value = useMemo(
    () => ({
      state,
      catchUp,
      call,
      useHere,
      restart,
      sync,
      subscribe,
      listed,
      listFailed: failed,
      reloadConversations: reload,
      unread,
    }),
    [state, catchUp, call, useHere, restart, sync, subscribe, listed, failed, reload, unread],
  );
  return <ChatContext value={value}>{children}</ChatContext>;
}

export function useChat(): ChatValue {
  const value = use(ChatContext);
  if (!value) throw new Error("useChat outside ChatProvider");
  return value;
}
