import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { deleteAccount } from "../../../src/compose/account-deletion.ts";
import { errorOf, ok, person } from "../../people.ts";
import { euEnv } from "../../support.ts";
import { recorder, run, tick } from "../notifications/support.ts";
import {
  accept,
  age,
  ask,
  friendIds,
  noticesAs,
  relation,
  requests,
  rowsNaming,
} from "./support.ts";

// What a block and a deletion leave behind (decision 0114).

const none = { friend_requests: 0, friendships: 0, person_snoozes: 0, notifications: 0 };

describe("a block", () => {
  it("ends a friendship and takes every request both ways, in either role", async () => {
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

  it("clears both directions of a request, and a past request's clock", async () => {
    const [a, b, c] = [await person("Anna"), await person("Bjarni"), await person("Dóra")];
    await ask(a, b);
    await ask(c, a);
    await age(c, a, 31);
    await a.call("PUT", `/v1/blocks/${b.accountId}`);
    await a.call("PUT", `/v1/blocks/${c.accountId}`);
    expect((await rowsNaming(a.accountId)).friend_requests).toBe(0);
    expect((await requests(b)).incoming).toEqual([]);
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
    // The clock went with the rows, so they may ask again at once.
    expect(await ok(await ask(a, b))).toEqual({ relation: "sent" });
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
