import { env } from "cloudflare:workers";
import { expect } from "vitest";
import { CLIENT_HEADER } from "../../../src/shared/client-version.ts";
import { worker } from "../../main.ts";
import { ok, type Person } from "../../people.ts";
import type { Page } from "../notifications/support.ts";

// Shared by the friends tests: the routes as a person calls them, and the clock
// moved by hand, since a request's whole meaning to its sender is its age.

const DAY = 24 * 60 * 60 * 1000;

export const ask = (from: Person, to: Person) =>
  from.call("PUT", `/v1/friend-requests/${to.accountId}`);
export const accept = (me: Person, from: Person) =>
  me.call("POST", `/v1/friend-requests/${from.accountId}/accept`);
export const decline = (me: Person, from: Person) =>
  me.call("POST", `/v1/friend-requests/${from.accountId}/decline`);
export const cancel = (me: Person, to: Person) =>
  me.call("DELETE", `/v1/friend-requests/${to.accountId}`);
export const unfriend = (me: Person, other: Person) =>
  me.call("DELETE", `/v1/friends/${other.accountId}`);

/** Makes the request from `from` to `to` as old as `days`. */
export async function age(from: Person, to: Person, days: number): Promise<void> {
  const { meta } = await env.DB.prepare(
    "UPDATE friend_requests SET created_at = ? WHERE from_account = ? AND to_account = ?",
  )
    .bind(Date.now() - days * DAY, from.accountId, to.accountId)
    .run();
  expect(meta.changes).toBe(1);
}

/** The relation `viewer` reads off `other`'s screen. */
export async function relation(viewer: Person, other: Person): Promise<string> {
  const response = await viewer.call("GET", `/v1/people/${other.accountId}`);
  expect(response.status).toBe(200);
  return ((await response.json()) as { relation: string }).relation;
}

type Friend = { person: { accountId: string }; since: number };
export type Requests = {
  incoming: { person: { accountId: string } }[];
  sent: { person: { accountId: string } }[];
};

export const requests = async (one: Person): Promise<Requests> =>
  (await (await one.call("GET", "/v1/friend-requests")).json()) as Requests;

export const friendIds = async (one: Person, query = ""): Promise<string[]> => {
  const body = (await (await one.call("GET", `/v1/friends${query}`)).json()) as {
    friends: Friend[];
  };
  return body.friends.map((f) => f.person.accountId);
};

/** The rows that name `id` in each friends table, either way round. */
export async function rowsNaming(id: string): Promise<Record<string, number>> {
  const count = async (table: string, a: string, b: string) => {
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM ${table} WHERE ${a} = ?1 OR ${b} = ?1`,
    )
      .bind(id)
      .first<{ n: number }>();
    return row?.n ?? -1;
  };
  return {
    friend_requests: await count("friend_requests", "from_account", "to_account"),
    friendships: await count("friendships", "account_id", "friend_id"),
    person_snoozes: await count("person_snoozes", "account_id", "target_id"),
    notifications: await count("notifications", "account_id", "actor_id"),
  };
}

/** The notifications as this client reads them; a current one by default. */
export const noticesAs = async (
  one: Person,
  client = `android/${env.FRIEND_NOTICE_CLIENT_VERSION}`,
): Promise<Page> =>
  ok<Page>(
    await worker.fetch("https://spjall.test/v1/notifications", {
      headers: { ...one.auth, [CLIENT_HEADER]: client },
    }),
  );
