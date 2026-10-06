import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { ApiError } from "../src/api/common.ts";
import { device } from "./support.ts";

// Workers rate limits (wrangler.jsonc): per address on the routes a person
// reaches before signing in, per account on key-package claims.

const BASE = "https://spjall.test";
const errorOf = async (response: Response) => ApiError.parse(await response.json()).error;

/** The statuses of `n` requests, made one after another. */
async function statuses(n: number, request: () => Promise<Response>) {
  const seen: number[] = [];
  for (let i = 0; i < n; i++) seen.push((await request()).status);
  return seen;
}

describe("the public routes", () => {
  const from = (address: string) => () =>
    exports.default.fetch(`${BASE}/v1/invites/inv_no_such_invite_here`, {
      headers: { "cf-connecting-ip": address },
    });

  it("answer 30 requests a minute from one address, then rate_limited", async () => {
    const seen = await statuses(31, from("192.0.2.1"));
    expect(seen.slice(0, 30).every((s) => s === 404)).toBe(true);
    expect(seen[30]).toBe(429);
    expect(await errorOf(await from("192.0.2.1")())).toBe("rate_limited");
    // Another address is counted on its own.
    expect((await from("192.0.2.2")()).status).toBe(404);
  });

  it("count every public route against the same address", async () => {
    await statuses(30, from("192.0.2.3"));
    const signIn = await exports.default.fetch(`${BASE}/v1/sign-in`, {
      headers: { "cf-connecting-ip": "192.0.2.3" },
    });
    expect(signIn.status).toBe(429);
  });
});

describe("claiming KeyPackages", () => {
  it("answers 120 claims a minute from one account, then rate_limited", async () => {
    const owner = await device();
    const claimer = await device();
    const claim = () =>
      exports.default.fetch(`${BASE}/v1/accounts/${owner.accountId}/key-packages`, {
        method: "POST",
        headers: { "content-type": "application/json", ...claimer.auth },
        body: "{}",
      });
    const seen = await statuses(121, claim);
    expect(seen.slice(0, 120).every((s) => s !== 429)).toBe(true);
    expect(seen[120]).toBe(429);
    // Another account of the same person's contacts is not slowed by it.
    const other = await device();
    const theirs = await exports.default.fetch(
      `${BASE}/v1/accounts/${owner.accountId}/key-packages`,
      {
        method: "POST",
        headers: { "content-type": "application/json", ...other.auth },
        body: "{}",
      },
    );
    expect(theirs.status).not.toBe(429);
  });
});
