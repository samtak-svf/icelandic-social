import { describe, expect, test, vi } from "vitest";
import type { CoreEvent } from "../generated/core.d.ts";
import type { Owned, OwnOptions } from "./owner.ts";
import { ChatFailure, type ChatCall, type Start } from "./protocol.ts";
import { chatSession, type ChatState, type SessionDeps } from "./session.ts";
import type { SocketDeps } from "./socket.ts";

const tick = () => new Promise((r) => setTimeout(r, 0));

function setup(opts: { owns?: (options: OwnOptions) => Promise<Owned>; start?: Start } = {}) {
  const states: ChatState[] = [];
  const events: CoreEvent[][] = [];
  const call = stubCall();
  let take!: () => void;
  const release = vi.fn();
  const owned: Owned = { call, taken: new Promise((r) => (take = r)), release };
  const sockets: {
    url: string;
    deps: SocketDeps;
    close: ReturnType<typeof vi.fn>;
    sync: ReturnType<typeof vi.fn>;
  }[] = [];
  const own = vi.fn((options: OwnOptions) =>
    opts.owns ? opts.owns(options) : Promise.resolve(owned),
  );
  const deps: SessionDeps = {
    own,
    start: () => Promise.resolve(opts.start ?? { state: "ready", deviceId: "d1" }),
    socket: (url, socketDeps) => {
      const close = vi.fn();
      const sync = vi.fn();
      sockets.push({ url, deps: socketDeps, close, sync });
      return { close, sync };
    },
    socketUrl: () => "wss://x/v1/ws",
    connect: () => {
      throw new Error("unused");
    },
  };
  const session = chatSession(
    deps,
    (s) => states.push(s),
    (e) => events.push(e),
  );
  return { session, states, events, sockets, own, release, take: () => take() };
}

describe("chatSession", () => {
  test("a linked browser starts, then opens the socket", async () => {
    const t = setup();
    await tick();
    expect(t.states).toEqual(["starting", "ready"]);
    expect(t.sockets.map((s) => s.url)).toEqual(["wss://x/v1/ws"]);
  });

  test("another tab holds the chat: elsewhere and no socket, then ready once it lets go", async () => {
    let grant!: (owned: Owned) => void;
    const t = setup({
      owns: ({ onWaiting }) => {
        onWaiting?.();
        return new Promise((r) => (grant = r));
      },
    });
    await tick();
    expect(t.states).toEqual(["starting", "elsewhere"]);
    expect(t.sockets).toEqual([]);
    grant(ownedStub());
    await tick();
    expect(t.states.at(-1)).toBe("ready");
  });

  test("use here takes the chat with the lock stolen and gives up the wait", async () => {
    const signals: AbortSignal[] = [];
    const t = setup({
      owns: ({ steal, signal, onWaiting }) => {
        if (steal) return Promise.resolve(ownedStub());
        signals.push(signal!);
        onWaiting?.();
        return new Promise((_, reject) =>
          signal!.addEventListener("abort", () => reject(new Error("aborted"))),
        );
      },
    });
    await tick();
    t.session.useHere();
    await tick();
    expect(t.own.mock.calls.map((c) => c[0].steal)).toEqual([false, true]);
    expect(signals[0]!.aborted).toBe(true);
    expect(t.states.at(-1)).toBe("ready");
    expect(t.states).not.toContain("failed");
  });

  test.each(["unlinked", "lost", "signed-out"] as const)("start answers %s", async (state) => {
    const t = setup({ start: { state } });
    await tick();
    expect(t.states.at(-1)).toBe(state);
    expect(t.sockets).toEqual([]);
  });

  test("losing the lock closes the socket, shows elsewhere and waits to get it back", async () => {
    let calls = 0;
    const owned = ownedTakeable();
    const t = setup({
      owns: ({ onWaiting }) => {
        if (calls++ === 0) return Promise.resolve(owned.owned);
        onWaiting?.();
        return new Promise(() => {});
      },
    });
    await tick();
    owned.take();
    await tick();
    expect(t.sockets[0]!.close).toHaveBeenCalled();
    expect(t.states.at(-1)).toBe("elsewhere");
    expect(t.own).toHaveBeenCalledTimes(2);
  });

  test("a device-lost failure from the socket shows lost; others show failed", async () => {
    const t = setup();
    await tick();
    t.sockets[0]!.deps.onFailure(new ChatFailure({ code: "device-lost", message: "m" }));
    expect(t.states.at(-1)).toBe("lost");
    t.sockets[0]!.deps.onFailure(new ChatFailure({ code: "internal", message: "m" }));
    expect(t.states.at(-1)).toBe("failed");
  });

  test("events reach the listener", async () => {
    const t = setup();
    await tick();
    const batch: CoreEvent[] = [{ kind: "joined", conversation: "c" }];
    t.sockets[0]!.deps.onEvents(batch);
    expect(t.events).toEqual([batch]);
  });

  test("sync asks the socket, and does nothing before the chat is ready", async () => {
    const t = setup();
    t.session.sync();
    await tick();
    t.session.sync();
    expect(t.sockets[0]!.sync).toHaveBeenCalledTimes(1);
  });

  test("close releases the lock, closes the socket and goes quiet", async () => {
    const t = setup();
    await tick();
    t.session.close();
    expect(t.release).toHaveBeenCalled();
    expect(t.sockets[0]!.close).toHaveBeenCalled();
    const seen = t.states.length;
    t.take();
    await tick();
    expect(t.states.length).toBe(seen);
  });
});

function ownedTakeable() {
  let take!: () => void;
  const owned: Owned = { call: stubCall(), taken: new Promise((r) => (take = r)), release() {} };
  return { owned, take: () => take() };
}

function ownedStub(): Owned {
  return {
    call: stubCall(),
    taken: new Promise(() => {}),
    release() {},
  };
}

function stubCall(): ChatCall {
  return () => Promise.reject(new Error("no call expected"));
}
