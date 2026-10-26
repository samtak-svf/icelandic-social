import { afterEach, describe, expect, it } from "vitest";

import { asFailure, ChatFailure, chatClient, type Handlers, type Port, serve } from "./protocol";
import { StoreKeyLost } from "./store-key";

const channels: MessageChannel[] = [];
afterEach(() => {
  for (const c of channels.splice(0)) {
    c.port1.close();
    c.port2.close();
  }
});

/** Both ends of a channel, as the page and the worker see theirs. */
function ends(): [Port, Port] {
  const channel = new MessageChannel();
  channels.push(channel);
  channel.port1.start();
  channel.port2.start();
  return [channel.port1, channel.port2];
}

const unused = async () => {
  throw new Error("not called");
};

function handlers(over: Partial<Handlers>): Handlers {
  return {
    start: unused,
    beginLink: unused,
    pendingLink: unused,
    linkState: unused,
    completeLink: unused,
    receiveHistory: unused,
    sync: unused,
    frame: unused,
    conversations: unused,
    timeline: unused,
    send: unused,
    groupPhoto: unused,
    setGroupPhoto: unused,
    clearGroupPhoto: unused,
    me: unused,
    wipe: unused,
    ...over,
  };
}

describe("the page's channel to the chat worker (0081)", () => {
  it("answers each call with its handler's value", async () => {
    const [page, worker] = ends();
    serve(worker, handlers({ send: (conversation, text) => `${conversation}:${text}` }));
    const call = chatClient(page);
    expect(await call("send", "c-1", "halló")).toBe("c-1:halló");
  });

  it("moves a photo's bytes to the worker rather than copying them", async () => {
    const [page, worker] = ends();
    serve(worker, handlers({ setGroupPhoto: (_, bytes) => String(bytes.length) }));
    const bytes = new Uint8Array([1, 2, 3]);
    expect(await chatClient(page)("setGroupPhoto", "c-1", bytes)).toBe("3");
    expect(bytes.byteLength).toBe(0);
  });

  it("rejects with the handler's failure, and nothing else of the error", async () => {
    const [page, worker] = ends();
    serve(
      worker,
      handlers({
        sync: () => {
          throw Object.assign(new Error("secret detail"), { code: "unreachable", message: "x" });
        },
      }),
    );
    const failure = await chatClient(page)("sync").catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ChatFailure);
    expect(failure).toMatchObject({ code: "unreachable", message: "x" });
  });

  it("runs calls one at a time, in the order they were made", async () => {
    const [page, worker] = ends();
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    serve(
      worker,
      handlers({
        sync: async () => {
          order.push("sync start");
          await gate;
          order.push("sync end");
          return { events: [], frames: [] };
        },
        conversations: () => {
          order.push("conversations");
          return [];
        },
      }),
    );
    const call = chatClient(page);
    const both = Promise.all([call("sync"), call("conversations")]);
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual(["sync start"]);
    release();
    await both;
    expect(order).toEqual(["sync start", "sync end", "conversations"]);
  });

  it("keeps serving after a call fails", async () => {
    const [page, worker] = ends();
    serve(worker, handlers({ me: unused, receiveHistory: () => 4 }));
    const call = chatClient(page);
    await expect(call("me")).rejects.toMatchObject({ code: "internal" });
    expect(await call("receiveHistory")).toBe(4);
  });
});

describe("what a thrown value becomes", () => {
  it("keeps a failure's code and message only", () => {
    expect(asFailure({ code: "refused", message: "rate_limited", stack: "…" })).toEqual({
      code: "refused",
      message: "rate_limited",
    });
  });

  it("names a store key that cannot be opened", () => {
    expect(asFailure(new StoreKeyLost())).toMatchObject({ code: "store-key-lost" });
  });

  it("hides anything else", () => {
    expect(asFailure(new TypeError("at line 3 of the worker"))).toEqual({
      code: "internal",
      message: "the chat worker failed",
    });
  });
});
