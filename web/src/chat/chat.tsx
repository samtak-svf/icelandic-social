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
import { type ChatCall } from "./protocol.ts";
import { ownChat, startChat } from "./owner.ts";
import { type ChatSession, type ChatState, chatSession, type SessionDeps } from "./session.ts";
import { chatSocket, socketUrl } from "./socket.ts";

// The chat for the pages under /conversations (decisions 0064, 0081). It is
// mounted around those routes only: a provider higher up would make every tab
// of the app compete for the one store lock. Nothing here runs while
// rendering on the server; the session starts in an effect.

interface ChatValue {
  state: ChatState;
  /** The worker's calls; defined once this tab owns the chat. */
  call: ChatCall | undefined;
  /** Takes the chat over from the tab that holds it. */
  useHere: () => void;
  /** Asks the worker again where it stands, after a link completed. */
  restart: () => void;
  /** Calls `listener` with each batch of events the core reports; returns the way to stop. */
  subscribe: (listener: (events: CoreEvent[]) => void) => () => void;
}

const ChatContext = createContext<ChatValue | null>(null);

function browserDeps(): SessionDeps {
  return {
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

/** `deps` is for tests; the page passes none. */
export function ChatProvider({
  deps,
  children,
}: Readonly<{ deps?: SessionDeps; children: ReactNode }>) {
  const [state, setState] = useState<ChatState>("starting");
  const session = useRef<ChatSession | null>(null);
  const listeners = useRef(new Set<(events: CoreEvent[]) => void>());
  useEffect(() => {
    const own = chatSession(deps ?? browserDeps(), setState, (events) => {
      for (const listener of listeners.current) listener(events);
    });
    session.current = own;
    return () => {
      own.close();
      session.current = null;
    };
  }, [deps]);
  const useHere = useCallback(() => session.current?.useHere(), []);
  const restart = useCallback(() => session.current?.restart(), []);
  const subscribe = useCallback((listener: (events: CoreEvent[]) => void) => {
    listeners.current.add(listener);
    return () => void listeners.current.delete(listener);
  }, []);
  const call = state === "starting" ? undefined : session.current?.call();
  const value = useMemo(
    () => ({ state, call, useHere, restart, subscribe }),
    [state, call, useHere, restart, subscribe],
  );
  return <ChatContext value={value}>{children}</ChatContext>;
}

export function useChat(): ChatValue {
  const value = use(ChatContext);
  if (!value) throw new Error("useChat outside ChatProvider");
  return value;
}
