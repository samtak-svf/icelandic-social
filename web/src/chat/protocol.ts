// What the page and the chat worker say to each other (decision 0081). The
// worker is the only caller of the core; the page asks it by name and gets a
// value or a `Failure` back. Every message is structured-cloneable.

import type {
  Conversation,
  DeviceLink,
  Failure,
  Item,
  LinkQr,
  LinkState,
  Me,
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
  timeline: {
    args: [conversation: string, before: number | null, limit: number];
    result: Item[];
  };
  send: { args: [conversation: string, text: string]; result: string };
  /** The JPEG of this device's copy of a group's photo, or null (0094). */
  groupPhoto: { args: [conversation: string]; result: Uint8Array | null };
  /** Gives a group a photo from the bytes of a JPEG, PNG or WebP file (0094); the envelope id. */
  setGroupPhoto: { args: [conversation: string, bytes: Uint8Array]; result: string };
  /** Takes a group's photo away (0094); the envelope id. */
  clearGroupPhoto: { args: [conversation: string]; result: string };
  me: { args: []; result: Me };
  wipe: { args: []; result: void };
}

export type Op = keyof Ops;

interface Request<O extends Op = Op> {
  id: number;
  op: O;
  args: Ops[O]["args"];
}

type Response =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: Failure };

/** Whether `value` has the shape of a `Failure`. */
export function isFailure(value: unknown): value is Failure {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    typeof value.code === "string" &&
    "message" in value &&
    typeof value.message === "string"
  );
}

/** Whatever was thrown, as the page may see it: a `Failure`, never a stack. */
export function asFailure(error: unknown): Failure {
  if (isFailure(error)) {
    const { code, message } = error;
    return { code, message };
  }
  if (error instanceof Error && error.name === "StoreKeyLost") {
    return { code: "store-key-lost", message: "the store cannot be opened" };
  }
  return { code: "internal", message: "the chat worker failed" };
}

function isResponse(value: unknown): value is Response {
  if (typeof value !== "object" || value === null) return false;
  if (!("id" in value) || typeof value.id !== "number" || !("ok" in value)) return false;
  return value.ok === true ? "value" in value : "error" in value && isFailure(value.error);
}

function isRequest(value: unknown): value is Request {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "number" &&
    "op" in value &&
    typeof value.op === "string" &&
    "args" in value &&
    Array.isArray(value.args)
  );
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
  postMessage(message: unknown, options?: { transfer: Transferable[] }): void;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
}

/** The page's typed handle on the worker. Calls run in order, one at a time, as the core does. */
export function chatClient(port: Port) {
  let next = 0;
  const pending = new Map<number, (response: Response) => void>();
  port.addEventListener("message", (event: MessageEvent<unknown>) => {
    const response = event.data;
    if (!isResponse(response)) return;
    const waiting = pending.get(response.id);
    if (waiting === undefined) return;
    pending.delete(response.id);
    waiting(response);
  });
  return function call<O extends Op>(op: O, ...args: Ops[O]["args"]): Promise<Ops[O]["result"]> {
    const id = next++;
    return new Promise((resolve, reject) => {
      pending.set(id, (response) => {
        if (!response.ok) return reject(new ChatFailure(response.error));
        // The worker answers each op with its `Ops` result; a message cannot carry that type.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- structured-clone boundary
        resolve(response.value as Ops[O]["result"]);
      });
      // A photo's bytes move to the worker rather than being copied.
      const transfer = args.flatMap((a) => (a instanceof Uint8Array ? [a.buffer] : []));
      port.postMessage({ id, op, args } satisfies Request<O>, { transfer });
    });
  };
}

export type ChatCall = ReturnType<typeof chatClient>;

/** The handlers a worker serves, one per operation. */
export type Handlers = {
  [O in Op]: (...args: Ops[O]["args"]) => Promise<Ops[O]["result"]> | Ops[O]["result"];
};

function dispatch<O extends Op>(
  handlers: Handlers,
  op: O,
  args: Ops[O]["args"],
): Promise<Ops[O]["result"]> | Ops[O]["result"] {
  return handlers[op](...args);
}

/**
 * Answers each request on `port` with its handler. Requests are taken one at a
 * time: the core blocks, and two calls at once would interleave its store.
 */
export function serve(port: Port, handlers: Handlers): void {
  let queue: Promise<void> = Promise.resolve();
  port.addEventListener("message", (event: MessageEvent<unknown>) => {
    const request = event.data;
    if (!isRequest(request)) return;
    const { id, op, args } = request;
    queue = queue.then(async () => {
      try {
        const value = await dispatch(handlers, op, args);
        port.postMessage({ id, ok: true, value } satisfies Response);
      } catch (error) {
        port.postMessage({ id, ok: false, error: asFailure(error) } satisfies Response);
      }
    });
  });
}
