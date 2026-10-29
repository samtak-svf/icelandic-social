import { describe, expect, it } from "vitest";
import { settled, track } from "./notice-writes.ts";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe("notice writes", () => {
  it("resolves at once with nothing in flight", async () => {
    await expect(settled()).resolves.toBeUndefined();
  });

  it("waits for a slow write", async () => {
    const write = deferred<number>();
    void track(write.promise);
    let done = false;
    void settled().then(() => (done = true));
    await flush();
    expect(done).toBe(false);
    write.resolve(1);
    await flush();
    expect(done).toBe(true);
  });

  it("returns the write unchanged", async () => {
    const write = Promise.resolve(7);
    expect(track(write)).toBe(write);
  });

  it("does not block on a rejected write", async () => {
    const write = deferred<number>();
    const tracked = track(write.promise);
    tracked.catch(() => undefined);
    const waiting = settled();
    write.reject(new Error("offline"));
    await expect(waiting).resolves.toBeUndefined();
  });

  it("is not extended by a write tracked after the call", async () => {
    const first = deferred<number>();
    const later = deferred<number>();
    void track(first.promise);
    let done = false;
    void settled().then(() => (done = true));
    void track(later.promise);
    first.resolve(1);
    await flush();
    expect(done).toBe(true);
    later.resolve(2);
    await flush();
  });
});
