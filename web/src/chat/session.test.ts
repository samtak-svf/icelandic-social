import { describe, expect, test, vi } from "vitest";
import type { CoreEvent } from "../generated/core.d.ts";
import type { Owned, OwnOptions } from "./owner.ts";
import { ChatFailure, type ChatCall, type Start } from "./protocol.ts";
import {
  type CatchUp,
  chatSession,
  type ChatState,
  historyMayCome,
  type SessionDeps,
} from "./session.ts";
import type { SocketDeps } from "./socket.ts";

const tick = () => new Promise((r) => setTimeout(r, 0));

function setup(
  opts: {
    owns?: (options: OwnOptions) => Promise<Owned>;
    start?: Start;
    call?: ChatCall;
  } = {},
) {
  const states: ChatState[] = [];
  const events: CoreEvent[][] = [];
  const catchUps: CatchUp[] = [];
  const waits: number[] = [];
  const call = opts.call ?? stubCall();
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
    wait: async (ms) => {
      waits.push(ms);
    },
  };
  const session = chatSession(
    deps,
    (s) => states.push(s),
    (e) => events.push(e),
    (c) => catchUps.push(c),
  );
  return {
    session,
    states,
    events,
    catchUps,
    waits,
    sockets,
    own,
    release,
    take: () => take(),
  };
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

describe("catching up (decision 0109)", () => {
  /** A worker that answers `receiveHistory` from `answers`, in turn. */
  function history(...answers: (number | ChatFailure)[]) {
    const asked = vi.fn();
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double for a generic call
    const call = (async (op: string) => {
      if (op !== "receiveHistory") throw new Error(`unexpected ${op}`);
      asked();
      const next = answers.shift() ?? 0;
      if (next instanceof ChatFailure) throw next;
      return next;
    }) as unknown as ChatCall;
    return { call, asked };
  }
  const uploading = () => new ChatFailure({ code: "refused", message: "not_found" });

  test("history, then the backlog, then done; the empty list waits for done", async () => {
    let resolve!: (n: number) => void;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double for a generic call
    const call = (() => new Promise<number>((r) => (resolve = r))) as unknown as ChatCall;
    const t = setup({ call });
    await tick();
    expect(t.catchUps).toEqual(["history"]);
    resolve(2);
    await tick();
    expect(t.catchUps).toEqual(["history", "backlog"]);
    t.sockets[0]!.deps.onCaughtUp!();
    expect(t.catchUps.at(-1)).toBe("done");
  });

  test("the backlog arriving first still waits for the history", async () => {
    let resolve!: (n: number) => void;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double for a generic call
    const call = (() => new Promise<number>((r) => (resolve = r))) as unknown as ChatCall;
    const t = setup({ call });
    await tick();
    t.sockets[0]!.deps.onCaughtUp!();
    expect(t.catchUps.at(-1)).toBe("history");
    resolve(0);
    await tick();
    expect(t.catchUps.at(-1)).toBe("done");
  });

  test("a history the phone is still uploading is asked for again until it comes", async () => {
    const h = history(uploading(), uploading(), 3);
    const t = setup({ call: h.call });
    await tick();
    await tick();
    expect(h.asked).toHaveBeenCalledTimes(3);
    expect(t.waits).toEqual([2_000, 4_000]);
    t.sockets[0]!.deps.onCaughtUp!();
    expect(t.catchUps.at(-1)).toBe("done");
  });

  test("a history that cannot come is given up, and the chat still catches up", async () => {
    const h = history(new ChatFailure({ code: "refused", message: "forbidden" }));
    const t = setup({ call: h.call });
    await tick();
    expect(h.asked).toHaveBeenCalledTimes(1);
    t.sockets[0]!.deps.onCaughtUp!();
    expect(t.catchUps.at(-1)).toBe("done");
  });

  test("the asking stops after about ten minutes", async () => {
    const h = history(...Array.from({ length: 40 }, uploading));
    const t = setup({ call: h.call });
    for (let i = 0; i < 30; i++) await tick();
    expect(h.asked).toHaveBeenCalledTimes(25);
    expect(t.waits.reduce((a, b) => a + b, 0)).toBe(630_000);
    expect(t.catchUps.at(-1)).toBe("backlog");
  });

  test("a closed session stops asking and reports nothing more", async () => {
    const h = history(uploading(), uploading(), 1);
    const t = setup({ call: h.call });
    t.session.close();
    await tick();
    await tick();
    expect(h.asked.mock.calls.length).toBeLessThanOrEqual(1);
    expect(t.catchUps).toEqual([]);
  });

  test("only an upload in progress or a lost network may be asked again", () => {
    expect(historyMayCome(uploading())).toBe(true);
    expect(historyMayCome(new ChatFailure({ code: "unreachable", message: "m" }))).toBe(true);
    expect(historyMayCome(new ChatFailure({ code: "refused", message: "expired" }))).toBe(false);
    expect(historyMayCome(new Error("x"))).toBe(false);
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
