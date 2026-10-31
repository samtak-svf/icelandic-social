import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { community, ok, person, type Person } from "../../people.ts";
import { wallPost } from "../social/wall-support.ts";
import { accept, age, ask, cancel, decline, unfriend } from "./support.ts";

// Friend suggestions (decision 0114). A private community's membership must never reach a third
// party, so every "not suggested" here stands beside someone who is: an empty answer proves nothing.

type Page = { people: { accountId: string; name: string | null }[]; next: string | null };

const page = (viewer: Person, query = "") =>
  viewer.call("GET", `/v1/friend-suggestions${query}`).then((r) => ok<Page>(r));

const suggested = async (viewer: Person) => (await page(viewer)).people.map((p) => p.accountId);

const setIncluded = async (one: Person, included: boolean) => {
  const response = await one.call("PUT", "/v1/friend-suggestion-settings", { included });
  expect(response.status).toBe(204);
};

/** A viewer, a control the viewer must be shown, and `other`, all in one open community. */
async function together(): Promise<{ viewer: Person; control: Person; other: Person }> {
  const [viewer, control, other] = [
    await person("Anna"),
    await person("Bjarni"),
    await person("Dóra"),
  ];
  await community(viewer, "open", control, other);
  return { viewer, control, other };
}

/** `viewer` and `other` do not see each other, and both still see the control. */
async function apart(viewer: Person, control: Person, other: Person): Promise<void> {
  expect(await suggested(viewer)).toEqual([control.accountId]);
  expect(await suggested(other)).toEqual([control.accountId]);
}

const suspend = (one: Person, until: number | null) =>
  env.DB.prepare("UPDATE accounts SET suspended_at = ?, suspended_until = ? WHERE account_id = ?")
    .bind(Date.now() - 1000, until, one.accountId)
    .run();

describe("where suggestions come from", () => {
  it("is for a signed-in account only", async () => {
    const { worker } = await import("../../main.ts");
    const response = await worker.fetch("https://spjall.test/v1/friend-suggestions");
    expect(response.status).toBe(401);
  });

  it("suggests a member of an open community, both ways", async () => {
    const [a, b] = [await person("Anna"), await person("Bjarni")];
    await community(a, "open", b);
    expect(await suggested(a)).toEqual([b.accountId]);
    expect(await suggested(b)).toEqual([a.accountId]);
  });

  it("never suggests a member of a private community", async () => {
    const [a, b, c] = [await person("Anna"), await person("Bjarni"), await person("Dóra")];
    await community(a, "private", b);
    await community(a, "open", c);
    expect(await suggested(a)).toEqual([c.accountId]);
    expect(await suggested(b)).toEqual([]);
  });

  it("suggests someone in one open and one private only through the open one", async () => {
    const [a, b] = [await person("Anna"), await person("Bjarni")];
    const open = await community(a, "open", b);
    await community(a, "private", b);
    expect(await suggested(a)).toEqual([b.accountId]);
    // The open link goes and the private one remains.
    expect((await b.call("POST", `/v1/communities/${open}/leave`)).status).toBe(204);
    expect(await suggested(a)).toEqual([]);
    expect(await suggested(b)).toEqual([]);
  });

  it("does not suggest someone who left", async () => {
    const { viewer, control, other } = await together();
    const [{ communityId } = { communityId: "" }] = (
      await env.DB.prepare(
        "SELECT community_id AS communityId FROM community_members WHERE account_id = ?",
      )
        .bind(other.accountId)
        .all<{ communityId: string }>()
    ).results;
    expect((await other.call("POST", `/v1/communities/${communityId}/leave`)).status).toBe(204);
    expect(await suggested(viewer)).toEqual([control.accountId]);
    expect(await suggested(other)).toEqual([]);
  });

  it("does not suggest through a deleted community", async () => {
    const [a, b, c] = [await person("Anna"), await person("Bjarni"), await person("Dóra")];
    const gone = await community(a, "open", b);
    await community(a, "open", c);
    expect((await a.call("DELETE", `/v1/communities/${gone}`)).status).toBe(204);
    expect(await suggested(a)).toEqual([c.accountId]);
    expect(await suggested(b)).toEqual([]);
  });

  it("never reads a wall, even an open one with members by a slip", async () => {
    const [owner, reader, control] = [
      await person("Anna"),
      await person("Bjarni"),
      await person("Dóra"),
    ];
    const { communityId } = await wallPost(owner, "everyone");
    await env.DB.batch([
      env.DB.prepare("UPDATE communities SET audience = 'open' WHERE community_id = ?").bind(
        communityId,
      ),
      ...[owner, reader].map((one) =>
        env.DB.prepare(
          `INSERT INTO community_members (community_id, account_id, role, joined_at)
           VALUES (?, ?, 'member', 0)`,
        ).bind(communityId, one.accountId),
      ),
    ]);
    await community(owner, "open", control);
    expect(await suggested(owner)).toEqual([control.accountId]);
    expect(await suggested(reader)).toEqual([]);
  });

  it("never reads mutual friends", async () => {
    const [a, between, b] = [await person("Anna"), await person("Bjarni"), await person("Dóra")];
    await ask(a, between);
    await accept(between, a);
    await ask(b, between);
    await accept(between, b);
    expect(await suggested(a)).toEqual([]);
    expect(await suggested(b)).toEqual([]);
  });

  it("says nothing of the community that links two people", async () => {
    const [a, b] = [await person("Anna"), await person("Bjarni")];
    const shared = await community(a, "open", b);
    await community(a, "open", b);
    const response = await a.call("GET", "/v1/friend-suggestions");
    const text = await response.text();
    expect(text).toContain(b.accountId);
    expect(text).not.toContain(shared);
    expect(text).not.toContain("Garðyrkjufélagið");
    const body = JSON.parse(text) as { people: Record<string, unknown>[] };
    // In two communities, and listed once, with an account's summary and nothing about the link.
    expect(body.people).toHaveLength(1);
    expect(Object.keys(body.people[0] ?? {}).sort()).toEqual([
      "accountId",
      "name",
      "photo",
      "photoFrames",
      "verified",
    ]);
  });
});

describe("who suggestions leave out", () => {
  it("leaves out oneself", async () => {
    const { viewer } = await together();
    expect(await suggested(viewer)).not.toContain(viewer.accountId);
    expect((await suggested(viewer)).length).toBe(2);
  });

  it("leaves out a friend, and after the 90 days an ended friendship is no bar", async () => {
    const { viewer, control, other } = await together();
    await ask(viewer, other);
    await accept(other, viewer);
    await apart(viewer, control, other);
    await unfriend(viewer, other);
    await age(viewer, other, 91);
    expect(await suggested(viewer)).toContain(other.accountId);
  });

  it("leaves out a friend whose request's clock has run out", async () => {
    const { viewer, control, other } = await together();
    await ask(viewer, other);
    await accept(other, viewer);
    await age(viewer, other, 91);
    await apart(viewer, control, other);
  });

  it("leaves out a pending request, seen from either end", async () => {
    const { viewer, control, other } = await together();
    await ask(viewer, other);
    await apart(viewer, control, other);
  });

  it("leaves out a pending request whichever of the two asked", async () => {
    const { viewer, control, other } = await together();
    await ask(other, viewer);
    await apart(viewer, control, other);
  });

  it("leaves out a block in each direction", async () => {
    const one = await together();
    await one.viewer.call("PUT", `/v1/blocks/${one.other.accountId}`);
    await apart(one.viewer, one.control, one.other);
    const two = await together();
    await two.other.call("PUT", `/v1/blocks/${two.viewer.accountId}`);
    await apart(two.viewer, two.control, two.other);
  });

  it("holds both ends out for the 90 days, and lets them back after", async () => {
    const { viewer, control, other } = await together();
    await ask(viewer, other);
    await age(viewer, other, 89);
    await apart(viewer, control, other);
    await age(viewer, other, 91);
    expect(await suggested(viewer)).toContain(other.accountId);
    expect(await suggested(other)).toContain(viewer.accountId);
  });

  it("reads a decline, a cancel and an expiry the same: by age alone", async () => {
    const declined = await together();
    await ask(declined.viewer, declined.other);
    await decline(declined.other, declined.viewer);
    await age(declined.viewer, declined.other, 60);
    await apart(declined.viewer, declined.control, declined.other);

    const cancelled = await together();
    await ask(cancelled.viewer, cancelled.other);
    await cancel(cancelled.viewer, cancelled.other);
    await apart(cancelled.viewer, cancelled.control, cancelled.other);

    const expired = await together();
    await ask(expired.viewer, expired.other);
    await age(expired.viewer, expired.other, 60);
    await apart(expired.viewer, expired.control, expired.other);
  });

  it("leaves out a suspended account until its suspension ends", async () => {
    const { viewer, control, other } = await together();
    await suspend(other, null);
    expect(await suggested(viewer)).toEqual([control.accountId]);
    await suspend(other, Date.now() + 60_000);
    expect(await suggested(viewer)).toEqual([control.accountId]);
    await suspend(other, Date.now() - 1);
    expect(await suggested(viewer)).toContain(other.accountId);
  });

  it("shows a suspended viewer nobody, without refusing it", async () => {
    const { viewer, control } = await together();
    await suspend(viewer, null);
    expect(await suggested(viewer)).toEqual([]);
    await suspend(viewer, Date.now() - 1);
    expect(await suggested(viewer)).toContain(control.accountId);
  });

  it("leaves out a deleted account", async () => {
    const { viewer, control, other } = await together();
    expect((await other.call("DELETE", "/v1/me")).status).toBe(204);
    expect(await suggested(viewer)).toEqual([control.accountId]);
  });

  it("leaves out an account whose deletion stopped part way, with no device left", async () => {
    const { viewer, control, other } = await together();
    await env.DB.prepare("UPDATE devices SET revoked_at = ? WHERE account_id = ?")
      .bind(Date.now(), other.accountId)
      .run();
    expect(await suggested(viewer)).toEqual([control.accountId]);
  });
});

describe("the setting", () => {
  it("is in by default, and reads back what was set", async () => {
    const one = await person("Anna");
    const read = () =>
      one.call("GET", "/v1/friend-suggestion-settings").then((r) => ok<{ included: boolean }>(r));
    expect(await read()).toEqual({ included: true });
    await setIncluded(one, false);
    expect(await read()).toEqual({ included: false });
    await setIncluded(one, true);
    expect(await read()).toEqual({ included: true });
  });

  it("takes an account out both ways, and back", async () => {
    const { viewer, control, other } = await together();
    await setIncluded(other, false);
    expect(await suggested(viewer)).toEqual([control.accountId]);
    expect(await suggested(other)).toEqual([]);
    await setIncluded(other, true);
    expect(await suggested(viewer)).toContain(other.accountId);
    expect(await suggested(other)).toContain(viewer.accountId);
  });

  it("refuses a body that is not a yes or a no", async () => {
    const one = await person("Anna");
    const refused = await one.call("PUT", "/v1/friend-suggestion-settings", { included: "no" });
    expect(refused.status).toBe(400);
  });

  it("can be changed by a suspended account", async () => {
    const one = await person("Anna");
    await suspend(one, null);
    await setIncluded(one, false);
  });

  it("goes with the account's row", async () => {
    const one = await person("Anna");
    await setIncluded(one, false);
    expect((await one.call("DELETE", "/v1/me")).status).toBe(204);
    const row = await env.DB.prepare("SELECT in_suggestions FROM accounts WHERE account_id = ?")
      .bind(one.accountId)
      .first();
    expect(row).toBeNull();
  });
});

describe("the page", () => {
  it("honours the cap and walks every person once", async () => {
    const viewer = await person("Anna");
    const others = [await person("Bjarni"), await person("Dóra"), await person("Elín")];
    await community(viewer, "open", ...others);
    const first = await page(viewer, "?limit=2");
    expect(first.people).toHaveLength(2);
    expect(first.next).not.toBeNull();
    const second = await page(viewer, `?limit=2&after=${first.next ?? ""}`);
    expect(second.people).toHaveLength(1);
    expect(second.next).toBeNull();
    expect([...first.people, ...second.people].map((p) => p.accountId)).toEqual(
      others.map((o) => o.accountId),
    );
  });

  it("refuses a limit above the cap and a cursor not from `next`", async () => {
    const viewer = await person("Anna");
    expect((await viewer.call("GET", "/v1/friend-suggestions?limit=51")).status).toBe(400);
    expect((await viewer.call("GET", "/v1/friend-suggestions?after=not!a!cursor")).status).toBe(
      400,
    );
  });
});
