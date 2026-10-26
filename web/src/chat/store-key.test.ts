import { describe, expect, it } from "vitest";

import { newStoreKey, seal, sealPending, StoreKeyLost, unseal, unsealPending } from "./store-key";

const share = () => crypto.getRandomValues(new Uint8Array(32));

describe("the two-part store key (decision 0064)", () => {
  it("opens with the same share for the same device", async () => {
    const key = newStoreKey();
    const s = share();
    const record = await seal(key, s, "dev-1");
    expect(await unseal(record, s, "dev-1")).toEqual(key);
  });

  it("is 32 random bytes", () => {
    const a = newStoreKey();
    expect(a).toHaveLength(32);
    expect(newStoreKey()).not.toEqual(a);
  });

  it("does not open with another share", async () => {
    const record = await seal(newStoreKey(), share(), "dev-1");
    await expect(unseal(record, share(), "dev-1")).rejects.toBeInstanceOf(StoreKeyLost);
  });

  it("does not open for another device", async () => {
    const s = share();
    const record = await seal(newStoreKey(), s, "dev-1");
    await expect(unseal(record, s, "dev-2")).rejects.toBeInstanceOf(StoreKeyLost);
  });

  it("does not open without the local key", async () => {
    const s = share();
    const record = await seal(newStoreKey(), s, "dev-1");
    const other = await seal(newStoreKey(), s, "dev-1");
    await expect(unseal({ ...record, local: other.local }, s, "dev-1")).rejects.toBeInstanceOf(
      StoreKeyLost,
    );
  });

  it("keeps a local key that script cannot export", async () => {
    const record = await seal(newStoreKey(), share(), "dev-1");
    expect(record.local.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("raw", record.local)).rejects.toThrow();
  });

  it("never stores the key itself", async () => {
    const key = newStoreKey();
    const record = await seal(key, share(), "dev-1");
    const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
    expect(hex(record.sealed)).not.toContain(hex(key));
  });

  it("refuses a share that is not 32 bytes", async () => {
    await expect(seal(newStoreKey(), new Uint8Array(16), "dev-1")).rejects.toThrow(RangeError);
  });

  it("takes a tampered record as a lost store", async () => {
    const s = share();
    const record = await seal(newStoreKey(), s, "dev-1");
    const sealed = record.sealed.slice();
    const last = sealed.length - 1;
    sealed[last] = (sealed[last] ?? 0) ^ 1;
    await expect(unseal({ ...record, sealed }, s, "dev-1")).rejects.toBeInstanceOf(StoreKeyLost);
  });
});

describe("a waiting link's store (decision 0096)", () => {
  const link = { code: "CODE-1", linkId: "link-1", expiresAt: 1 };

  it("opens with the request's share and keeps the code", async () => {
    const key = newStoreKey();
    const s = share();
    const record = await sealPending(key, s, link);
    expect(record).toMatchObject(link);
    expect(await unsealPending(record, s)).toEqual(key);
  });

  it("does not open without the request's share", async () => {
    const record = await sealPending(newStoreKey(), share(), link);
    await expect(unsealPending(record, share())).rejects.toBeInstanceOf(StoreKeyLost);
  });

  it("does not open for another request", async () => {
    const s = share();
    const record = await sealPending(newStoreKey(), s, link);
    await expect(unsealPending({ ...record, linkId: "link-2" }, s)).rejects.toBeInstanceOf(
      StoreKeyLost,
    );
  });

  it("is not a device's record", async () => {
    // The same share and an id that reads like a device's still do not open it.
    const s = share();
    const record = await sealPending(newStoreKey(), s, link);
    await expect(
      unseal({ v: 1, deviceId: "link-1", local: record.local, sealed: record.sealed }, s, "link-1"),
    ).rejects.toBeInstanceOf(StoreKeyLost);
  });

  it("keeps a local key that script cannot export", async () => {
    const record = await sealPending(newStoreKey(), share(), link);
    expect(record.local.extractable).toBe(false);
  });
});
