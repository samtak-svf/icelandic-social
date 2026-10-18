import { env } from "cloudflare:workers";
import { expect } from "vitest";
import { ApiError } from "../src/api/common.ts";
import { device } from "./support.ts";
import { worker } from "./main.ts";

// Verified, named accounts that call the worker, and the communities they
// make: what the social tests build their scenes from.

const BASE = "https://spjall.test";

export type Person = Awaited<ReturnType<typeof person>>;

/** A new verified account named `name`, with helpers to call the API as it. */
export async function person(name: string) {
  const seeded = await device();
  await env.DB.prepare("UPDATE accounts SET display_name = ?, verified = 1 WHERE account_id = ?")
    .bind(name, seeded.accountId)
    .run();
  const call = (method: string, path: string, body?: unknown) =>
    worker.fetch(`${BASE}${path}`, {
      method,
      headers: {
        ...seeded.auth,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const send = (path: string, bytes: Uint8Array) =>
    worker.fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { ...seeded.auth, "content-type": "application/octet-stream" },
      body: bytes,
    });
  return { ...seeded, call, send };
}

export const errorOf = async (response: Response) => ApiError.parse(await response.json()).error;

/** The body of a 200 answer. */
export async function ok<T>(response: Response): Promise<T> {
  expect(response.status).toBe(200);
  return (await response.json()) as T;
}

/** A community `owner` makes, which `members` join (invited first to a private one). */
export async function community(
  owner: Person,
  audience: "open" | "private",
  ...members: Person[]
): Promise<string> {
  const { communityId } = await ok<{ communityId: string }>(
    await owner.call("POST", "/v1/communities", { name: "Garðyrkjufélagið", audience }),
  );
  for (const member of members) {
    if (audience === "private") {
      await owner.call("PUT", `/v1/communities/${communityId}/invitations/${member.accountId}`);
    }
    expect((await member.call("POST", `/v1/communities/${communityId}/join`)).status).toBe(200);
  }
  return communityId;
}
