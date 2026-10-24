// What the page and the chat worker say to each other (decision 0081). The
// worker is the only caller of the core; the page asks it by name and gets a
// value or a `Failure` back. Every message is structured-cloneable.

import type {
  Conversation,
  DeviceLink,
  Failure,
  LinkQr,
  LinkState,
  Me,
  Message,
  Outcome,
} from "../generated/core.d.ts";

/** Where this browser's chat stands once the worker has started. */
export type Start =
  /** Linked: the store is open. */
  | { state: "ready"; deviceId: string }
  /** Nothing is linked here: show the link page. */
  | { state: "unlinked" }
  /** The store was here and cannot open again, so its device was revoked and its files deleted (0064). */
  | { state: "lost" }
  /** The session is gone; the store is kept for the next sign-in. */
  | { state: "signed-out" };

/** The link code, and the QR matrix drawn from it inside the core. */
export interface LinkOffer extends DeviceLink {
  qr: LinkQr;
}

/** Each operation: what it takes and what it answers. */
export interface Ops {
  start: { args: []; result: Start };
  beginLink: { args: []; result: LinkOffer };
  linkState: { args: []; result: LinkState };
  completeLink: { args: []; result: { deviceId: string; historyExpected: boolean } };
  receiveHistory: { args: []; result: number };
  sync: { args: []; result: Outcome };
  frame: { args: [text: string]; result: Outcome };
  conversations: { args: []; result: Conversation[] };
  history: {
    args: [conversation: string, before: number | null, limit: number];
    result: Message[];
  };
  send: { args: [conversation: string, text: string]; result: string };
  me: { args: []; result: Me };
  wipe: { args: []; result: void };
}

export type Op = keyof Ops;

export interface Request<O extends Op = Op> {
  id: number;
  op: O;
  args: Ops[O]["args"];
}

export type Response =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: Failure };

/** Whatever was thrown, as the page may see it: a `Failure`, never a stack. */
export function asFailure(error: unknown): Failure {
  if (
    typeof error === "object" &&
    error !== null &&
    typeof (error as Failure).code === "string" &&
    typeof (error as Failure).message === "string"
  ) {
    const { code, message } = error as Failure;
    return { code, message };
  }
  if (error instanceof Error && error.name === "StoreKeyLost") {
    return { code: "store-key-lost", message: "the store cannot be opened" };
  }
  return { code: "internal", message: "the chat worker failed" };
}

/** A rejected call from the worker. */
export class ChatFailure extends Error implements Failure {
  readonly code: string;
  constructor(failure: Failure) {
    super(failure.message);
    this.name = "ChatFailure";
    this.code = failure.code;
  }
}

/** The end of a channel: a `Worker` on the page, the worker's own scope inside it. */
export interface Port {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
}

/** The page's typed handle on the worker. Calls run in order, one at a time, as the core does. */
export function chatClient(port: Port) {
  let next = 0;
  const pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: unknown) => void }
  >();
  port.addEventListener("message", (event) => {
    const response = event.data as Response;
    const waiting = pending.get(response.id);
    if (waiting === undefined) return;
    pending.delete(response.id);
    if (response.ok) waiting.resolve(response.value);
    else waiting.reject(new ChatFailure(response.error));
  });
  return function call<O extends Op>(op: O, ...args: Ops[O]["args"]): Promise<Ops[O]["result"]> {
    const id = next++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      port.postMessage({ id, op, args } satisfies Request<O>);
    });
  };
}

export type ChatCall = ReturnType<typeof chatClient>;

/** The handlers a worker serves, one per operation. */
export type Handlers = {
  [O in Op]: (...args: Ops[O]["args"]) => Promise<Ops[O]["result"]> | Ops[O]["result"];
};

/**
 * Answers each request on `port` with its handler. Requests are taken one at a
 * time: the core blocks, and two calls at once would interleave its store.
 */
export function serve(port: Port, handlers: Handlers): void {
  let queue: Promise<void> = Promise.resolve();
  port.addEventListener("message", (event) => {
    const { id, op, args } = event.data as Request;
    queue = queue.then(async () => {
      try {
        const handler = handlers[op] as (...a: unknown[]) => unknown;
        const value = await handler(...(args as unknown[]));
        port.postMessage({ id, ok: true, value } satisfies Response);
      } catch (error) {
        port.postMessage({ id, ok: false, error: asFailure(error) } satisfies Response);
      }
    });
  });
}
