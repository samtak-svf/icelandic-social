import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { communityLifecycle } from "../src/compose/community-lifecycle.ts";
import { expireCommunities } from "../src/modules/communities/index.ts";
import { jobHandlers } from "../src/modules/notifications/index.ts";
import { runJobs } from "../src/modules/jobs/index.ts";
import { png } from "./images.ts";
import { community, ok, person, type Person } from "./people.ts";
import { euEnv } from "./support.ts";

// A community's deletion (decision 0070): gone for everyone at once,
// restorable by a platform moderator for 30 days, then purged; its log and
// reports stay a year after the deletion, for platform moderators only.

const DAY = 24 * 60 * 60 * 1000;

async function platformModerator(name: string): Promise<Person> {
  const one = await person(name);
  await env.DB.prepare("INSERT INTO platform_moderators (account_id, added_at) VALUES (?, ?)")
    .bind(one.accountId, Date.now())
    .run();
  return one;
}

const expire = (at: number) => expireCommunities(euEnv(env), communityLifecycle, at);

const status = async (by: Person, method: string, path: string) =>
  (await by.call(method, path)).status;

type Report = { reportId: string; state: string; decision: string | null; resolution: string };
type Entry = { action: string; actor: { accountId: string } | null; asPlatform: boolean };

/** An open community with a post, a comment that notifies its author, and a report. */
async function scene() {
  const [owner, member] = [await person("Eigandi"), await person("Meðlimur")];
  const id = await community(owner, "open", member);
  const { mediaId } = await ok<{ mediaId: string }>(
    await owner.send(`/v1/communities/${id}/media`, await png(20, 20)),
  );
  const { postId } = await ok<{ postId: string }>(
    await owner.call("POST", `/v1/communities/${id}/posts`, { body: "Póstur", media: [mediaId] }),
  );
  await member.call("POST", `/v1/posts/${postId}/comments`, { body: "Flott" });
  await runJobs(euEnv(env), jobHandlers({ send: async () => {} }), Date.now() + 1);
  const target = { kind: "post", id: postId };
  expect((await member.call("POST", "/v1/reports", { reason: "spam", target })).status).toBe(204);
  return { owner, member, id, postId, mediaId };
}

const inbox = async (one: Person) =>
  ok<{ notifications: unknown[]; unread: number }>(await one.call("GET", "/v1/notifications"));

const listed = async (by: Person, id: string) => {
  const mine = await ok<{ communities: { communityId: string }[] }>(
    await by.call("GET", "/v1/me/communities"),
  );
  const all = await ok<{ communities: { communityId: string }[] }>(
    await by.call("GET", "/v1/communities"),
  );
  return [...mine.communities, ...all.communities].some((c) => c.communityId === id);
};

describe("deleting a community", () => {
  it("hides it and all it holds at once, for its members and its owner", async () => {
    const { owner, member, id, postId } = await scene();
    expect((await inbox(owner)).unread).toBe(1);
    const feed = await ok<{ posts: unknown[] }>(await member.call("GET", "/v1/feed"));
    expect(feed.posts).toHaveLength(1);

    expect(await status(owner, "DELETE", `/v1/communities/${id}`)).toBe(204);
    for (const one of [owner, member]) {
      expect(await status(one, "GET", `/v1/communities/${id}`)).toBe(404);
      expect(await status(one, "GET", `/v1/posts/${postId}`)).toBe(404);
      expect(await listed(one, id)).toBe(false);
      expect(await ok<{ posts: unknown[] }>(await one.call("GET", "/v1/feed"))).toMatchObject({
        posts: [],
      });
      expect(await status(one, "GET", `/v1/communities/${id}/moderation-log`)).toBe(404);
    }
    expect(await inbox(owner)).toMatchObject({ notifications: [], unread: 0 });
    // Deleting twice finds nothing.
    expect(await status(owner, "DELETE", `/v1/communities/${id}`)).toBe(404);
  });

  it("is the owner's or a platform moderator's, and only a platform moderator restores", async () => {
    const { owner, member, id, postId } = await scene();
    const platform = await platformModerator("Samtak");
    expect(await status(member, "DELETE", `/v1/communities/${id}`)).toBe(403);
    expect(await status(platform, "DELETE", `/v1/communities/${id}`)).toBe(204);

    const seen = await ok<{ deletedAt: number | null }>(
      await platform.call("GET", `/v1/communities/${id}`),
    );
    expect(seen.deletedAt).toEqual(expect.any(Number));
    expect(await status(owner, "POST", `/v1/communities/${id}/restore`)).toBe(404);
    expect(await status(member, "POST", `/v1/communities/${id}/restore`)).toBe(404);

    const restored = await ok<{ deletedAt: number | null; memberCount: number }>(
      await platform.call("POST", `/v1/communities/${id}/restore`),
    );
    expect(restored).toMatchObject({ deletedAt: null, memberCount: 2 });
    expect(await status(member, "GET", `/v1/posts/${postId}`)).toBe(200);
    expect((await inbox(owner)).unread).toBe(1);
    // A live one restores as it is; an owner who is no platform moderator may not.
    expect(await status(platform, "POST", `/v1/communities/${id}/restore`)).toBe(200);
    expect(await status(owner, "POST", `/v1/communities/${id}/restore`)).toBe(403);

    const log = await ok<{ entries: Entry[] }>(
      await platform.call("GET", `/v1/communities/${id}/moderation-log`),
    );
    expect(log.entries.map((e) => [e.action, e.actor?.accountId, e.asPlatform])).toEqual([
      ["restore_community", platform.accountId, true],
      ["delete_community", platform.accountId, true],
    ]);
  });

  it("closes its open reports, and keeps them and its log a year after the purge", async () => {
    const { owner, id, mediaId } = await scene();
    const platform = await platformModerator("Samtak");
    expect(await status(owner, "DELETE", `/v1/communities/${id}`)).toBe(204);
    const deletedAt = Date.now();
    const closed = async () =>
      (
        await ok<{ reports: Report[] }>(
          await platform.call("GET", `/v1/communities/${id}/reports?state=closed`),
        )
      ).reports;
    expect(await closed()).toEqual([
      expect.objectContaining({ state: "closed", decision: "community_deleted", resolution: "" }),
    ]);

    // Restorable for 30 days, then the content goes.
    await expire(deletedAt + 29 * DAY);
    expect(await env.PROFILES.head(`social/${id}/${mediaId}`)).not.toBeNull();
    await expire(deletedAt + 31 * DAY);
    expect(await env.PROFILES.head(`social/${id}/${mediaId}`)).toBeNull();
    const rows = async (table: string) =>
      (
        await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE community_id = ?`)
          .bind(id)
          .first<{ n: number }>()
      )?.n;
    for (const table of ["post_index", "social_media", "community_members", "notifications"]) {
      expect(await rows(table), table).toBe(0);
    }
    expect(await status(platform, "POST", `/v1/communities/${id}/restore`)).toBe(409);

    // The log and the reports stay, for a platform moderator alone.
    expect(await closed()).toHaveLength(1);
    const log = await ok<{ entries: Entry[] }>(
      await platform.call("GET", `/v1/communities/${id}/moderation-log`),
    );
    expect(log.entries.map((e) => [e.action, e.actor?.accountId, e.asPlatform])).toEqual([
      ["delete_community", owner.accountId, false],
    ]);
    expect(await status(owner, "GET", `/v1/communities/${id}/moderation-log`)).toBe(404);

    await expire(deletedAt + 364 * DAY);
    expect(await rows("moderation_log")).toBe(1);
    await expire(deletedAt + 366 * DAY);
    for (const table of ["moderation_log", "reports", "communities"]) {
      expect(await rows(table), table).toBe(0);
    }
    expect(await status(platform, "GET", `/v1/communities/${id}`)).toBe(404);
  });
});
