// The page's chat session (decisions 0064, 0081): which tab owns the chat,
// where this browser's chat stands, and the socket that feeds the core. It is
// a plain object so the state transitions are tested without React; the
// provider in chat.tsx only holds it.
//
// A ready chat is not yet a caught-up one (decision 0109): a newly linked
// browser still waits on the phone's history and on the conversations the
// server owed its socket. `CatchUp` says which, so the list never shows
// "no conversations" for a chat that is still arriving.

import type { CoreEvent } from "../generated/core.d.ts";
import { type ChatCall, ChatFailure, type Start } from "./protocol.ts";
import type { Owned, OwnOptions } from "./owner.ts";
import { type ChatSocket, chatSocket } from "./socket.ts";

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

/** What a ready chat still waits on, in the order the page shows it. */
export type CatchUp =
  /** The history the approving phone sends (0064, 0074) has not been received. */
  | "history"
  /** The core has not yet handled what the server owed the socket when it opened. */
  | "backlog"
  /** Both have arrived: what the store shows is all there is. */
  | "done";

/**
 * Waits between asks for the phone's history: it is still uploading until it
 * completes (`not_found`), or the network is away. About ten minutes in all.
 */
const HISTORY_WAITS = [2_000, 4_000, 8_000, 16_000, ...Array<number>(20).fill(30_000)];

/** Whether a failed ask for the history may be asked again. */
export function historyMayCome(error: unknown): boolean {
  if (!(error instanceof ChatFailure)) return false;
  if (error.code === "unreachable") return true;
  return error.code === "refused" && error.message === "not_found";
}

export interface SessionDeps {
  own(options: OwnOptions): Promise<Owned>;
  start(call: ChatCall): Promise<Start>;
  socket: typeof chatSocket;
  socketUrl(): string;
  connect(url: string): ReturnType<Parameters<typeof chatSocket>[1]["connect"]>;
  wait?: (ms: number) => Promise<void>;
}

export interface ChatSession {
  /** The worker's calls, once this tab owns the chat. */
  call(): ChatCall | undefined;
  /** Takes the chat from the tab that holds it. */
  useHere(): void;
  /** Asks the worker where it stands again, after a link completed. */
  restart(): void;
  /** Sends what the core has queued; nothing until the chat is ready. */
  sync(): void;
  /** Ends the worker, the socket and the lock. */
  close(): void;
}

export function chatSession(
  deps: SessionDeps,
  onState: (state: ChatState) => void,
  onEvents: (events: CoreEvent[]) => void,
  onCatchUp: (catchUp: CatchUp) => void = () => {},
): ChatSession {
  const pause = deps.wait ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  let owned: Owned | undefined;
  let socket: ChatSocket | undefined;
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

  /** Bumped by each start of the socket, so a late catch-up from an older one is dropped. */
  let started = 0;

  async function run(mine: number, taken: Owned) {
    const answer = await deps.start(taken.call);
    if (mine !== round || owned !== taken) return;
    if (answer.state !== "ready") return emit(mine, answer.state);
    const thisStart = ++started;
    const current = () => !closed && mine === round && owned === taken && thisStart === started;
    let history = false;
    let backlog = false;
    const report = () => {
      if (current()) onCatchUp(!history ? "history" : !backlog ? "backlog" : "done");
    };
    report();
    // Asked before the socket opens, so the worker takes it first. It answers
    // 0 at once when no history is owed (a reload, a browser linked long ago).
    void receiveHistory(taken.call, current).then(() => {
      history = true;
      report();
    });
    socket?.close();
    socket = deps.socket(deps.socketUrl(), {
      call: taken.call,
      connect: (url) => deps.connect(url),
      onEvents,
      onFailure: (failure: ChatFailure) =>
        emit(mine, failure.code === "device-lost" ? "lost" : "failed"),
      onCaughtUp: () => {
        backlog = true;
        report();
      },
    });
    emit(mine, "ready");
  }

  /**
   * Takes the phone's history, asking again while it may still come: the
   * phone uploads it after approving the link, and the browser may ask first.
   * The link holds whether or not it arrives.
   */
  async function receiveHistory(call: ChatCall, current: () => boolean): Promise<void> {
    for (let attempt = 0; current(); attempt++) {
      try {
        await call("receiveHistory");
        return;
      } catch (error) {
        const next = HISTORY_WAITS[attempt];
        if (next === undefined || !historyMayCome(error)) return;
        await pause(next);
      }
    }
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
    sync: () => socket?.sync(),
    close() {
      closed = true;
      drop();
    },
  };
}
