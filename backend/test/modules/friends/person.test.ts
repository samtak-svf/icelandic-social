import { describe, expect, it } from "vitest";
import { community, ok, person, type Person } from "../../people.ts";
import { accept, ask, friendIds } from "./support.ts";

// The person screen and the lists around it (decision 0114).

type Screen = {
  relation: string;
  friendCount: number;
  mutualCount: number;
  mutualFriends: { accountId: string }[];
  sharedCommunities: { communityId: string }[];
  friendsSince: number | null;
  snoozedUntil: number | null;
};

const screen = async (viewer: Person, other: Person) =>
  ok<Screen>(await viewer.call("GET", `/v1/people/${other.accountId}`));

const befriend = async (a: Person, b: Person) => {
  await ask(a, b);
  expect((await accept(b, a)).status).toBe(204);
};

describe("the person screen", () => {
  it("is for a signed-in account only", async () => {
    const one = await person("Einn");
    const { worker } = await import("../../main.ts");
    const response = await worker.fetch(`https://spjall.test/v1/people/${one.accountId}`);
    expect(response.status).toBe(401);
  });

  it("shows oneself as self, with no mutual friends", async () => {
    const [a, b] = [await person("Anna"), await person("Bjarni")];
    await befriend(a, b);
    const mine = await screen(a, a);
    expect(mine.relation).toBe("self");
    expect(mine.friendCount).toBe(1);
    expect(mine.mutualCount).toBe(0);
    expect(mine.sharedCommunities).toEqual([]);
  });

  it("counts someone's friends, and names only the mutual ones", async () => {
    const [a, b, both, theirs] = [
      await person("Anna"),
      await person("Bjarni"),
      await person("Bæði"),
      await person("Annað"),
    ];
    await befriend(a, both);
    await befriend(b, both);
    await befriend(b, theirs);
    const seen = await screen(a, b);
    expect(seen.friendCount).toBe(2);
    expect(seen.mutualCount).toBe(1);
    expect(seen.mutualFriends.map((f) => f.accountId)).toEqual([both.accountId]);
    expect(JSON.stringify(seen)).not.toContain(theirs.accountId);
  });

  it("gives no way to read another account's list", async () => {
    const [a, b] = [await person("Anna"), await person("Bjarni")];
    expect((await a.call("GET", `/v1/people/${b.accountId}/friends`)).status).toBe(404);
    expect((await a.call("GET", `/v1/friends/${b.accountId}`)).status).toBe(404);
  });

  it("names the communities both are in, and no other", async () => {
    const [a, b] = [await person("Anna"), await person("Bjarni")];
    const shared = await community(a, "open", b);
    await community(a, "open");
    const seen = await screen(b, a);
    expect(seen.sharedCommunities.map((c) => c.communityId)).toEqual([shared]);
  });

  it("states since when two are friends, and nothing before", async () => {
    const [a, b] = [await person("Anna"), await person("Bjarni")];
    expect((await screen(a, b)).friendsSince).toBeNull();
    const before = Date.now();
    await befriend(a, b);
    expect((await screen(a, b)).friendsSince).toBeGreaterThanOrEqual(before);
  });

  it("answers 404 across a block either way, while the account route still answers", async () => {
    const [a, b] = [await person("Anna"), await person("Bjarni")];
    expect((await a.call("PUT", `/v1/blocks/${b.accountId}`)).status).toBe(204);
    for (const [viewer, other] of [
      [a, b],
      [b, a],
    ] as const) {
      expect((await viewer.call("GET", `/v1/people/${other.accountId}`)).status).toBe(404);
      expect((await viewer.call("GET", `/v1/accounts/${other.accountId}`)).status).toBe(200);
    }
  });

  it("answers the same 404 for a block and for nobody", async () => {
    const [a, b] = [await person("Anna"), await person("Bjarni")];
    await a.call("PUT", `/v1/blocks/${b.accountId}`);
    const blocked = await b.call("GET", `/v1/people/${a.accountId}`);
    const nobody = await b.call("GET", "/v1/people/00000000000000000000000000");
    expect(blocked.status).toBe(nobody.status);
    const bodyOf = async (r: Response) => ((await r.json()) as { error: string }).error;
    expect(await bodyOf(blocked)).toBe(await bodyOf(nobody));
  });
});

describe("the friend list", () => {
  const scene = async () => {
    const me = await person("Ég");
    const [early, late] = [await person("Örn Síðastur"), await person("Anna Fyrst")];
    await befriend(me, early);
    await new Promise((resolve) => setTimeout(resolve, 2));
    await befriend(me, late);
    return { me, early, late };
  };

  it("sorts by newest, or by name", async () => {
    const { me, early, late } = await scene();
    expect(await friendIds(me)).toEqual([late.accountId, early.accountId]);
    expect(await friendIds(me, "?sort=name")).toEqual([late.accountId, early.accountId]);
  });

  it("searches by name, whatever the case and accents", async () => {
    const { me, early } = await scene();
    expect(await friendIds(me, `?q=${encodeURIComponent("örn")}`)).toEqual([early.accountId]);
    expect(await friendIds(me, "?q=ekkert")).toEqual([]);
  });

  it("leaves out a friend across a block, by ending the friendship", async () => {
    const { me, early, late } = await scene();
    await late.call("PUT", `/v1/blocks/${me.accountId}`);
    expect(await friendIds(me)).toEqual([early.accountId]);
  });
});

describe("a snooze", () => {
  it("lasts 30 days, is listed for its owner only and can be lifted", async () => {
    const [a, b] = [await person("Anna"), await person("Bjarni")];
    const before = Date.now();
    const answer = await ok<{ until: number }>(await a.call("PUT", `/v1/snoozes/${b.accountId}`));
    const day = 24 * 60 * 60 * 1000;
    expect(answer.until).toBeGreaterThanOrEqual(before + 30 * day);
    expect((await screen(a, b)).snoozedUntil).toBe(answer.until);
    expect((await screen(b, a)).snoozedUntil).toBeNull();
    const listed = await ok<{ snoozed: { person: { accountId: string } }[] }>(
      await a.call("GET", "/v1/snoozes"),
    );
    expect(listed.snoozed.map((s) => s.person.accountId)).toEqual([b.accountId]);
    expect((await a.call("DELETE", `/v1/snoozes/${b.accountId}`)).status).toBe(204);
    expect((await screen(a, b)).snoozedUntil).toBeNull();
  });

  it("does not touch a friendship or tell anybody", async () => {
    const [a, b] = [await person("Anna"), await person("Bjarni")];
    await befriend(a, b);
    await a.call("PUT", `/v1/snoozes/${b.accountId}`);
    expect((await screen(a, b)).relation).toBe("friends");
    expect(await friendIds(b)).toEqual([a.accountId]);
  });
});
