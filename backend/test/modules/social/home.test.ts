import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { worker } from "../../main.ts";
import { community, errorOf, ok, person, type Person } from "../../people.ts";
import { home } from "../../../src/modules/social/home.ts";
import { readsHome } from "../../../src/modules/social/access.ts";
import { befriend, cast, unfriend, wallPost, type Audience } from "./wall-support.ts";

// The home feed (decision 0116). Access is the point: a friends-only post is
// never returned outside its audience, at any time, on any page. The bug each
// test names is a relation reading more than the decision grants, or a page
// quietly losing a post it should have reached.

const DAY = 24 * 60 * 60 * 1000;

type HomePost = {
  postId: string;
  communityId: string;
  body: string;
  wall?: { accountId: string };
  audience?: Audience;
  author: { name: string } | null;
};
type HomePage = { posts: HomePost[]; next: string | null };

const pageOf = async (by: Person, query = "") =>
  ok<HomePage>(await by.call("GET", `/v1/home${query}`));
const homeIds = async (by: Person) => (await pageOf(by)).posts.map((p) => p.postId);
const postIn = async (by: Person, communityId: string, body = "í hópnum") =>
  ok<{ postId: string }>(await by.call("POST", `/v1/communities/${communityId}/posts`, { body }));
const viewerOf = (account: string, hidden: string[] = []) => ({
  account,
  hidden,
  moderator: false,
});

type Who = "owner" | "friend" | "exFriend" | "stranger" | "blockedByOwner" | "blocksOwner";

const READS: [Who, Audience, boolean][] = [
  ["owner", "friends", true],
  ["owner", "everyone", true],
  ["friend", "friends", true],
  ["friend", "everyone", true],
  ["exFriend", "friends", false],
  ["exFriend", "everyone", false],
  ["stranger", "friends", false],
  ["stranger", "everyone", false],
  ["blockedByOwner", "friends", false],
  ["blockedByOwner", "everyone", false],
  ["blocksOwner", "friends", false],
  ["blocksOwner", "everyone", false],
];

describe("who reads a wall post in the home feed", () => {
  it.each(READS)("%s, a post for %s: %s", async (who, audience, reads) => {
    const people = await cast();
    const post = await wallPost(people.owner, audience);
    const response = await people[who].call("GET", "/v1/home");
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text.includes(post.postId)).toBe(reads);
    expect(text.includes("á veggnum")).toBe(reads);
  });

  it("is decided when it is read, not when it was written", async () => {
    const [owner, other] = [await person("eigandi"), await person("annar")];
    const post = await wallPost(owner, "friends");
    expect(await homeIds(other)).not.toContain(post.postId);
    await befriend(owner, other);
    expect(await homeIds(other)).toContain(post.postId);
    await unfriend(other, owner);
    expect(await homeIds(other)).not.toContain(post.postId);
  });

  it("goes the moment a block stands between friends, either way, and stays gone", async () => {
    for (const blocker of [0, 1]) {
      const [owner, friend] = [await person("eigandi"), await person("vinur")];
      await befriend(owner, friend);
      const post = await wallPost(owner, "friends");
      expect(await homeIds(friend)).toContain(post.postId);
      const [by, target] = blocker === 0 ? [owner, friend] : [friend, owner];
      await by.call("PUT", `/v1/blocks/${target.accountId}`);
      expect(await homeIds(friend)).not.toContain(post.postId);
      await by.call("DELETE", `/v1/blocks/${target.accountId}`);
      expect(await homeIds(friend)).not.toContain(post.postId);
    }
  });

  it("does not reach a friend's friend", async () => {
    const [owner, middle, far] = [
      await person("eigandi"),
      await person("milli"),
      await person("fjaer"),
    ];
    await befriend(owner, middle);
    await befriend(middle, far);
    const post = await wallPost(owner, "everyone");
    expect(await homeIds(middle)).toContain(post.postId);
    expect(await homeIds(far)).not.toContain(post.postId);
  });

  it("is gone with its author's account, for the friend who read it", async () => {
    const [owner, friend] = [await person("eigandi"), await person("vinur")];
    await befriend(owner, friend);
    const post = await wallPost(owner, "friends");
    expect(await homeIds(friend)).toContain(post.postId);
    expect((await owner.call("DELETE", "/v1/me")).status).toBeLessThan(300);
    expect(await homeIds(friend)).not.toContain(post.postId);
  });

  it("shows a wall post with its wall and audience", async () => {
    const [owner, friend] = [await person("eigandi"), await person("vinur")];
    await befriend(owner, friend);
    const made = await wallPost(owner, "friends", "til vina");
    const { posts } = await pageOf(friend);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      postId: made.postId,
      communityId: made.communityId,
      body: "til vina",
      wall: { accountId: owner.accountId },
      audience: "friends",
    });
  });
});

describe("the row check behind it", () => {
  const row = (over: Partial<Parameters<typeof readsHome>[0]>) => ({
    postId: "p",
    communityId: "c",
    authorId: "owner",
    createdAt: 1,
    state: "visible" as const,
    anonymous: 0,
    audience: "friends" as Audience | null,
    wallOwner: "owner" as string | null,
    friend: 1,
    imported: null,
    ...over,
  });

  it("reads a friend's post of either audience and the viewer's own", () => {
    expect(readsHome(row({}), viewerOf("me"))).toBe(true);
    expect(readsHome(row({ audience: "everyone" }), viewerOf("me"))).toBe(true);
    expect(readsHome(row({ friend: 0 }), viewerOf("owner"))).toBe(true);
  });

  it("refuses a friends-only post to anyone but a friend and its owner", () => {
    expect(readsHome(row({ friend: 0 }), viewerOf("me"))).toBe(false);
  });

  it("refuses a wall post that holds no audience", () => {
    expect(readsHome(row({ audience: null }), viewerOf("me"))).toBe(false);
  });

  it("refuses across a block, even to a friend", () => {
    expect(readsHome(row({}), viewerOf("me", ["owner"]))).toBe(false);
  });

  it("refuses a post with an audience that came through a community", () => {
    expect(readsHome(row({ wallOwner: null, friend: 0 }), viewerOf("me"))).toBe(false);
    expect(readsHome(row({ wallOwner: null, friend: 0, audience: null }), viewerOf("me"))).toBe(
      true,
    );
  });
});

describe("the three sources", () => {
  it("are the viewer's communities, friends and own wall, newest first", async () => {
    const [me, friend, owner] = [
      await person("eg"),
      await person("vinur"),
      await person("stofnandi"),
    ];
    await befriend(me, friend);
    const joined = await community(owner, "open", me);
    const a = await postIn(owner, joined, "eitt");
    const b = await wallPost(friend, "friends", "tvö");
    const c = await wallPost(me, "friends", "þrjú");
    const d = await postIn(owner, joined, "fjögur");
    const { posts } = await pageOf(me);
    expect(posts.map((p) => p.postId)).toEqual([d.postId, c.postId, b.postId, a.postId]);
    const inCommunity = posts.find((p) => p.postId === a.postId);
    expect(inCommunity).not.toHaveProperty("wall");
    expect(inCommunity).not.toHaveProperty("audience");
  });

  it("leave out a community the viewer is not in, open or not", async () => {
    const [me, owner] = [await person("eg"), await person("stofnandi")];
    const open = await postIn(owner, await community(owner, "open"));
    const closed = await postIn(owner, await community(owner, "private"));
    const ids = await homeIds(me);
    expect(ids).not.toContain(open.postId);
    expect(ids).not.toContain(closed.postId);
  });

  it("let go of a community the viewer left, or that was deleted", async () => {
    const [me, owner] = [await person("eg"), await person("stofnandi")];
    const left = await community(owner, "open", me);
    const deleted = await community(owner, "open", me);
    const one = await postIn(owner, left);
    const two = await postIn(owner, deleted);
    expect(await homeIds(me)).toEqual([two.postId, one.postId]);
    expect((await me.call("POST", `/v1/communities/${left}/leave`)).status).toBeLessThan(300);
    expect((await owner.call("DELETE", `/v1/communities/${deleted}`)).status).toBeLessThan(300);
    expect(await homeIds(me)).toEqual([]);
  });

  it("leave out a blocked author's community post, either way", async () => {
    for (const blocker of [0, 1]) {
      const [me, owner, author] = [
        await person("eg"),
        await person("stofnandi"),
        await person("hofundur"),
      ];
      const id = await community(owner, "open", me, author);
      const post = await postIn(author, id);
      expect(await homeIds(me)).toContain(post.postId);
      const [by, target] = blocker === 0 ? [me, author] : [author, me];
      await by.call("PUT", `/v1/blocks/${target.accountId}`);
      expect(await homeIds(me)).not.toContain(post.postId);
    }
  });

  it("leave a blocked author out in the statement, so a page still fills", async () => {
    // Not friends: a block between friends also takes the wall out of the sources.
    const [me, owner, author] = [
      await person("eg"),
      await person("stofnandi"),
      await person("hofundur"),
    ];
    await postIn(author, await community(owner, "open", me, author));
    await me.call("PUT", `/v1/blocks/${author.accountId}`);
    // No hidden list here: only the statement can have left the post out.
    const { rows } = await home(env, viewerOf(me.accountId), undefined, 30, false);
    expect(rows).toEqual([]);
  });

  it("leave a blocked person's comment off a post the viewer still reads", async () => {
    const [me, owner, other] = [
      await person("eg"),
      await person("stofnandi"),
      await person("annar"),
    ];
    const post = await postIn(owner, await community(owner, "open", me, other));
    expect(
      (await other.call("POST", `/v1/posts/${post.postId}/comments`, { body: "svar" })).status,
    ).toBe(200);
    const shown = (await pageOf(me)).posts[0] as HomePost & { latestComment: unknown };
    expect(shown.latestComment).not.toBeNull();
    await me.call("PUT", `/v1/blocks/${other.accountId}`);
    const hidden = (await pageOf(me)).posts[0] as HomePost & { latestComment: unknown };
    expect(hidden.postId).toBe(post.postId);
    expect(hidden.latestComment).toBeNull();
  });

  it("hold a removed post only for a client that knows a tombstone", async () => {
    const [me, friend] = [await person("eg"), await person("vinur")];
    await befriend(me, friend);
    const post = await wallPost(friend, "friends");
    await env.DB.prepare("UPDATE post_index SET state = 'removed' WHERE post_id = ?")
      .bind(post.postId)
      .run();
    const viewer = viewerOf(me.accountId);
    expect((await home(env, viewer, undefined, 30, false)).rows).toEqual([]);
    const known = await home(env, viewer, undefined, 30, true);
    expect(known.rows.map((r) => r.postId)).toEqual([post.postId]);
    expect(known.rows[0]).not.toHaveProperty("wallOwner");
    expect(known.rows[0]).not.toHaveProperty("friend");
  });
});

describe("a snooze", () => {
  const snoozed = async () => {
    const [me, friend, owner] = [
      await person("eg"),
      await person("vinur"),
      await person("stofnandi"),
    ];
    await befriend(me, friend);
    const id = await community(owner, "open", me, friend);
    const onWall = await wallPost(friend, "friends");
    const inCommunity = await postIn(friend, id);
    expect((await me.call("PUT", `/v1/snoozes/${friend.accountId}`)).status).toBe(200);
    return { me, friend, owner, id, onWall, inCommunity };
  };

  it("hides a person's posts from the home feed, wall and community", async () => {
    const { me, onWall, inCommunity } = await snoozed();
    const ids = await homeIds(me);
    expect(ids).not.toContain(onWall.postId);
    expect(ids).not.toContain(inCommunity.postId);
  });

  it("is not a friend's to notice, and leaves their own feed as it was", async () => {
    const { me, friend, onWall } = await snoozed();
    const mine = await wallPost(me, "friends");
    const ids = await homeIds(friend);
    expect(ids).toContain(mine.postId);
    expect(ids).toContain(onWall.postId);
  });

  it("ends when it is lifted", async () => {
    const { me, friend, onWall } = await snoozed();
    expect((await me.call("DELETE", `/v1/snoozes/${friend.accountId}`)).status).toBe(204);
    expect(await homeIds(me)).toContain(onWall.postId);
  });

  it("ends at its time, before any sweep has run", async () => {
    const { me, friend, onWall } = await snoozed();
    await env.DB.prepare(
      "UPDATE person_snoozes SET until = ? WHERE account_id = ? AND target_id = ?",
    )
      .bind(Date.now() - 1, me.accountId, friend.accountId)
      .run();
    expect(await homeIds(me)).toContain(onWall.postId);
  });

  it("does not hide an anonymous post, which would name its author", async () => {
    const { me, inCommunity } = await snoozed();
    await env.DB.prepare("UPDATE post_index SET anonymous = 1 WHERE post_id = ?")
      .bind(inCommunity.postId)
      .run();
    const { posts } = await pageOf(me);
    const post = posts.find((p) => p.postId === inCommunity.postId);
    expect(post).toBeDefined();
    expect(post?.author).toBeNull();
  });

  it("does not touch /v1/feed", async () => {
    const { me, inCommunity } = await snoozed();
    const feed = await ok<HomePage>(await me.call("GET", "/v1/feed"));
    expect(feed.posts.map((p) => p.postId)).toContain(inCommunity.postId);
  });
});

describe("the window", () => {
  /** Index rows `ages` days old on `communityId`, which `home` reads without their content. */
  const indexed = (communityId: string, author: string, ages: number[], now: number) =>
    ages.map((age, n) =>
      env.DB.prepare(
        "INSERT INTO post_index (post_id, community_id, author_id, created_at) VALUES (?, ?, ?, ?)",
      ).bind(`p_${communityId}_${n}`, communityId, author, now - age * DAY),
    );
  /** A community made `age` days ago with `reader` in it. */
  const space = (communityId: string, reader: string, age: number, now: number) => [
    env.DB.prepare(
      `INSERT INTO communities (community_id, name, name_key, description, audience, created_at)
       VALUES (?1, ?1, ?1, '', 'open', ?2)`,
    ).bind(communityId, now - age * DAY),
    env.DB.prepare(
      `INSERT INTO community_members (community_id, account_id, role, joined_at)
       VALUES (?, ?, 'member', ?)`,
    ).bind(communityId, reader, now - age * DAY),
  ];
  /** Every page to the end. */
  const follow = async (account: string, limit: number, now: number) => {
    const pages: Awaited<ReturnType<typeof home>>[] = [];
    let before: string | undefined;
    for (;;) {
      const page = await home(env, viewerOf(account), before, limit, false, now);
      pages.push(page);
      if (page.next === null) return pages;
      before = page.next;
      expect(pages.length).toBeLessThan(300);
    }
  };

  it("reads one statement when a day fills the page, and keeps its width", async () => {
    const me = await person("eg");
    const now = Date.now();
    const id = `cm_full_${me.accountId}`;
    await env.DB.batch([
      ...space(id, me.accountId, 40, now),
      ...indexed(id, me.accountId, [0.1, 0.2, 0.3, 0.4], now),
    ]);
    const page = await home(env, viewerOf(me.accountId), undefined, 3, false, now);
    expect(page.rows).toHaveLength(3);
    expect(page.statements).toBe(1);
    expect(page.next).toMatch(/^1\.\d+-p_/);
  });

  it("widens through 4, 16 and 30 days, carried in the cursor", async () => {
    const me = await person("eg");
    const now = Date.now();
    const id = `cm_wide_${me.accountId}`;
    await env.DB.batch([
      ...space(id, me.accountId, 400, now),
      ...indexed(id, me.accountId, [300], now),
    ]);
    const seen: string[] = [];
    let before: string | undefined;
    for (let n = 0; n < 4; n++) {
      const page = await home(env, viewerOf(me.accountId), before, 5, false, now);
      expect(page.rows).toEqual([]);
      seen.push(page.next?.split(".")[0] ?? "end");
      before = page.next ?? undefined;
    }
    // 1 and 4 on the first page, 16 and 30 on the second, then 30 at a time.
    expect(seen).toEqual(["16", "30", "30", "30"]);
    const first = await home(env, viewerOf(me.accountId), undefined, 5, false, now);
    expect(first.next).toBe(`16.${now - 5 * DAY}`);
    const second = await home(env, viewerOf(me.accountId), first.next ?? undefined, 5, false, now);
    expect(second.next).toBe(`30.${now - 51 * DAY}`);
  });

  it("keeps a widened window for the pages after it", async () => {
    const me = await person("eg");
    const now = Date.now();
    const id = `cm_kept_${me.accountId}`;
    await env.DB.batch([
      ...space(id, me.accountId, 400, now),
      ...indexed(id, me.accountId, [10, 10.1, 10.2, 10.3], now),
    ]);
    const first = await home(env, viewerOf(me.accountId), undefined, 3, false, now);
    expect(first.rows).toEqual([]);
    const second = await home(env, viewerOf(me.accountId), first.next ?? "", 3, false, now);
    expect(second.rows).toHaveLength(3);
    expect(second.next).toMatch(/^16\.\d+-p_/);
  });

  it("makes at most three statements on any page, and reaches every post once", async () => {
    const me = await person("eg");
    const now = Date.now();
    const ids = Array.from({ length: 10 }, (_, n) => `cm_all_${me.accountId}_${n}`);
    const statements = ids.flatMap((id) => space(id, me.accountId, 301, now));
    const ages = Array.from({ length: 600 }, (_, n) => (n * 300) / 600);
    for (const [n, id] of ids.entries()) {
      statements.push(
        ...indexed(
          id,
          me.accountId,
          ages.filter((_, at) => at % 10 === n),
          now,
        ),
      );
    }
    await env.DB.batch(statements);
    const pages = await follow(me.accountId, 30, now + 1);
    const read = pages.flatMap((page) => page.rows.map((r) => r.postId));
    expect(new Set(read).size).toBe(600);
    expect(read).toHaveLength(600);
    const times = pages.flatMap((page) => page.rows.map((r) => r.createdAt));
    expect(times).toEqual(times.toSorted((a, b) => b - a));
    for (const page of pages) {
      expect(page.statements).toBeLessThanOrEqual(3);
      expect(page.rowsRead).toBeLessThan(1000);
      expect(page.rows.length).toBeLessThanOrEqual(30);
    }
  });

  it("stops at once for an account with nothing", async () => {
    const me = await person("eg");
    const page = await home(env, viewerOf(me.accountId), undefined, 30, false);
    expect(page).toMatchObject({ rows: [], next: null });
    expect(page.statements).toBeLessThanOrEqual(3);
  });

  it("stops when no source is older than what it has read", async () => {
    const me = await person("eg");
    const now = Date.now();
    const id = `cm_young_${me.accountId}`;
    await env.DB.batch([
      ...space(id, me.accountId, 3, now),
      ...indexed(id, me.accountId, [2], now),
    ]);
    const page = await home(env, viewerOf(me.accountId), undefined, 30, false, now);
    expect(page.rows).toHaveLength(1);
    expect(page.next).toBeNull();
  });

  it("reaches a friend's post older than the friendship", async () => {
    const [me, friend] = [await person("eg"), await person("vinur")];
    const now = Date.now();
    const post = await wallPost(friend, "friends");
    // The wall and its post are older than the friendship, which starts today.
    await env.DB.batch([
      env.DB.prepare("UPDATE post_index SET created_at = ? WHERE post_id = ?").bind(
        now - 200 * DAY,
        post.postId,
      ),
      env.DB.prepare("UPDATE communities SET created_at = ? WHERE community_id = ?").bind(
        now - 201 * DAY,
        post.communityId,
      ),
    ]);
    await befriend(me, friend);
    const pages = await follow(me.accountId, 30, now);
    expect(pages.flatMap((page) => page.rows.map((r) => r.postId))).toEqual([post.postId]);
  });

  it("reaches the viewer's own post from long before anything else", async () => {
    const me = await person("eg");
    const now = Date.now();
    const post = await wallPost(me, "friends");
    await env.DB.batch([
      env.DB.prepare("UPDATE post_index SET created_at = ? WHERE post_id = ?").bind(
        now - 200 * DAY,
        post.postId,
      ),
      env.DB.prepare("UPDATE communities SET created_at = ? WHERE community_id = ?").bind(
        now - 201 * DAY,
        post.communityId,
      ),
    ]);
    const pages = await follow(me.accountId, 30, now);
    expect(pages.flatMap((page) => page.rows.map((r) => r.postId))).toEqual([post.postId]);
  });

  it("goes on past a day of the same instant without losing a post", async () => {
    const me = await person("eg");
    const now = Date.now();
    const id = `cm_tie_${me.accountId}`;
    await env.DB.batch([
      ...space(id, me.accountId, 40, now),
      ...indexed(id, me.accountId, [0.5, 0.5, 0.5, 0.5, 0.5], now),
    ]);
    const pages = await follow(me.accountId, 2, now);
    const read = pages.flatMap((page) => page.rows.map((r) => r.postId));
    expect(new Set(read).size).toBe(5);
    expect(read).toHaveLength(5);
  });
});

describe("the route", () => {
  it("answers only a signed-in account", async () => {
    const response = await worker.fetch("https://spjall.test/v1/home");
    expect(response.status).toBe(401);
  });

  it.each([
    "?before=2.1000",
    "?before=1000",
    "?before=31.1000",
    "?before=1.",
    "?limit=0",
    "?limit=31",
  ])("refuses %s", async (query) => {
    const me = await person("eg");
    const response = await me.call("GET", `/v1/home${query}`);
    expect(response.status).toBe(400);
    expect(await errorOf(response)).toBe("invalid_request");
  });

  it("gives thirty posts when asked for none, and follows its own cursor", async () => {
    const [me, friend] = [await person("eg"), await person("vinur")];
    await befriend(me, friend);
    for (let n = 0; n < 31; n++) await wallPost(friend, "friends", `póstur ${n}`);
    const first = await pageOf(me);
    expect(first.posts).toHaveLength(30);
    expect(first.next).not.toBeNull();
    const second = await pageOf(me, `?before=${encodeURIComponent(first.next ?? "")}`);
    expect(second.posts).toHaveLength(1);
  });
});

describe("/v1/feed", () => {
  it("stays byte for byte what installed apps read", async () => {
    const [owner, friend] = [await person("Eigandi"), await person("Vinur")];
    await befriend(owner, friend);
    const id = await community(owner, "open", friend);
    const post = await ok<Record<string, unknown>>(
      await owner.call("POST", `/v1/communities/${id}/posts`, { body: "Halló" }),
    );
    // None of these three may enter the feed: 0116 adds them to /v1/home alone.
    await wallPost(owner, "friends");
    await wallPost(owner, "everyone");
    await wallPost(friend, "friends");
    const response = await friend.call("GET", "/v1/feed");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(
      `{"posts":[{"postId":"${String(post.postId)}",` +
        `"author":{"accountId":"${owner.accountId}","name":"Eigandi","verified":true,` +
        `"photo":null,"role":"owner"},` +
        `"body":"Halló","media":[],"createdAt":${String(post.createdAt)},` +
        `"reactions":[],"myReaction":null,"emojis":[],"myEmoji":null,` +
        `"commentCount":0,"latestComment":null,"anonymous":false,"communityId":"${id}",` +
        `"mine":false,"state":"visible","pinned":false}],"next":null}`,
    );
    const empty = await (await person("Einn")).call("GET", "/v1/feed");
    expect(await empty.text()).toBe('{"posts":[],"next":null}');
  });
});
