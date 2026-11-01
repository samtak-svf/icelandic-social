import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { platformModerator, ok, person, type Person } from "../../people.ts";
import { exported, jsonOf, readZip } from "../exports/support.ts";
import { befriend } from "../social/wall-support.ts";
import {
  drain,
  entry,
  get,
  MAY_2019,
  media,
  open,
  publish,
  sampleZip,
  status,
  upload,
  wall,
  type Read,
} from "./file-support.ts";

// What an import holds until the person opens it (decision 0127). The bug each test names:
// a held post read by anyone but its author, on any path, a moderator's included; a post
// out to an audience it was not given; opening what the person did not pick; and a held
// post that removal or the person's own export forgets.

const YEAR = 365 * 24 * 60 * 60;
const FROM_2019 = MAY_2019 / 1000;
const held = async (reader: Person, importId: string, query = "") =>
  (await get<{ posts: Read[] }>(reader, `/v1/imports/${importId}/held${query}`)).posts;
const count = async (accountId: string, table: string) =>
  (
    await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE account_id = ?`)
      .bind(accountId)
      .first<{ n: number }>()
  )?.n;

/** Own posts in 2019 and 2021, and a bare address in 2021. */
const MIXED = [
  entry(FROM_2019, "Frá 2019", media("posts/media/a.png")),
  entry(FROM_2019 + 2 * YEAR, "Frá 2021"),
  entry(FROM_2019 + 2 * YEAR + 60, "https://example.com/a"),
];

/** An owner with the mix brought in and nothing opened, and the friend who must not see it. */
async function holding() {
  const owner = await person("eigandi");
  const friend = await person("vinur");
  await befriend(owner, friend);
  const importId = await upload(owner, await sampleZip(MIXED));
  await publish(owner, importId, { classes: ["own", "link"] });
  return { owner, friend, importId };
}

describe("what an import holds", () => {
  it("reads to nobody but its author, on any path", async () => {
    const { owner, friend, importId } = await holding();
    const stranger = await person("okunnugur");
    const platform = await platformModerator("samtak");
    const [post] = await held(owner, importId, "?year=2019");
    const image = post!.media[0] as { mediaId: string };
    const path = `/v1/posts/${post!.postId}`;
    for (const reader of [friend, stranger, platform]) {
      expect(await wall(reader, owner)).toHaveLength(0);
      expect((await reader.call("GET", path)).status).toBe(404);
      expect((await reader.call("GET", `${path}/media/${image.mediaId}`)).status).toBe(404);
      expect((await reader.call("GET", `${path}/comments`)).status).toBe(404);
      const images = await get<{ images: unknown[] }>(
        reader,
        `/v1/accounts/${owner.accountId}/wall/images`,
      );
      expect(images.images).toHaveLength(0);
      const home = await get<{ posts: unknown[] }>(reader, "/v1/home");
      expect(home.posts).toHaveLength(0);
      expect(
        (
          await reader.call("POST", "/v1/reports", {
            target: { kind: "post", id: post!.postId },
            reason: "other",
          })
        ).status,
      ).toBe(404);
    }
  });

  it("is out of a moderator's reach", async () => {
    const { owner, importId } = await holding();
    const platform = await platformModerator("samtak");
    const [post] = await held(owner, importId);
    const acted = await platform.call("POST", `/v1/communities/${post!.communityId}/actions`, {
      reason: "Prófun",
      action: "hide_post",
      targetId: post!.postId,
    });
    expect(acted.status).toBe(404);
    expect(await held(owner, importId)).toHaveLength(3);
  });

  it("stays off the author's own wall and reads whole to them, directly and in review", async () => {
    const { owner, importId } = await holding();
    expect(await wall(owner, owner)).toHaveLength(0);
    const posts = await held(owner, importId);
    expect(posts.map((p) => p.body)).toEqual(["https://example.com/a", "Frá 2021", "Frá 2019"]);
    expect(posts.every((p) => (p as { state?: string }).state === "visible")).toBe(true);
    // Nobody reads it yet, so no audience is named on it.
    expect(posts.every((p) => (p as { audience?: string }).audience === undefined)).toBe(true);
    const direct = await ok<{ body: string }>(
      await owner.call("GET", `/v1/posts/${posts[2]!.postId}`),
    );
    expect(direct.body).toBe("Frá 2019");
    const image = posts[2]!.media[0] as { mediaId: string };
    const bytes = await owner.call("GET", `/v1/posts/${posts[2]!.postId}/media/${image.mediaId}`);
    expect(bytes.status).toBe(200);
    await bytes.arrayBuffer();
  });

  it("counts itself by kind and by year, and filters the review the same way", async () => {
    const { owner, importId } = await holding();
    const { held: groups } = await status(owner, importId);
    expect(groups.posts).toBe(3);
    expect(groups.groups).toEqual([
      { class: "link", year: 2021, posts: 1 },
      { class: "own", year: 2021, posts: 1 },
      { class: "own", year: 2019, posts: 1 },
    ]);
    expect((await held(owner, importId, "?class=link")).map((p) => p.body)).toEqual([
      "https://example.com/a",
    ]);
    expect((await held(owner, importId, "?year=2019")).map((p) => p.body)).toEqual(["Frá 2019"]);
    expect(await held(owner, importId, "?class=link&year=2019")).toHaveLength(0);
  });

  it("opens one kind, one year or all to the audience chosen, and no more", async () => {
    const { owner, friend, importId } = await holding();
    const stranger = await person("okunnugur");

    expect(await open(owner, importId, { class: "link" })).toBe(1);
    expect((await wall(friend, owner)).map((p) => p.body)).toEqual(["https://example.com/a"]);
    expect(await wall(stranger, owner)).toHaveLength(0);

    expect(await open(owner, importId, { year: 2019, audience: "everyone" })).toBe(1);
    expect((await wall(stranger, owner)).map((p) => p.body)).toEqual(["Frá 2019"]);

    expect(await open(owner, importId)).toBe(1);
    expect(await wall(friend, owner)).toHaveLength(3);
    expect(await wall(stranger, owner)).toHaveLength(1);

    expect((await status(owner, importId)).held).toEqual({ posts: 0, groups: [] });
    expect(await open(owner, importId)).toBe(0);
  });

  it("opens without a notification and stays out of the home feed", async () => {
    const owner = await person("eigandi");
    const friend = await person("vinur");
    await befriend(owner, friend);
    // Written an hour ago: an older post would be out of the feed's window whatever it was.
    const recent = entry(Math.floor(Date.now() / 1000) - 3600, "Nýleg");
    const importId = await upload(owner, await sampleZip([recent]));
    await publish(owner, importId);
    expect(await open(owner, importId)).toBe(1);
    expect((await wall(friend, owner)).map((p) => p.body)).toEqual(["Nýleg"]);
    const home = await get<{ posts: unknown[] }>(friend, "/v1/home");
    expect(home.posts).toHaveLength(0);
    expect(await count(friend.accountId, "notifications")).toBe(0);
  });

  it("is refused while posts are still coming in, and to anyone else", async () => {
    const owner = await person("eigandi");
    const other = await person("annar");
    const importId = await upload(owner, await sampleZip());
    const opening = { audience: "friends" };
    const early = await owner.call("POST", `/v1/imports/${importId}/open`, opening);
    expect(early.status).toBe(409);
    expect((await owner.call("POST", `/v1/imports/${importId}/publish`, {})).status).toBe(204);
    const during = await owner.call("POST", `/v1/imports/${importId}/open`, opening);
    expect(during.status).toBe(409);
    const theirs = await other.call("POST", `/v1/imports/${importId}/open`, opening);
    expect(theirs.status).toBe(404);
  });

  it("goes with the import's removal", async () => {
    const { owner, importId } = await holding();
    const [post] = await held(owner, importId);
    expect((await owner.call("DELETE", `/v1/imports/${importId}`)).status).toBe(204);
    await drain();
    expect((await owner.call("GET", `/v1/posts/${post!.postId}`)).status).toBe(404);
  });

  it("goes by the author's own delete, one post at a time", async () => {
    const { owner, importId } = await holding();
    const [post] = await held(owner, importId);
    expect((await owner.call("DELETE", `/v1/posts/${post!.postId}`)).status).toBe(204);
    expect((await status(owner, importId)).held.posts).toBe(2);
  });

  it("is in the person's own export, with its images, marked held", async () => {
    const { owner, importId } = await holding();
    const [post] = await held(owner, importId, "?year=2019");
    const zip = await readZip((await exported(owner)).exportId);
    const posts = jsonOf<{ id: string; state: string; images: string[] }[]>(
      zip,
      `spaces/${post!.communityId}/posts-0001.json`,
    );
    expect(posts.map((p) => p.state)).toEqual(["held", "held", "held"]);
    const carried = posts.find((p) => p.id === post!.postId);
    expect(carried?.images).toHaveLength(1);
    expect(zip.has(carried!.images[0]!)).toBe(true);
  });
});
