// The page's end of the WebSocket (decision 0081). The worker cannot hold a
// socket and run the core's blocking calls at once, so the page holds it:
// each frame from the server goes to the worker, and the frames the core
// answers with (acks, pongs) go back on the socket. A socket that opens again
// syncs first, so nothing that arrived while it was closed is missed. The page
// asks for a sync after it queues a send: the core sends only when it syncs.
// The server ends what it owed an opened socket with a `caught-up` frame
// (decision 0108); once the worker has handled it, every frame before it has
// been handled too, since the worker answers in order.

import type { CoreEvent, Outcome } from "../generated/core.d.ts";
import { CLIENT } from "../api/call.ts";
import type { CaughtUpFrame } from "../generated/api.ts";
import { type ChatCall, ChatFailure } from "./protocol.ts";

/** The part of a `WebSocket` the page uses. */
export interface SocketLike {
  send(data: string): void;
  close(): void;
  addEventListener(type: "open", listener: () => void): void;
  addEventListener(type: "close", listener: (event: { code: number }) => void): void;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
}

export interface SocketDeps {
  call: ChatCall;
  connect(url: string): SocketLike;
  /** What the core reported, in order. */
  onEvents(events: CoreEvent[]): void;
  /** A call failed for good: the device is lost or the core failed (`ChatFailure`). */
  onFailure(failure: ChatFailure): void;
  /** The core has handled everything the server owed this socket when it opened (0108). */
  onCaughtUp?(): void;
  wait?: (ms: number) => Promise<void>;
}

/** `/v1/ws` on this host, naming the build in the query (backend `namedClient`). */
export function socketUrl(location: Pick<Location, "protocol" | "host">): string {
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${location.host}/v1/ws?client=${encodeURIComponent(CLIENT)}`;
}

/**
 * The close code the server ends a revoked device's socket with (backend
 * `REVOKED` in `modules/messaging/do/inbox.ts`; decision 0019). The token is
 * dead, so the session is over without waiting for a later call to fail.
 */
const REVOKED = 4401;

/** Waits before opening again, doubling up to half a minute. */
const BACKOFF = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];

const CAUGHT_UP: CaughtUpFrame["type"] = "caught-up";

/** Whether `text` is the server's `caught-up` frame. */
export function isCaughtUp(text: string): boolean {
  try {
    const frame: unknown = JSON.parse(text);
    return (
      typeof frame === "object" && frame !== null && "type" in frame && frame.type === CAUGHT_UP
    );
  } catch {
    return false;
  }
}

/** Failures after which the socket stays closed. */
const FINAL = new Set(["device-lost", "closed", "client-too-old", "outdated"]);

export interface ChatSocket {
  /** Syncs now: what the core has queued goes out, and its answer goes on the socket. */
  sync(): void;
  close(): void;
}

export function chatSocket(url: string, deps: SocketDeps): ChatSocket {
  const wait = deps.wait ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  let socket: SocketLike | undefined;
  /** The socket once it is open; a socket still connecting throws on `send`. */
  let live: SocketLike | undefined;
  let stopped = false;
  let attempt = 0;

  function apply(outcome: Outcome) {
    if (outcome.events.length > 0) deps.onEvents(outcome.events);
    for (const frame of outcome.frames) live?.send(frame);
  }

  function run(work: Promise<Outcome>): Promise<void> {
    return work.then(apply, (error: unknown) => {
      if (!(error instanceof ChatFailure) || !FINAL.has(error.code)) return;
      stop();
      deps.onFailure(error);
    });
  }

  function open() {
    if (stopped) return;
    const current = deps.connect(url);
    socket = current;
    current.addEventListener("open", () => {
      attempt = 0;
      live = current;
      void run(deps.call("sync"));
    });
    current.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      const handled = run(deps.call("frame", event.data));
      // Older cores ignore the frame; it still waits its turn behind the backlog.
      if (isCaughtUp(event.data)) {
        void handled.then(() => {
          if (!stopped && socket === current) deps.onCaughtUp?.();
        });
      }
    });
    current.addEventListener("close", (event) => {
      if (live === current) live = undefined;
      if (stopped || socket !== current) return;
      if (event.code === REVOKED) {
        stop();
        deps.onFailure(new ChatFailure({ code: "device-lost", message: "the device was revoked" }));
        return;
      }
      const delay = BACKOFF[Math.min(attempt++, BACKOFF.length - 1)]!;
      void wait(delay).then(open);
    });
  }

  function stop() {
    stopped = true;
    socket?.close();
    socket = undefined;
    live = undefined;
  }

  open();
  return {
    sync() {
      if (!stopped) void run(deps.call("sync"));
    },
    close: stop,
  };
}
