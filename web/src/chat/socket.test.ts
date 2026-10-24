import { describe, expect, it, vi } from "vitest";

import type { Outcome } from "../generated/core.d.ts";
import { type ChatCall, ChatFailure } from "./protocol";
import { chatSocket, type SocketLike, socketUrl } from "./socket";

class FakeSocket implements SocketLike {
  sent: string[] = [];
  closed = false;
  private listeners: Record<string, ((event: MessageEvent) => void)[]> = {};
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
  }
  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    (this.listeners[type] ??= []).push(listener);
  }
  emit(type: "open" | "close" | "message", data?: string) {
    for (const l of this.listeners[type] ?? []) l(new MessageEvent("message", { data }));
  }
}

const settle = () => new Promise((r) => setTimeout(r, 0));

function harness(answer: (op: string, ...args: unknown[]) => Promise<Outcome>) {
  const sockets: FakeSocket[] = [];
  const waits: number[] = [];
  // The fake answers only `sync` and `frame`, both with an `Outcome`; `ChatCall` cannot say so.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double for a generic call
  const call = vi.fn(answer) as unknown as ChatCall;
  const deps = {
    call,
    connect: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
    onEvents: vi.fn(),
    onFailure: vi.fn(),
    wait: async (ms: number) => {
      waits.push(ms);
    },
  };
  const handle = chatSocket("wss://host/v1/ws", deps);
  return { sockets, waits, deps, handle, call };
}

const nothing: Outcome = { events: [], frames: [] };

describe("the page's socket (decision 0081)", () => {
  it("names the build in the query, on the page's own host", () => {
    expect(socketUrl({ protocol: "https:", host: "example.test" })).toMatch(
      /^wss:\/\/example\.test\/v1\/ws\?client=web%2F\d+\.\d+\.\d+$/,
    );
    expect(socketUrl({ protocol: "http:", host: "localhost:8787" })).toMatch(/^ws:\/\/localhost/);
  });

  it("syncs when it opens, hands each frame to the worker, and sends back what the core answers", async () => {
    const event = { kind: "joined", conversation: "c-1" } as const;
    const h = harness(async (op) =>
      op === "frame" ? { events: [event], frames: ['{"type":"ack"}'] } : nothing,
    );
    h.sockets[0]!.emit("open");
    h.sockets[0]!.emit("message", '{"type":"notify"}');
    await settle();
    expect(h.deps.call).toHaveBeenNthCalledWith(1, "sync");
    expect(h.deps.call).toHaveBeenNthCalledWith(2, "frame", '{"type":"notify"}');
    expect(h.deps.onEvents).toHaveBeenCalledWith([event]);
    expect(h.sockets[0]!.sent).toEqual(['{"type":"ack"}']);
  });

  it("opens again after a close, waiting longer each time, and syncs on the new socket", async () => {
    const h = harness(async () => nothing);
    h.sockets[0]!.emit("close");
    await settle();
    h.sockets[1]!.emit("close");
    await settle();
    expect(h.waits).toEqual([1_000, 2_000]);
    h.sockets[2]!.emit("open");
    await settle();
    expect(h.deps.call).toHaveBeenCalledWith("sync");
    h.sockets[2]!.emit("close");
    await settle();
    expect(h.waits).toEqual([1_000, 2_000, 1_000]);
  });

  it("stays closed once the device is lost, and says so", async () => {
    const lost = new ChatFailure({ code: "device-lost", message: "gone" });
    const h = harness(async () => {
      throw lost;
    });
    h.sockets[0]!.emit("open");
    await settle();
    expect(h.deps.onFailure).toHaveBeenCalledWith(lost);
    expect(h.sockets[0]!.closed).toBe(true);
    h.sockets[0]!.emit("close");
    await settle();
    expect(h.sockets).toHaveLength(1);
  });

  it("keeps going after a passing failure", async () => {
    const h = harness(async () => {
      throw new ChatFailure({ code: "unreachable", message: "offline" });
    });
    h.sockets[0]!.emit("open");
    await settle();
    expect(h.deps.onFailure).not.toHaveBeenCalled();
    expect(h.sockets[0]!.closed).toBe(false);
  });

  it("does not open again after the page closes it", async () => {
    const h = harness(async () => nothing);
    h.handle.close();
    h.sockets[0]!.emit("close");
    await settle();
    expect(h.sockets).toHaveLength(1);
  });

  it("syncs on request, so a queued send goes out, and sends the answer only on an open socket", async () => {
    const h = harness(async (op) => (op === "sync" ? { events: [], frames: ["ack"] } : nothing));
    h.handle.sync();
    await settle();
    expect(h.call).toHaveBeenCalledWith("sync");
    expect(h.sockets[0]!.sent).toEqual([]);

    h.sockets[0]!.emit("open");
    await settle();
    h.handle.sync();
    await settle();
    expect(h.sockets[0]!.sent).toEqual(["ack", "ack"]);

    h.sockets[0]!.emit("close");
    h.handle.sync();
    await settle();
    expect(h.sockets[0]!.sent).toHaveLength(2);
  });
});
