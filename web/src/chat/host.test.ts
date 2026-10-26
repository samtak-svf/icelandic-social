import { describe, expect, it, vi } from "vitest";

import type { Enrolled, Failure } from "../generated/core.d.ts";
import { type CoreLike, chatHost, DEVICE_LOST, type HostDeps, type Share } from "./host";
import type { SealedStoreKey } from "./store-key";

const notRegistered: Failure = { code: "not-registered", message: "not registered" };

function fakeCore(over: Partial<CoreLike> = {}): CoreLike {
  return {
    beginLink: () => ({ code: "CODE-1", linkId: "link-1", expiresAt: 1 }),
    linkState: () => "pending",
    completeLink: (): Enrolled => ({
      accountId: "acc-1",
      deviceId: "dev-1",
      historyExpected: true,
      storeKeyShare: new Uint8Array(32).fill(7),
    }),
    receiveHistory: () => 3,
    sync: () => ({ events: [], frames: [] }),
    onFrame: () => ({ events: [], frames: [] }),
    conversations: () => [],
    timeline: () => [],
    send: () => "env-1",
    groupPhoto: () => null,
    setGroupPhoto: () => "env-2",
    clearGroupPhoto: () => "env-3",
    me: () => ({ accountId: "acc-1", name: null, verified: false, photo: null, devices: [] }),
    wipe: async () => undefined,
    ...over,
  };
}

function deps(over: { share?: Share; core?: CoreLike; record?: SealedStoreKey } = {}) {
  let record = over.record;
  const opened: Uint8Array[] = [];
  const wipe = vi.fn(async () => undefined);
  const core = over.core ?? fakeCore({ wipe });
  const d = {
    open: vi.fn(async (key: Uint8Array<ArrayBuffer>) => {
      opened.push(key.slice());
      return core;
    }),
    linkQr: () => ({ size: 1, modules: new Uint8Array([1]) }),
    wipeFiles: vi.fn(async () => undefined),
    keys: {
      load: async () => record,
      save: vi.fn(async (r: SealedStoreKey) => {
        record = r;
      }),
      delete: vi.fn(async () => {
        record = undefined;
      }),
    },
    // A fresh copy per call, as each fetch of the share is.
    share: vi.fn(async (): Promise<Share> => {
      const s = over.share ?? "none";
      return typeof s === "string" ? s : { ...s, share: s.share.slice() };
    }),
    revoke: vi.fn(async () => undefined),
  } satisfies HostDeps;
  return { d, core, wipe, opened, record: () => record };
}

/** Links a browser through the host and returns what it stored. */
async function linked() {
  const a = deps();
  const host = chatHost(a.d);
  await host.beginLink();
  await host.completeLink();
  const record = a.record();
  if (record === undefined) throw new Error("not saved");
  return { record, key: a.opened[0]!, share: new Uint8Array(32).fill(7) };
}

describe("the chat worker's key flow (decisions 0064, 0081)", () => {
  it("is unlinked with no sealed key, and clears what a broken link left", async () => {
    const a = deps();
    expect(await chatHost(a.d).start()).toEqual({ state: "unlinked" });
    expect(a.d.wipeFiles).toHaveBeenCalled();
    expect(a.d.open).not.toHaveBeenCalled();
  });

  it("opens a new store for a link and seals its key with the server's share", async () => {
    const a = deps();
    const host = chatHost(a.d);
    const offer = await host.beginLink();
    expect(offer).toMatchObject({ code: "CODE-1", qr: { size: 1 } });
    expect(a.opened).toHaveLength(1);
    expect(a.opened[0]).toHaveLength(32);
    expect(await host.completeLink()).toEqual({ deviceId: "dev-1", historyExpected: true });
    expect(a.record()).toMatchObject({ v: 1, deviceId: "dev-1" });
  });

  it("opens the same store with the same key after a restart", async () => {
    const { record, key, share } = await linked();
    const b = deps({ record, share: { deviceId: "dev-1", share } });
    expect(await chatHost(b.d).start()).toEqual({ state: "ready", deviceId: "dev-1" });
    expect(b.opened[0]).toEqual(key);
  });

  it("keeps the store when the session is gone", async () => {
    const { record } = await linked();
    const b = deps({ record, share: "signed-out" });
    expect(await chatHost(b.d).start()).toEqual({ state: "signed-out" });
    expect(b.d.keys.delete).not.toHaveBeenCalled();
    expect(b.d.wipeFiles).not.toHaveBeenCalled();
  });

  it("loses the device when the server has no share for it", async () => {
    const { record } = await linked();
    const b = deps({ record, share: "none" });
    expect(await chatHost(b.d).start()).toEqual({ state: "lost" });
    expect(b.d.keys.delete).toHaveBeenCalled();
    expect(b.d.wipeFiles).toHaveBeenCalled();
    expect(b.d.revoke).toHaveBeenCalledWith("dev-1");
    expect(b.record()).toBeUndefined();
  });

  it("loses the device when the share does not open the key", async () => {
    const { record } = await linked();
    const b = deps({ record, share: { deviceId: "dev-1", share: new Uint8Array(32).fill(9) } });
    expect(await chatHost(b.d).start()).toEqual({ state: "lost" });
    expect(b.d.open).not.toHaveBeenCalled();
    expect(b.d.revoke).toHaveBeenCalledWith("dev-1");
  });

  it("keeps the store and its key when the store cannot open now", async () => {
    const { record, share } = await linked();
    const b = deps({ record, share: { deviceId: "dev-1", share } });
    const busy = { code: "storage", message: "the browser's file store did not open" };
    b.d.open.mockRejectedValueOnce(busy);
    const host = chatHost(b.d);
    await expect(host.start()).rejects.toEqual(busy);
    expect(b.d.wipeFiles).not.toHaveBeenCalled();
    expect(b.d.keys.delete).not.toHaveBeenCalled();
    expect(b.d.revoke).not.toHaveBeenCalled();
    expect(await host.start()).toEqual({ state: "ready", deviceId: "dev-1" });
  });

  it("loses the device when its store turns out empty", async () => {
    const { record, share } = await linked();
    const wipe = vi.fn(async () => undefined);
    const core = fakeCore({
      sync: () => {
        throw notRegistered;
      },
      wipe,
    });
    const b = deps({ record, share: { deviceId: "dev-1", share }, core });
    const host = chatHost(b.d);
    await host.start();
    await expect(host.sync()).rejects.toEqual(DEVICE_LOST);
    expect(wipe).toHaveBeenCalled();
    expect(b.d.revoke).toHaveBeenCalledWith("dev-1");
    await expect(host.conversations()).rejects.toMatchObject({ code: "closed" });
  });

  it("passes a group's photo through, and null when it has none", async () => {
    const setGroupPhoto = vi.fn(() => "env-7");
    const { record, share } = await linked();
    const core = fakeCore({ setGroupPhoto, groupPhoto: () => undefined });
    const host = chatHost(deps({ record, share: { deviceId: "dev-1", share }, core }).d);
    await host.start();
    const bytes = new Uint8Array([1, 2, 3]);
    expect(await host.setGroupPhoto("c-1", bytes)).toBe("env-7");
    expect(setGroupPhoto).toHaveBeenCalledWith("c-1", bytes);
    expect(await host.groupPhoto("c-1")).toBeNull();
    expect(await host.clearGroupPhoto("c-1")).toBe("env-3");
  });

  it("zeroes the share it was given", async () => {
    const { record, share } = await linked();
    const b = deps({ record, share: { deviceId: "dev-1", share } });
    await chatHost(b.d).start();
    const given: Share = await b.d.share.mock.results[0]!.value;
    if (typeof given === "string") throw new Error("no share was given");
    expect(given.share.every((byte) => byte === 0)).toBe(true);
  });

  it("revokes the device when the sealed key cannot be saved", async () => {
    const a = deps();
    a.d.keys.save.mockRejectedValueOnce(new Error("quota"));
    const host = chatHost(a.d);
    await host.beginLink();
    await expect(host.completeLink()).rejects.toThrow("quota");
    expect(a.d.revoke).toHaveBeenCalledWith("dev-1");
  });

  it("refuses to link a browser that is linked", async () => {
    const { record, share } = await linked();
    const host = chatHost(deps({ record, share: { deviceId: "dev-1", share } }).d);
    await host.start();
    await expect(host.beginLink()).rejects.toMatchObject({ code: "invalid" });
  });

  it("refuses core calls before a store is open", async () => {
    await expect(chatHost(deps().d).sync()).rejects.toMatchObject({ code: "closed" });
  });

  it("wipes the store and both parts of the key", async () => {
    const { record, share } = await linked();
    const b = deps({ record, share: { deviceId: "dev-1", share } });
    const host = chatHost(b.d);
    await host.start();
    await host.wipe();
    expect(b.wipe).toHaveBeenCalled();
    expect(b.record()).toBeUndefined();
    expect(await host.start()).toEqual({ state: "unlinked" });
  });
});
