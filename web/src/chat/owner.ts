// Which tab runs the chat (decision 0064). The store is one OPFS pool, and
// only one worker may hold it open, so one tab at a time owns it through a
// Web Lock. Another tab shows that the chat is open elsewhere and can take it
// over: the lock is stolen, the old tab's worker is ended, and the new
// tab's worker opens the store once the old one's file handles are gone.

import { type ChatCall, ChatFailure, chatClient, type Port } from "./protocol.ts";
import type { Start } from "./protocol.ts";

/** The lock every tab of this origin asks for. */
export const CHAT_LOCK = "spjall-chat-store";

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

/**
 * Takes the chat for this tab: when no other tab holds it, or from the one
 * that does when `steal` is set (the "use here" button). Answers
 * "elsewhere" when another tab holds it and `steal` is not set.
 */
export function ownChat(deps: OwnerDeps, steal = false): Promise<Owned | "elsewhere"> {
  return new Promise((resolve, reject) => {
    let worker: ChatWorker | undefined;
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let onTaken!: () => void;
    const taken = new Promise<void>((r) => (onTaken = r));
    const options: LockOptions = steal ? { steal: true } : { ifAvailable: true };
    deps.locks
      .request(CHAT_LOCK, options, async (lock) => {
        if (lock === null) return resolve("elsewhere");
        worker = deps.spawn();
        resolve({ call: chatClient(worker), taken, release });
        await held;
      })
      .then(
        () => worker?.terminate(),
        (error: unknown) => {
          // A stolen lock rejects the request that held it.
          if (worker === undefined) return reject(error);
          worker.terminate();
          onTaken();
        },
      );
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
