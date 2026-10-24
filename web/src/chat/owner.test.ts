import { describe, expect, it, vi } from "vitest";

import { type ChatWorker, ownChat, type OwnerDeps, startChat } from "./owner";
import { type ChatCall, ChatFailure } from "./protocol";

/** One origin's locks, as far as `ifAvailable` and `steal` go. */
function fakeLocks() {
  let holder: { fail: (error: unknown) => void } | undefined;
  const request = (
    _name: string,
    options: LockOptions,
    callback: (lock: Lock | null) => Promise<unknown>,
  ): Promise<unknown> => {
    if (holder !== undefined && options.ifAvailable) return callback(null);
    if (holder !== undefined && options.steal) {
      holder.fail(new DOMException("stolen", "AbortError"));
      holder = undefined;
    }
    return new Promise((resolve, reject) => {
      const mine = { fail: reject };
      holder = mine;
      void callback({ name: CHAT, mode: "exclusive" } as Lock).then((value) => {
        if (holder === mine) holder = undefined;
        resolve(value);
      });
    });
  };
  return { request: request as unknown as LockManager["request"] };
}
const CHAT = "spjall-chat-store";

function tab(locks: OwnerDeps["locks"]) {
  const workers: ChatWorker[] = [];
  const spawn = () => {
    const worker: ChatWorker = {
      postMessage: () => undefined,
      addEventListener: () => undefined,
      terminate: vi.fn(),
    };
    workers.push(worker);
    return worker;
  };
  return { deps: { locks, spawn }, workers };
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
    expect(first.workers[0]!.terminate).toHaveBeenCalled();
    expect(second.workers[0]!.terminate).not.toHaveBeenCalled();
  });

  it("frees the chat for the next tab when the owner releases it", async () => {
    const locks = fakeLocks();
    const first = tab(locks);
    const owned = await ownChat(first.deps);
    if (owned === "elsewhere") throw new Error("not owned");
    owned.release();
    await vi.waitFor(() => expect(first.workers[0]!.terminate).toHaveBeenCalled());
    expect(await ownChat(tab(locks).deps)).not.toBe("elsewhere");
  });
});

describe("starting the store after a takeover", () => {
  const busy = new ChatFailure({ code: "storage", message: "did not open" });
  const wait = () => Promise.resolve();

  it("waits while the previous worker still holds the store", async () => {
    const call = vi
      .fn()
      .mockRejectedValueOnce(busy)
      .mockRejectedValueOnce(busy)
      .mockResolvedValueOnce({ state: "ready", deviceId: "dev-1" });
    expect(await startChat(call as unknown as ChatCall, wait)).toEqual({
      state: "ready",
      deviceId: "dev-1",
    });
    expect(call).toHaveBeenCalledTimes(3);
  });

  it("does not retry any other failure", async () => {
    const other = new ChatFailure({ code: "internal", message: "x" });
    const call = vi.fn().mockRejectedValue(other);
    await expect(startChat(call as unknown as ChatCall, wait)).rejects.toBe(other);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("gives up after its last wait", async () => {
    const call = vi.fn().mockRejectedValue(busy);
    await expect(startChat(call as unknown as ChatCall, wait)).rejects.toBe(busy);
    expect(call).toHaveBeenCalledTimes(6);
  });
});
