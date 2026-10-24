// The page's chat session (decisions 0064, 0081): which tab owns the chat,
// where this browser's chat stands, and the socket that feeds the core. It is
// a plain object so the state transitions are tested without React; the
// provider in chat.tsx only holds it.

import type { CoreEvent } from "../generated/core.d.ts";
import { type ChatCall, ChatFailure, type Start } from "./protocol.ts";
import type { Owned, OwnOptions } from "./owner.ts";
import { chatSocket } from "./socket.ts";

/** Where the chat stands in this tab. */
export type ChatState =
  /** Taking the chat or starting the worker. */
  | "starting"
  /** Another tab runs the chat; this one waits its turn. */
  | "elsewhere"
  /** Linked and running. */
  | "ready"
  /** Nothing is linked here. */
  | "unlinked"
  /** The device was revoked and its files deleted. */
  | "lost"
  /** The session is gone; the store is kept. */
  | "signed-out"
  /** The worker failed for a reason that is not one of the above. */
  | "failed";

export interface SessionDeps {
  own(options: OwnOptions): Promise<Owned>;
  start(call: ChatCall): Promise<Start>;
  socket: typeof chatSocket;
  socketUrl(): string;
  connect(url: string): ReturnType<Parameters<typeof chatSocket>[1]["connect"]>;
}

export interface ChatSession {
  /** The worker's calls, once this tab owns the chat. */
  call(): ChatCall | undefined;
  /** Takes the chat from the tab that holds it. */
  useHere(): void;
  /** Asks the worker where it stands again, after a link completed. */
  restart(): void;
  /** Ends the worker, the socket and the lock. */
  close(): void;
}

export function chatSession(
  deps: SessionDeps,
  onState: (state: ChatState) => void,
  onEvents: (events: CoreEvent[]) => void,
): ChatSession {
  let owned: Owned | undefined;
  let socket: { close(): void } | undefined;
  /** Ends this round's wait for the lock. */
  let waiting: AbortController | undefined;
  let closed = false;
  /** Bumped by each take-over, so a late answer from an older one is dropped. */
  let round = 0;

  function emit(round_: number, state: ChatState) {
    if (!closed && round_ === round) onState(state);
  }

  function drop() {
    waiting?.abort();
    waiting = undefined;
    socket?.close();
    socket = undefined;
    owned?.release();
    owned = undefined;
  }

  async function begin(steal: boolean) {
    const mine = ++round;
    drop();
    emit(mine, "starting");
    const wait = new AbortController();
    waiting = wait;
    try {
      const taken = await deps.own({
        steal,
        signal: wait.signal,
        onWaiting: () => emit(mine, "elsewhere"),
      });
      if (closed || mine !== round) {
        taken.release();
        return;
      }
      owned = taken;
      // Another tab took the chat: wait for it to come back.
      void taken.taken.then(() => {
        if (owned === taken) void begin(false);
      });
      await run(mine, taken);
    } catch {
      if (!wait.signal.aborted) emit(mine, "failed");
    }
  }

  async function run(mine: number, taken: Owned) {
    const started = await deps.start(taken.call);
    if (mine !== round || owned !== taken) return;
    if (started.state !== "ready") return emit(mine, started.state);
    socket = deps.socket(deps.socketUrl(), {
      call: taken.call,
      connect: (url) => deps.connect(url),
      onEvents,
      onFailure: (failure: ChatFailure) =>
        emit(mine, failure.code === "device-lost" ? "lost" : "failed"),
    });
    emit(mine, "ready");
  }

  void begin(false);
  return {
    call: () => owned?.call,
    useHere: () => void begin(true),
    restart() {
      const current = owned;
      if (current === undefined) return;
      const mine = round;
      run(mine, current).catch(() => emit(mine, "failed"));
    },
    close() {
      closed = true;
      drop();
    },
  };
}
