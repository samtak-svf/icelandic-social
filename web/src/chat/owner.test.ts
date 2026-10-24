import { describe, expect, it, vi } from "vitest";

import { type ChatWorker, ownChat, type OwnerDeps, startChat } from "./owner";
import { type ChatCall, ChatFailure } from "./protocol";

/** One origin's locks, as far as `ifAvailable` and `steal` go. */
function fakeLocks() {
  let holder: { fail: (error: unknown) => void } | undefined;
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
      const mine = { fail: reject };
      holder = mine;
      void Promise.resolve(callback({ name: CHAT, mode: "exclusive" })).then((value) => {
        if (holder === mine) holder = undefined;
        resolve(value);
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
  it("lets the first tab own it, and tells the second it is open elsewhere", async () => {
    const locks = fakeLocks();
    const first = tab(locks);
    const second = tab(locks);
    expect(await ownChat(first.deps)).toMatchObject({ call: expect.any(Function) });
    expect(await ownChat(second.deps)).toBe("elsewhere");
    expect(second.workers).toHaveLength(0);
  });

  it("ends the old tab's worker when another tab takes the chat over", async () => {
    const locks = fakeLocks();
    const first = tab(locks);
    const owned = await ownChat(first.deps);
    if (owned === "elsewhere") throw new Error("not owned");
    const second = tab(locks);
    expect(await ownChat(second.deps, true)).not.toBe("elsewhere");
    await owned.taken;
    expect(first.terminates[0]!).toHaveBeenCalled();
    expect(second.terminates[0]!).not.toHaveBeenCalled();
  });

  it("frees the chat for the next tab when the owner releases it", async () => {
    const locks = fakeLocks();
    const first = tab(locks);
    const owned = await ownChat(first.deps);
    if (owned === "elsewhere") throw new Error("not owned");
    owned.release();
    await vi.waitFor(() => expect(first.terminates[0]!).toHaveBeenCalled());
    expect(await ownChat(tab(locks).deps)).not.toBe("elsewhere");
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
