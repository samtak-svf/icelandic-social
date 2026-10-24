// Which tab runs the chat (decision 0064). The store is one OPFS pool, and
// only one worker may hold it open, so one tab at a time owns it through a
// Web Lock. Another tab shows that the chat is open elsewhere, waits its turn,
// and can take it over at once: the lock is stolen, the old tab's worker is ended, and the new
// tab's worker opens the store once the old one's file handles are gone.

import { type ChatCall, ChatFailure, chatClient, type Port } from "./protocol.ts";
import type { Start } from "./protocol.ts";

/** The lock every tab of this origin asks for. */
const CHAT_LOCK = "spjall-chat-store";

/** The chat worker as the page holds it. */
export interface ChatWorker extends Port {
  terminate(): void;
}

export interface OwnerDeps {
  locks: Pick<LockManager, "request">;
  spawn(): ChatWorker;
}

/** This tab runs the chat. */
export interface Owned {
  call: ChatCall;
  /** Settles when another tab takes the chat over; the worker is already ended. */
  taken: Promise<void>;
  /** Ends the worker and gives the lock up. */
  release(): void;
}

export interface OwnOptions {
  /** Take the chat from the tab that holds it (the "use here" button). */
  steal?: boolean;
  /** Called when another tab holds the chat and this one waits for it. */
  onWaiting?: () => void;
  /** Gives up the wait. */
  signal?: AbortSignal;
}

/**
 * Takes the chat for this tab. When another tab holds it, `onWaiting` is
 * called and this tab queues for the lock, so it takes the chat as soon as
 * the holder lets go: when that tab closes, and when the holder is this
 * same page a moment earlier (a remount, or the document a navigation
 * replaced). With `steal` the chat is taken at once.
 */
export function ownChat(deps: OwnerDeps, options: OwnOptions = {}): Promise<Owned> {
  return new Promise((resolve, reject) => {
    let worker: ChatWorker | undefined;
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let onTaken!: () => void;
    const taken = new Promise<void>((r) => (onTaken = r));
    const hold = async (lock: Lock | null) => {
      if (lock === null) return false;
      worker = deps.spawn();
      resolve({ call: chatClient(worker), taken, release });
      await held;
      return true;
    };
    const settle = (request: Promise<boolean>, unavailable?: () => void) =>
      void request.then(
        (granted) => (granted ? worker?.terminate() : unavailable?.()),
        (error: unknown) => {
          // A stolen lock rejects the request that held it; an aborted wait
          // rejects one that never did.
          if (worker === undefined) return reject(error);
          worker.terminate();
          onTaken();
        },
      );
    if (options.steal) settle(deps.locks.request(CHAT_LOCK, { steal: true }, hold));
    else
      settle(deps.locks.request(CHAT_LOCK, { ifAvailable: true }, hold), () => {
        options.onWaiting?.();
        settle(deps.locks.request(CHAT_LOCK, { signal: options.signal }, hold));
      });
  });
}

/** How long a tab that took the chat over waits for the store, in total. */
const OPEN_DELAYS = [100, 200, 400, 800, 1600];

/**
 * Starts the worker's store. A store the previous tab's worker held may not
 * open at once, so `storage` is retried; the host never takes it for a lost
 * one (host.ts).
 */
export async function startChat(
  call: ChatCall,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<Start> {
  for (const delay of OPEN_DELAYS) {
    try {
      return await call("start");
    } catch (error) {
      if (!(error instanceof ChatFailure) || error.code !== "storage") throw error;
      await wait(delay);
    }
  }
  return call("start");
}
