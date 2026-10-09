import { describe, expect, it } from "vitest";
import { ApiError } from "../src/api/common.ts";
import { device } from "./support.ts";
import { worker } from "./main.ts";

// Workers rate limits (cloudflare.config.ts): per address on the routes a person
// reaches before signing in, per account on key-package claims and on posts.

const BASE = "https://spjall.test";
const errorOf = async (response: Response) => ApiError.parse(await response.json()).error;

/** The statuses of `n` requests, made one after another. */
async function statuses(n: number, request: () => Promise<Response>) {
  const seen: number[] = [];
  for (let i = 0; i < n; i++) seen.push((await request()).status);
  return seen;
}

/**
 * Waits, if the current window is nearly over, for the next one. Local workerd
 * aligns each 60 s window to the wall clock (miniflare's rate limiter), so a
 * burst that crosses a minute is counted in two windows and never reaches the
 * limit. A burst here takes a few seconds; 20 s left is ample.
 */
async function oneWindow() {
  const left = 60_000 - (Date.now() % 60_000);
  if (left < 20_000) await new Promise((resolve) => setTimeout(resolve, left + 100));
}

/** Room for oneWindow's wait on top of the burst itself. */
const burst = { timeout: 40_000 };

describe("the public routes", burst, () => {
  const from = (address: string) => () =>
    worker.fetch(`${BASE}/v1/invites/inv_no_such_invite_here`, {
      headers: { "cf-connecting-ip": address },
    });

  it("answer 30 requests a minute from one address, then rate_limited", async () => {
    await oneWindow();
    const seen = await statuses(31, from("192.0.2.1"));
    expect(seen.slice(0, 30).every((s) => s === 404)).toBe(true);
    expect(seen[30]).toBe(429);
    expect(await errorOf(await from("192.0.2.1")())).toBe("rate_limited");
    // Another address is counted on its own.
    expect((await from("192.0.2.2")()).status).toBe(404);
  });

  it("count every public route against the same address", async () => {
    await oneWindow();
    await statuses(30, from("192.0.2.3"));
    const signIn = await worker.fetch(`${BASE}/v1/sign-in`, {
      headers: { "cf-connecting-ip": "192.0.2.3" },
    });
    expect(signIn.status).toBe(429);
  });
});

describe("claiming KeyPackages", burst, () => {
  it("answers 120 claims a minute from one account, then rate_limited", async () => {
    const owner = await device();
    const claimer = await device();
    const claim = () =>
      worker.fetch(`${BASE}/v1/accounts/${owner.accountId}/key-packages`, {
        method: "POST",
        headers: { "content-type": "application/json", ...claimer.auth },
        body: "{}",
      });
    await oneWindow();
    const seen = await statuses(121, claim);
    expect(seen.slice(0, 120).every((s) => s !== 429)).toBe(true);
    expect(seen[120]).toBe(429);
    // Another account of the same person's contacts is not slowed by it.
    const other = await device();
    const theirs = await worker.fetch(`${BASE}/v1/accounts/${owner.accountId}/key-packages`, {
      method: "POST",
      headers: { "content-type": "application/json", ...other.auth },
      body: "{}",
    });
    expect(theirs.status).not.toBe(429);
  });
});

describe("posting to Fljótið", burst, () => {
  it("answers 20 posts and replies a minute from one account, then rate_limited", async () => {
    const author = await device();
    const write = (path: string, by = author) =>
      worker.fetch(`${BASE}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...by.auth },
        body: JSON.stringify({ body: "x" }),
      });
    await oneWindow();
    const seen = await statuses(19, () => write("/v1/posts"));
    expect(seen.every((s) => s === 201)).toBe(true);
    const { postId } = (await (await write("/v1/posts")).json()) as { postId: string };
    // Replies count against the same limit.
    const reply = await write(`/v1/posts/${postId}/replies`);
    expect(reply.status).toBe(429);
    expect(await errorOf(reply)).toBe("rate_limited");
    expect((await write("/v1/posts")).status).toBe(429);
    // Another account is counted on its own.
    expect((await write("/v1/posts", await device())).status).toBe(201);
  });
});
