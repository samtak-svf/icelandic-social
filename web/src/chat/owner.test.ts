import { describe, expect, it, vi } from "vitest";

import { type ChatWorker, ownChat, type OwnerDeps, showChat, startChat } from "./owner";
import { type ChatCall, ChatFailure } from "./protocol";

/** One origin's locks, as far as `ifAvailable`, `steal`, `signal` and the queue go. */
function fakeLocks() {
  type Holder = { fail: (error: unknown) => void };
  let holder: Holder | undefined;
  const queue: (() => void)[] = [];
  function request<T>(name: string, callback: LockGrantedCallback<T>): Promise<Awaited<T>>;
  function request<T>(
    name: string,
    options: LockOptions,
    callback: LockGrantedCallback<T>,
  ): Promise<Awaited<T>>;
  function request(
    _name: string,
    second: LockOptions | LockGrantedCallback<unknown>,
    third?: LockGrantedCallback<unknown>,
  ): Promise<unknown> {
    const options = typeof second === "function" ? {} : second;
    const callback = typeof second === "function" ? second : third!;
    if (holder !== undefined && options.ifAvailable) return Promise.resolve(callback(null));
    if (holder !== undefined && options.steal) {
      holder.fail(new DOMException("stolen", "AbortError"));
      holder = undefined;
    }
    return new Promise((resolve, reject) => {
      if (options.signal?.aborted) return reject(new DOMException("aborted", "AbortError"));
      const mine: Holder = { fail: reject };
      const grant = () => {
        holder = mine;
        void Promise.resolve(callback({ name: CHAT, mode: "exclusive" })).then((value) => {
          if (holder === mine) {
            holder = undefined;
            queue.shift()?.();
          }
          resolve(value);
        });
      };
      if (holder === undefined) return grant();
      queue.push(grant);
      options.signal?.addEventListener("abort", () => {
        queue.splice(queue.indexOf(grant), 1);
        reject(new DOMException("aborted", "AbortError"));
      });
    });
  }
  return { request };
}
const CHAT = "spjall-chat-store";

/** A spy standing in for the generic `ChatCall`, whose per-op result types a mock cannot carry. */
function asCall(spy: (op: string) => Promise<unknown>): ChatCall {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double for a generic call
  return spy as unknown as ChatCall;
}

function tab(locks: OwnerDeps["locks"]) {
  const workers: ChatWorker[] = [];
  const terminates: ReturnType<typeof vi.fn>[] = [];
  const spawn = () => {
    const terminate = vi.fn();
    const worker: ChatWorker = {
      postMessage: () => undefined,
      addEventListener: () => undefined,
      terminate,
    };
    workers.push(worker);
    terminates.push(terminate);
    return worker;
  };
  return { deps: { locks, spawn }, workers, terminates };
}

describe("which tab runs the chat (decision 0064)", () => {
  it("lets the first tab own it; the second is told it is open elsewhere and waits", async () => {
    const locks = fakeLocks();
    const first = tab(locks);
    const second = tab(locks);
    const owned = await ownChat(first.deps);
    const onWaiting = vi.fn();
    const later = ownChat(second.deps, { onWaiting });
    await vi.waitFor(() => expect(onWaiting).toHaveBeenCalledOnce());
    expect(second.workers).toHaveLength(0);
    // The holder lets go (the tab closes, or the page that held it a moment
    // ago is gone): the waiting tab takes the chat without being asked.
    owned.release();
    expect(await later).toMatchObject({ call: expect.any(Function) });
    await vi.waitFor(() => expect(first.terminates[0]!).toHaveBeenCalled());
    expect(second.workers).toHaveLength(1);
  });

  it("gives up the wait when its signal aborts", async () => {
    const locks = fakeLocks();
    await ownChat(tab(locks).deps);
    const second = tab(locks);
    const wait = new AbortController();
    const later = ownChat(second.deps, { signal: wait.signal, onWaiting: () => wait.abort() });
    await expect(later).rejects.toThrow("aborted");
    expect(second.workers).toHaveLength(0);
  });

  it("ends the old tab's worker when another tab takes the chat over", async () => {
    const locks = fakeLocks();
    const first = tab(locks);
    const owned = await ownChat(first.deps);
    const second = tab(locks);
    await ownChat(second.deps, { steal: true });
    await owned.taken;
    expect(first.terminates[0]!).toHaveBeenCalled();
    expect(second.terminates[0]!).not.toHaveBeenCalled();
  });

  it("frees the chat for the next tab when the owner releases it", async () => {
    const locks = fakeLocks();
    const first = tab(locks);
    const owned = await ownChat(first.deps);
    owned.release();
    await vi.waitFor(() => expect(first.terminates[0]!).toHaveBeenCalled());
    const onWaiting = vi.fn();
    await ownChat(tab(locks).deps, { onWaiting });
    expect(onWaiting).not.toHaveBeenCalled();
  });
});

describe("starting the store after a takeover", () => {
  const busy = new ChatFailure({ code: "storage", message: "did not open" });
  const wait = () => Promise.resolve();

  it("waits while the previous worker still holds the store", async () => {
    const call = vi
      .fn<(op: string) => Promise<unknown>>()
      .mockRejectedValueOnce(busy)
      .mockRejectedValueOnce(busy)
      .mockResolvedValueOnce({ state: "ready", deviceId: "dev-1" });
    expect(await startChat(asCall(call), wait)).toEqual({
      state: "ready",
      deviceId: "dev-1",
    });
    expect(call).toHaveBeenCalledTimes(3);
  });

  it("does not retry any other failure", async () => {
    const other = new ChatFailure({ code: "internal", message: "x" });
    const call = vi.fn<(op: string) => Promise<unknown>>().mockRejectedValue(other);
    await expect(startChat(asCall(call), wait)).rejects.toBe(other);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("gives up after its last wait", async () => {
    const call = vi.fn<(op: string) => Promise<unknown>>().mockRejectedValue(busy);
    await expect(startChat(asCall(call), wait)).rejects.toBe(busy);
    expect(call).toHaveBeenCalledTimes(6);
  });
});

describe("showChat (0124)", () => {
  it("waits for the tab showing the chat to leave", async () => {
    const locks = fakeLocks();
    const first = await showChat(locks);
    let second = false;
    const waiting = showChat(locks).then((got) => {
      second = true;
      return got;
    });
    await Promise.resolve();
    expect(second).toBe(false);
    first.release();
    await waiting;
    expect(second).toBe(true);
  });

  it("use here takes it at once and tells the tab that had it", async () => {
    const locks = fakeLocks();
    const first = await showChat(locks);
    let taken = false;
    void first.taken.then(() => (taken = true));
    await showChat(locks, { steal: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(taken).toBe(true);
  });

  it("gives up the wait when asked to", async () => {
    const locks = fakeLocks();
    await showChat(locks);
    const wait = new AbortController();
    const waiting = showChat(locks, { signal: wait.signal });
    wait.abort();
    await expect(waiting).rejects.toThrow();
  });
});
