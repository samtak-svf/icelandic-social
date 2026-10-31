import { describe, expect, it } from "vitest";
import type { Outcome } from "../social/outcome.ts";
import { ATTEMPTS, partBounds, sendParts, WORKERS, worthRetrying } from "./upload.ts";

const plan = { size: 25, partSize: 10, parts: 3 };
const stored: Outcome<unknown> = { ok: true, data: undefined };
const answer = (status: number | null): Outcome<unknown> => ({
  ok: false,
  status,
  problem: { kind: "unreachable" },
});
const noWait = () => Promise.resolve();

describe("the parts of a file", () => {
  it("cover the file exactly, the last one holding the remainder", () => {
    expect(partBounds(plan, 1)).toEqual([0, 10]);
    expect(partBounds(plan, 2)).toEqual([10, 20]);
    expect(partBounds(plan, 3)).toEqual([20, 25]);
  });

  it("are tried again only when that can help", () => {
    for (const status of [null, 429, 500, 503]) expect(worthRetrying(status)).toBe(true);
    for (const status of [400, 401, 404, 409, 410]) expect(worthRetrying(status)).toBe(false);
  });
});

describe("sending the parts", () => {
  it("sends each part once and reports the count after each", async () => {
    const sent: number[] = [];
    const seen: number[] = [];
    const result = await sendParts({
      plan,
      done: new Set(),
      send: (part) => {
        sent.push(part);
        return Promise.resolve(stored);
      },
      onPart: (count) => seen.push(count),
    });
    expect(result.ok).toBe(true);
    expect(sent.toSorted((a, b) => a - b)).toEqual([1, 2, 3]);
    expect(seen).toEqual([1, 2, 3]);
  });

  it("sends only what is missing when it carries on", async () => {
    const sent: number[] = [];
    const done = new Set([1, 3]);
    await sendParts({
      plan,
      done,
      send: (part) => {
        sent.push(part);
        return Promise.resolve(stored);
      },
      onPart: () => undefined,
    });
    expect(sent).toEqual([2]);
    expect([...done].toSorted((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it("never has more than its workers on the way", async () => {
    let now = 0;
    let most = 0;
    await sendParts({
      plan: { size: 100, partSize: 10, parts: 10 },
      done: new Set(),
      send: async () => {
        now += 1;
        most = Math.max(most, now);
        await Promise.resolve();
        now -= 1;
        return stored;
      },
      onPart: () => undefined,
    });
    expect(most).toBe(WORKERS);
  });

  it("gets past a short outage on one part", async () => {
    const waits: number[] = [];
    let failures = ATTEMPTS - 1;
    const result = await sendParts({
      plan: { size: 10, partSize: 10, parts: 1 },
      done: new Set(),
      send: () => {
        if (failures === 0) return Promise.resolve(stored);
        failures -= 1;
        return Promise.resolve(answer(503));
      },
      onPart: () => undefined,
      pause: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
    });
    expect(result.ok).toBe(true);
    expect(waits).toEqual([1000, 2000]);
  });

  it("stops after its tries, keeping what arrived, so the next run carries on", async () => {
    const done = new Set<number>();
    const tries = new Map<number, number>();
    const result = await sendParts({
      plan: { size: 10, partSize: 5, parts: 2 },
      done,
      send: (part) => {
        tries.set(part, (tries.get(part) ?? 0) + 1);
        return Promise.resolve(part === 1 ? stored : answer(null));
      },
      onPart: () => undefined,
      pause: noWait,
    });
    expect(result).toMatchObject({ ok: false, status: null });
    expect(tries.get(2)).toBe(ATTEMPTS);
    expect([...done]).toEqual([1]);
  });

  it("does not try again when the server says the upload is over", async () => {
    let tries = 0;
    const result = await sendParts({
      plan: { size: 10, partSize: 10, parts: 1 },
      done: new Set(),
      send: () => {
        tries += 1;
        return Promise.resolve(answer(410));
      },
      onPart: () => undefined,
      pause: noWait,
    });
    expect(result).toMatchObject({ ok: false, status: 410 });
    expect(tries).toBe(1);
  });

  it("starts no new part once one has stopped it", async () => {
    const sent: number[] = [];
    await sendParts({
      plan: { size: 100, partSize: 10, parts: 10 },
      done: new Set(),
      send: (part) => {
        sent.push(part);
        return Promise.resolve(answer(404));
      },
      onPart: () => undefined,
    });
    expect(sent.length).toBeLessThanOrEqual(WORKERS);
  });
});
