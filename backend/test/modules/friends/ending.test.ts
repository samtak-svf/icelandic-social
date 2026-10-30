import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { deleteAccount } from "../../../src/compose/account-deletion.ts";
import { expireFriendRequests } from "../../../src/compose/friends.ts";
import { errorOf, ok, person, type Person } from "../../people.ts";
import { euEnv } from "../../support.ts";
import { recorder, run, tick } from "../notifications/support.ts";
import {
  accept,
  age,
  ask,
  decline,
  friendIds,
  noticesAs,
  relation,
  requests,
  rowsNaming,
} from "./support.ts";

// What a block and a deletion leave behind (decision 0114).

const none = { friend_requests: 0, friendships: 0, person_snoozes: 0, notifications: 0 };

/** The row of the request from `from` to `to`, or null. */
const requestRow = (from: Person, to: Person) =>
  env.DB.prepare(
    "SELECT state, created_at FROM friend_requests WHERE from_account = ? AND to_account = ?",
  )
    .bind(from.accountId, to.accountId)
    .first<{ state: string; created_at: number }>();

/** How many notice jobs telling `to` of a request from `from` are waiting. */
const requestJobs = async (from: Person, to: Person) => {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM jobs WHERE key LIKE ?")
    .bind(`friend_request:${from.accountId}:${to.accountId}:%`)
    .first<{ n: number }>();
  return row?.n ?? -1;
};

describe("a block", () => {
  it("ends a friendship and takes the other's request, whoever of them blocks", async () => {
    const [a, b] = [await person("Anna"), await person("Bjarni")];
    await ask(a, b);
    await accept(b, a);
    await run(recorder());
    await tick();
    expect((await rowsNaming(a.accountId)).friendships).toBe(2);
    expect((await rowsNaming(a.accountId)).notifications).toBeGreaterThan(0);

    expect((await b.call("PUT", `/v1/blocks/${a.accountId}`)).status).toBe(204);

    const left = await rowsNaming(a.accountId);
    expect(left).toEqual(none);
    expect(await friendIds(a)).toEqual([]);
  });

  it("takes what the other asked and its clock, and keeps the blocker's own", async () => {
    const [a, b, c] = [await person("Anna"), await person("Bjarni"), await person("Dóra")];
    await ask(a, b);
    await ask(c, a);
    await age(c, a, 31);
    await a.call("PUT", `/v1/blocks/${b.accountId}`);
    await a.call("PUT", `/v1/blocks/${c.accountId}`);
    expect(await requestRow(c, a)).toBeNull();
    expect((await requestRow(a, b))?.state).toBe("cancelled");
    expect((await rowsNaming(a.accountId)).friend_requests).toBe(1);
    expect((await requests(b)).incoming).toEqual([]);
  });

  it("does not let the blocker knock twice on one it asked", async () => {
    const [a, b] = [await person("Anna"), await person("Bjarni")];
    await ask(a, b);
    await run(recorder());
    await tick();
    await decline(b, a);
    await a.call("PUT", `/v1/blocks/${b.accountId}`);
    await a.call("DELETE", `/v1/blocks/${b.accountId}`);
    const waiting = await requestJobs(a, b);

    const refused = await ask(a, b);
    expect(await errorOf(refused)).toBe("request_refused");

    expect(await requestJobs(a, b)).toBe(waiting);
    await run(recorder());
    await tick();
    expect((await noticesAs(b)).notifications).toEqual([]);
    expect((await requests(b)).incoming).toEqual([]);
  });

  it("does not give the blocker back its day's requests", async () => {
    const asker = await person("Anna");
    for (let i = 0; i < 20; i += 1) {
      const asked = await person(`Viðtakandi ${i}`);
      expect((await ask(asker, asked)).status).toBe(200);
      await asker.call("PUT", `/v1/blocks/${asked.accountId}`);
    }
    const refused = await ask(asker, await person("Síðast"));
    expect(refused.status).toBe(429);
    expect(await errorOf(refused)).toBe("request_limit");
  });

  it("leaves the blocked free to ask at once once it is lifted", async () => {
    const [a, b] = [await person("Anna"), await person("Bjarni")];
    await ask(b, a);
    await a.call("PUT", `/v1/blocks/${b.accountId}`);
    expect(await requestRow(b, a)).toBeNull();
    await a.call("DELETE", `/v1/blocks/${b.accountId}`);
    expect(await ok(await ask(b, a))).toEqual({ relation: "sent" });
    expect((await requests(a)).incoming.map((r) => r.person.accountId)).toEqual([b.accountId]);
  });

  for (const state of ["pending", "declined", "accepted"]) {
    it(`keeps the blocker's ${state} request where neither side can read it`, async () => {
      const [a, b] = [await person("Anna"), await person("Bjarni")];
      await ask(a, b);
      if (state === "declined") await decline(b, a);
      if (state === "accepted") await accept(b, a);
      const asked = await requestRow(a, b);
      await run(recorder());
      await tick();

      await a.call("PUT", `/v1/blocks/${b.accountId}`);

      const kept = await requestRow(a, b);
      expect(kept?.state).toBe("cancelled");
      expect(kept?.created_at).toBe(asked?.created_at);
      const nothingListed = async () => {
        for (const one of [a, b]) {
          expect(await requests(one)).toMatchObject({ incoming: [], sent: [] });
          expect(await friendIds(one)).toEqual([]);
          expect((await noticesAs(one)).notifications).toEqual([]);
        }
      };
      await nothingListed();
      for (const [viewer, other] of [
        [a, b],
        [b, a],
      ] as const) {
        expect((await viewer.call("GET", `/v1/people/${other.accountId}`)).status).toBe(404);
      }

      await a.call("DELETE", `/v1/blocks/${b.accountId}`);
      await nothingListed();
      expect(await relation(a, b)).toBe("none");
      expect(await relation(b, a)).toBe("none");
    });
  }

  it("lets the daily sweep remove the kept row at day 90", async () => {
    const [a, b] = [await person("Anna"), await person("Bjarni")];
    await ask(a, b);
    await a.call("PUT", `/v1/blocks/${b.accountId}`);
    await age(a, b, 89);
    await expireFriendRequests(euEnv(env));
    expect(await requestRow(a, b)).not.toBeNull();
    await age(a, b, 91);
    await expireFriendRequests(euEnv(env));
    expect(await requestRow(a, b)).toBeNull();
  });

  it("is written as one batch: nothing stands if the block itself cannot be written", async () => {
    const [a, b] = [await person("Anna"), await person("Bjarni")];
    await ask(a, b);
    await accept(b, a);
    const before = await rowsNaming(a.accountId);
    expect((await a.call("PUT", "/v1/blocks/00000000000000000000000000")).status).toBe(404);
    expect(await rowsNaming(a.accountId)).toEqual(before);
  });

  it("refuses a request across it with a plain 404, and unblocking restores nothing", async () => {
    const [a, b] = [await person("Anna"), await person("Bjarni")];
    await ask(a, b);
    await accept(b, a);
    await a.call("PUT", `/v1/blocks/${b.accountId}`);
    for (const [from, to] of [
      [a, b],
      [b, a],
    ] as const) {
      const refused = await ask(from, to);
      expect(refused.status).toBe(404);
      expect(await errorOf(refused)).toBe("not_found");
    }
    expect((await a.call("DELETE", `/v1/blocks/${b.accountId}`)).status).toBe(204);
    expect(await relation(a, b)).toBe("none");
    expect(await friendIds(b)).toEqual([]);
    // The blocked has no clock left; the blocker's own still runs.
    expect(await errorOf(await ask(a, b))).toBe("request_refused");
    expect(await ok(await ask(b, a))).toEqual({ relation: "sent" });
  });
});

describe("a deletion", () => {
  it("leaves no row naming the account, in any friends table, either way round", async () => {
    const [gone, friend, asked, asker, snoozer] = [
      await person("Fer"),
      await person("Vinur"),
      await person("Spurður"),
      await person("Spyr"),
      await person("Blundar"),
    ];
    await ask(gone, friend);
    await accept(friend, gone);
    await ask(gone, asked);
    await ask(asker, gone);
    await gone.call("PUT", `/v1/snoozes/${friend.accountId}`);
    await snoozer.call("PUT", `/v1/snoozes/${gone.accountId}`);
    await run(recorder());
    await tick();
    const before = await rowsNaming(gone.accountId);
    expect(before.friendships).toBe(2);
    expect(before.friend_requests).toBe(3);
    expect(before.person_snoozes).toBe(2);
    expect(before.notifications).toBeGreaterThan(0);

    await deleteAccount(euEnv(env), gone.accountId);

    expect(await rowsNaming(gone.accountId)).toEqual(none);
    expect(await friendIds(friend)).toEqual([]);
    expect((await requests(asked)).incoming).toEqual([]);
    expect((await noticesAs(asked)).notifications).toEqual([]);
  });
});
