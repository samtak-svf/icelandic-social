import { describe, expect, test, vi } from "vitest";
import type { CoreEvent } from "../generated/core.d.ts";
import type { Owned } from "./owner.ts";
import { ChatFailure, type ChatCall, type Start } from "./protocol.ts";
import { chatSession, type ChatState, type SessionDeps } from "./session.ts";
import type { SocketDeps } from "./socket.ts";

const tick = () => new Promise((r) => setTimeout(r, 0));

function setup(opts: { owns?: (steal: boolean) => Owned | "elsewhere"; start?: Start } = {}) {
  const states: ChatState[] = [];
  const events: CoreEvent[][] = [];
  const call = stubCall();
  let take!: () => void;
  const release = vi.fn();
  const owned: Owned = { call, taken: new Promise((r) => (take = r)), release };
  const sockets: { url: string; deps: SocketDeps; close: ReturnType<typeof vi.fn> }[] = [];
  const own = vi.fn((steal: boolean) => Promise.resolve(opts.owns ? opts.owns(steal) : owned));
  const deps: SessionDeps = {
    own,
    start: () => Promise.resolve(opts.start ?? { state: "ready", deviceId: "d1" }),
    socket: (url, socketDeps) => {
      const close = vi.fn();
      sockets.push({ url, deps: socketDeps, close });
      return { close };
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

  test("another tab holds the chat: elsewhere, and no socket", async () => {
    const t = setup({ owns: () => "elsewhere" });
    await tick();
    expect(t.states).toEqual(["starting", "elsewhere"]);
    expect(t.sockets).toEqual([]);
  });

  test("use here takes the chat with the lock stolen", async () => {
    const t = setup({ owns: (steal) => (steal ? ownedStub() : "elsewhere") });
    await tick();
    t.session.useHere();
    await tick();
    expect(t.own.mock.calls.map((c) => c[0])).toEqual([false, true]);
    expect(t.states.at(-1)).toBe("ready");
  });

  test.each(["unlinked", "lost", "signed-out"] as const)("start answers %s", async (state) => {
    const t = setup({ start: { state } });
    await tick();
    expect(t.states.at(-1)).toBe(state);
    expect(t.sockets).toEqual([]);
  });

  test("losing the lock closes the socket and shows elsewhere", async () => {
    const t = setup();
    await tick();
    t.take();
    await tick();
    expect(t.sockets[0]!.close).toHaveBeenCalled();
    expect(t.states.at(-1)).toBe("elsewhere");
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
