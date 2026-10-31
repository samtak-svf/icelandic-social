import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { png } from "../../images.ts";
import { worker } from "../../main.ts";
import { community, ok, person, platformModerator, type Person } from "../../people.ts";
import {
  befriend,
  cast,
  type Audience,
  unfriend,
  wallPost,
  type WallPage,
  type WallPost,
} from "./wall-support.ts";

// Who reads a wall post is decided at read time from its audience, the friendship
// and the block (decision 0115). The bug each row names: a relation reading more,
// or less, than the decision grants it, on any way to the post.

type Who = "owner" | "friend" | "exFriend" | "stranger" | "blockedByOwner" | "blocksOwner";

const READS: [Who, Audience, boolean][] = [
  ["owner", "friends", true],
  ["owner", "everyone", true],
  ["friend", "friends", true],
  ["friend", "everyone", true],
  ["exFriend", "friends", false],
  ["exFriend", "everyone", true],
  ["stranger", "friends", false],
  ["stranger", "everyone", true],
  ["blockedByOwner", "friends", false],
  ["blockedByOwner", "everyone", false],
  ["blocksOwner", "friends", false],
  ["blocksOwner", "everyone", false],
];

describe("who reads a wall post", () => {
  it.each(READS)("%s on a %s post reads it: %s", async (who, audience, reads) => {
    const people = await cast();
    const post = await wallPost(people.owner, audience);
    const viewer = people[who];

    const one = await viewer.call("GET", `/v1/posts/${post.postId}`);
    expect(one.status).toBe(reads ? 200 : 404);

    const comments = await viewer.call("GET", `/v1/posts/${post.postId}/comments`);
    expect(comments.status).toBe(reads ? 200 : 404);

    // The list says the same, and a block answers as though no one were there.
    const list = await viewer.call("GET", `/v1/accounts/${people.owner.accountId}/wall/posts`);
    if (who === "blockedByOwner" || who === "blocksOwner") {
      expect(list.status).toBe(404);
    } else {
      const { posts } = await ok<WallPage>(list);
      expect(posts.map((p) => p.postId)).toEqual(reads ? [post.postId] : []);
    }
  });

  it.each(READS)("%s on a %s post may comment and react: %s", async (who, audience, reads) => {
    const people = await cast();
    const post = await wallPost(people.owner, audience);
    const viewer = people[who];
    const comment = await viewer.call("POST", `/v1/posts/${post.postId}/comments`, { body: "Já" });
    expect(comment.status).toBe(reads ? 200 : 404);
    const reaction = await viewer.call("PUT", `/v1/posts/${post.postId}/reaction`, {
      emoji: "👍",
    });
    expect(reaction.status === 200 || reaction.status === 204).toBe(reads);
  });

  it("carries every field of a post, and whose wall it is and who reads it", async () => {
    const owner = await person("eigandi");
    const post = await wallPost(owner, "everyone");
    expect(post.wall).toEqual({ accountId: owner.accountId });
    expect(post.audience).toBe("everyone");
    const read = await ok<WallPost & Record<string, unknown>>(
      await owner.call("GET", `/v1/posts/${post.postId}`),
    );
    expect(read.wall).toEqual({ accountId: owner.accountId });
    expect(read.audience).toBe("everyone");
    for (const key of ["author", "body", "media", "commentCount", "createdAt", "state"]) {
      expect(read, key).toHaveProperty(key);
    }
  });

  it("applies a changed audience at the next read, and only its author changes it", async () => {
    const owner = await person("eigandi");
    const stranger = await person("okunnugur");
    const post = await wallPost(owner, "friends");
    const path = `/v1/posts/${post.postId}`;
    expect((await stranger.call("GET", path)).status).toBe(404);
    expect(
      (await stranger.call("PATCH", `${path}/audience`, { audience: "everyone" })).status,
    ).toBe(404);
    expect((await owner.call("PATCH", `${path}/audience`, { audience: "everyone" })).status).toBe(
      204,
    );
    expect((await stranger.call("GET", path)).status).toBe(200);
  });

  it("takes a friend's reading away the moment they stop being friends", async () => {
    const owner = await person("eigandi");
    const friend = await person("vinur");
    await befriend(owner, friend);
    const post = await wallPost(owner, "friends");
    const path = `/v1/posts/${post.postId}`;
    expect((await friend.call("GET", path)).status).toBe(200);
    await unfriend(owner, friend);
    expect((await friend.call("GET", path)).status).toBe(404);
  });

  it("leaves an ex-friend's comment there, and theirs to delete by its id", async () => {
    const owner = await person("eigandi");
    const friend = await person("vinur");
    await befriend(owner, friend);
    const post = await wallPost(owner, "friends");
    const { commentId } = await ok<{ commentId: string }>(
      await friend.call("POST", `/v1/posts/${post.postId}/comments`, { body: "Já" }),
    );
    await unfriend(owner, friend);
    const stranger = await person("okunnugur");
    expect((await stranger.call("DELETE", `/v1/comments/${commentId}`)).status).toBe(404);
    const { comments } = await ok<{ comments: { commentId: string }[] }>(
      await owner.call("GET", `/v1/posts/${post.postId}/comments`),
    );
    expect(comments.map((c) => c.commentId)).toEqual([commentId]);
    expect((await friend.call("DELETE", `/v1/comments/${commentId}`)).status).toBe(204);
  });

  it("gives a member of any community, and its moderator, nothing on a wall", async () => {
    const owner = await person("eigandi");
    const moderator = await person("stjornandi");
    const communityId = await community(moderator, "open");
    const post = await wallPost(owner, "friends");
    expect(communityId).not.toBe(post.communityId);
    expect((await moderator.call("GET", `/v1/posts/${post.postId}`)).status).toBe(404);
  });

  it("answers a wall's id on the community routes as no such community", async () => {
    const owner = await person("eigandi");
    const post = await wallPost(owner, "everyone");
    const base = `/v1/communities/${post.communityId}`;
    for (const by of [owner, await person("okunnugur")]) {
      expect((await by.call("GET", base)).status).toBe(404);
      expect((await by.call("GET", `${base}/posts`)).status).toBe(404);
      expect((await by.call("GET", `${base}/images`)).status).toBe(404);
      expect((await by.call("POST", `${base}/posts`, { body: "x" })).status).toBe(404);
      expect((await by.call("POST", `${base}/join`)).status).toBe(404);
    }
  });

  it("answers a card on a wall post or comment as unavailable, even to its owner", async () => {
    const owner = await person("eigandi");
    const post = await wallPost(owner, "everyone");
    const { commentId } = await ok<{ commentId: string }>(
      await owner.call("POST", `/v1/posts/${post.postId}/comments`, { body: "Já" }),
    );
    const { cards } = await ok<{ cards: { kind: string }[] }>(
      await owner.call("POST", "/v1/cards", {
        refs: [
          { kind: "post", id: post.postId },
          { kind: "comment", id: commentId },
        ],
      }),
    );
    expect(cards.map((c) => c.kind)).toEqual(["unavailable", "unavailable"]);
  });
});

describe("a wall in the feed and the hub", () => {
  it("is in neither, for its owner, a friend or anyone", async () => {
    const owner = await person("eigandi");
    const friend = await person("vinur");
    await befriend(owner, friend);
    const open = await wallPost(owner, "everyone");
    const closed = await wallPost(owner, "friends");
    for (const by of [owner, friend, await person("okunnugur")]) {
      const feed = await ok<{ posts: { postId: string }[] }>(await by.call("GET", "/v1/feed"));
      const ids = feed.posts.map((p) => p.postId);
      expect(ids).not.toContain(open.postId);
      expect(ids).not.toContain(closed.postId);
      const hub = await by.call("GET", "/v1/communities");
      expect(hub.status).toBe(200);
      expect(await hub.text()).not.toContain(open.communityId);
    }
  });

  it("leaves a community's post with neither wall nor audience", async () => {
    const owner = await person("eigandi");
    const communityId = await community(owner, "open");
    const made = await ok<{ postId: string }>(
      await owner.call("POST", `/v1/communities/${communityId}/posts`, { body: "Halló" }),
    );
    await wallPost(owner, "everyone");
    const { posts } = await ok<{ posts: Record<string, unknown>[] }>(
      await owner.call("GET", "/v1/feed"),
    );
    const mine = posts.find((p) => p.postId === made.postId);
    expect(mine).toBeDefined();
    expect(mine).not.toHaveProperty("wall");
    expect(mine).not.toHaveProperty("audience");
  });
});

describe("a bio", () => {
  const profile = async (viewer: Person, owner: Person) =>
    viewer.call("GET", `/v1/accounts/${owner.accountId}/wall`);

  it("is read by any signed-in account, a block excepted", async () => {
    const people = await cast();
    expect((await people.owner.call("PUT", "/v1/me/bio", { bio: "Smiður" })).status).toBe(204);
    for (const who of ["owner", "friend", "exFriend", "stranger"] as const) {
      const read = await ok<{ bio: string | null; joinedMonth: string }>(
        await profile(people[who], people.owner),
      );
      expect(read.bio).toBe("Smiður");
      expect(read.joinedMonth).toMatch(/^\d{4}-\d{2}$/);
    }
    for (const who of ["blockedByOwner", "blocksOwner"] as const) {
      expect((await profile(people[who], people.owner)).status).toBe(404);
    }
  });

  it.each([
    ["120 characters, counted as code points", "😀".repeat(120), 204],
    ["121 characters", "a".repeat(121), 400],
    ["a line break", "a\nb", 400],
    ["an empty text, which clears it", "", 204],
  ])("%s", async (_, bio, status) => {
    const owner = await person("eigandi");
    expect((await owner.call("PUT", "/v1/me/bio", { bio })).status).toBe(status);
  });

  it("is refused to a suspended account, with its posts on the wall", async () => {
    const owner = await person("eigandi");
    const platform = await platformModerator("Vettvangur");
    const suspended = await platform.call("POST", "/v1/moderation/actions", {
      action: "suspend_account",
      targetId: owner.accountId,
      reason: "Prófun",
    });
    expect(suspended.status).toBe(204);
    expect((await owner.call("PUT", "/v1/me/bio", { bio: "x" })).status).toBe(403);
    expect((await owner.call("POST", "/v1/wall/posts", { body: "x" })).status).toBe(403);
  });
});

describe("a cover", () => {
  const setCover = async (owner: Person) =>
    worker.fetch("https://spjall.test/v1/wall/cover", {
      method: "PUT",
      headers: { ...owner.auth, "content-type": "application/octet-stream" },
      body: await png(1600, 600),
    });

  it("is read by any signed-in account, a block excepted, and goes when removed", async () => {
    const people = await cast();
    const { owner } = people;
    expect((await setCover(owner)).status).toBe(200);
    const path = `/v1/accounts/${owner.accountId}/wall/cover`;
    for (const who of ["owner", "friend", "stranger"] as const) {
      expect((await people[who].call("GET", path)).status).toBe(200);
    }
    for (const who of ["blockedByOwner", "blocksOwner"] as const) {
      expect((await people[who].call("GET", path)).status).toBe(404);
    }
    expect((await owner.call("DELETE", "/v1/wall/cover")).status).toBe(204);
    expect((await people.friend.call("GET", path)).status).toBe(404);
  });

  it("makes the wall, with no name in its row", async () => {
    const owner = await person("eigandi");
    expect((await setCover(owner)).status).toBe(200);
    const row = await env.DB.prepare(
      `SELECT c.community_id AS id, c.name, c.name_key AS nameKey, c.description, c.kind
         FROM walls w JOIN communities c USING (community_id) WHERE w.account_id = ?`,
    )
      .bind(owner.accountId)
      .first<{ id: string; name: string; nameKey: string; description: string; kind: string }>();
    expect(row).toEqual({
      id: row?.id,
      name: row?.id,
      nameKey: row?.id,
      description: row?.id,
      kind: "wall",
    });
  });
});

describe("a wall's images", () => {
  it("are only those of the posts the viewer reads", async () => {
    const owner = await person("eigandi");
    const stranger = await person("okunnugur");
    const upload = async () =>
      ok<{ mediaId: string }>(
        await worker.fetch("https://spjall.test/v1/wall/media", {
          method: "POST",
          headers: { ...owner.auth, "content-type": "application/octet-stream" },
          body: await png(40, 30),
        }),
      );
    const shared = await upload();
    const closed = await upload();
    const post = (media: string, audience: Audience) =>
      owner.call("POST", "/v1/wall/posts", { media: [media], audience });
    expect((await post(shared.mediaId, "everyone")).status).toBe(200);
    expect((await post(closed.mediaId, "friends")).status).toBe(200);
    const path = `/v1/accounts/${owner.accountId}/wall/images`;
    const ids = async (by: Person) =>
      (await ok<{ images: { mediaId: string }[] }>(await by.call("GET", path))).images.map(
        (i) => i.mediaId,
      );
    expect(await ids(stranger)).toEqual([shared.mediaId]);
    expect((await ids(owner)).toSorted()).toEqual([shared.mediaId, closed.mediaId].toSorted());
  });
});

describe("deleting an account", () => {
  it("purges its wall, the comments on it and the name out of everything", async () => {
    const owner = await person("eigandi");
    const friend = await person("vinur");
    await befriend(owner, friend);
    const post = await wallPost(owner, "everyone");
    await friend.call("POST", `/v1/posts/${post.postId}/comments`, { body: "Já" });
    expect((await owner.call("PUT", "/v1/me/bio", { bio: "Smiður" })).status).toBe(204);
    expect((await owner.call("DELETE", "/v1/me")).status).toBe(204);

    expect((await friend.call("GET", `/v1/posts/${post.postId}`)).status).toBe(404);
    const walls = await env.DB.prepare("SELECT 1 FROM walls WHERE community_id = ?")
      .bind(post.communityId)
      .all();
    expect(walls.results).toEqual([]);
    const row = await env.DB.prepare(
      "SELECT purged_at AS purgedAt, name FROM communities WHERE community_id = ?",
    )
      .bind(post.communityId)
      .first<{ purgedAt: number | null; name: string }>();
    expect(row?.purgedAt).not.toBeNull();
    expect(row?.name).toBe(post.communityId);
    const bio = await env.DB.prepare("SELECT bio FROM accounts WHERE account_id = ?")
      .bind(owner.accountId)
      .first<{ bio: string | null }>();
    expect(bio?.bio ?? null).toBeNull();
  });
});
