import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/api/common.ts";
import { device } from "./support.ts";
import { worker } from "./main.ts";

// Fljótið and the walls (decision 0034): posts every signed-in account reads,
// keyset pages newest first, one reaction per account, replies, and block
// (0024) applied by the server in both directions.

const BASE = "https://spjall.test";
const send = (method: string, path: string, auth: Record<string, string>, body?: unknown) =>
  worker.fetch(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json", ...auth },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const get = (path: string, auth: Record<string, string>) => send("GET", path, auth);
const errorOf = async (response: Response) => ApiError.parse(await response.json()).error;

type Device = Awaited<ReturnType<typeof device>>;
type Post = {
  postId: string;
  author: { accountId: string; name: string | null; verified: boolean };
  body: string;
  createdAt: number;
  replyCount: number;
  reactions: Record<string, number>;
  myReaction: string | null;
};
type Reply = { replyId: string; postId: string; author: { accountId: string }; body: string };
type PostPage = { posts: Post[]; next: string | null };

async function person(name: string, verified = false) {
  const seeded = await device();
  await env.DB.prepare("UPDATE accounts SET display_name = ?, verified = ? WHERE account_id = ?")
    .bind(name, verified ? 1 : 0, seeded.accountId)
    .run();
  return seeded;
}

async function write(by: Device, body: string): Promise<Post> {
  const response = await send("POST", "/v1/posts", by.auth, { body });
  expect(response.status).toBe(201);
  return (await response.json()) as Post;
}

async function reply(by: Device, postId: string, body: string): Promise<Reply> {
  const response = await send("POST", `/v1/posts/${postId}/replies`, by.auth, { body });
  expect(response.status).toBe(201);
  return (await response.json()) as Reply;
}

async function page(path: string, by: Device): Promise<PostPage> {
  const response = await get(path, by.auth);
  expect(response.status).toBe(200);
  return (await response.json()) as PostPage;
}

/** The ids of the posts by `authors` on the first page of the feed. */
async function feedOf(by: Device, ...authors: Device[]) {
  const ids = new Set(authors.map((a) => a.accountId));
  const { posts } = await page("/v1/feed?limit=50", by);
  return posts.filter((p) => ids.has(p.author.accountId)).map((p) => p.body);
}

const block = (blocker: Device, target: Device) =>
  send("PUT", `/v1/blocks/${target.accountId}`, blocker.auth);

describe("POST /v1/posts", () => {
  it("writes a post that Fljótið and the author's wall show, with its author", async () => {
    const alice = await person("Alísa Prófsdóttir", true);
    const reader = await person("Lesandi");
    const created = await write(alice, "Halló Fljót");
    expect(created).toMatchObject({
      postId: expect.stringMatching(/^post_/),
      author: { accountId: alice.accountId, name: "Alísa Prófsdóttir", verified: true },
      body: "Halló Fljót",
      replyCount: 0,
      reactions: { heart: 0, thumbs_up: 0, laugh: 0, wow: 0, sad: 0 },
      myReaction: null,
    });
    expect((await page("/v1/feed", reader)).posts[0]).toEqual(created);
    expect((await page(`/v1/accounts/${alice.accountId}/posts`, reader)).posts).toEqual([created]);
    expect(await (await get(`/v1/posts/${created.postId}`, reader.auth)).json()).toEqual(created);
  });

  it("takes 2000 characters, and refuses 2001 or a blank body", async () => {
    const alice = await person("A");
    await write(alice, "x".repeat(2000));
    for (const body of ["x".repeat(2001), "", "  \n "]) {
      const response = await send("POST", "/v1/posts", alice.auth, { body });
      expect(response.status).toBe(400);
      expect(await errorOf(response)).toBe("invalid_request");
    }
  });

  it("needs a device token, and a build at the floor", async () => {
    const alice = await person("A");
    expect((await send("POST", "/v1/posts", {}, { body: "x" })).status).toBe(401);
    const old = await send(
      "POST",
      "/v1/posts",
      { ...alice.auth, "spjall-client": "android/0.1.0" },
      {
        body: "x",
      },
    );
    expect(old.status).toBe(426);
  });
});

describe("paging", () => {
  it("walks a wall newest first, and a post made meanwhile does not shift the pages", async () => {
    const alice = await person("A");
    for (const n of [1, 2, 3, 4, 5]) await write(alice, `p${n}`);
    const wall = `/v1/accounts/${alice.accountId}/posts?limit=2`;
    const first = await page(wall, alice);
    expect(first.posts.map((p) => p.body)).toEqual(["p5", "p4"]);
    await write(alice, "p6");
    const second = await page(`${wall}&before=${first.next}`, alice);
    expect(second.posts.map((p) => p.body)).toEqual(["p3", "p2"]);
    const last = await page(`${wall}&before=${second.next}`, alice);
    expect(last.posts.map((p) => p.body)).toEqual(["p1"]);
    expect(last.next).toBeNull();
  });

  it("keeps the order posts came in, even within one millisecond", async () => {
    const alice = await person("A");
    vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2030, 0, 1));
    try {
      for (const n of [1, 2, 3, 4]) await write(alice, `same${n}`);
    } finally {
      vi.restoreAllMocks();
    }
    const wall = await page(`/v1/accounts/${alice.accountId}/posts`, alice);
    expect(wall.posts.map((p) => p.body)).toEqual(["same4", "same3", "same2", "same1"]);
  });

  it("refuses a cursor it did not make, and a limit out of range", async () => {
    const alice = await person("A");
    for (const query of [
      "before=not-a-cursor",
      `before=${btoa("12.x/y")}`,
      "limit=0",
      "limit=51",
    ]) {
      const response = await get(`/v1/feed?${query}`, alice.auth);
      expect(response.status).toBe(400);
    }
  });

  it("answers a wall of no account with 404", async () => {
    const alice = await person("A");
    expect((await get("/v1/accounts/acct_none/posts", alice.auth)).status).toBe(404);
  });
});

describe("reactions", () => {
  it("keeps one per account, replaceable, counted on the post", async () => {
    const [alice, bob, carol] = [await person("A"), await person("B"), await person("C")];
    const { postId } = await write(alice, "react");
    const react = (by: Device, reaction: string) =>
      send("PUT", `/v1/posts/${postId}/reaction`, by.auth, { reaction });
    expect((await react(bob, "heart")).status).toBe(204);
    expect((await react(carol, "heart")).status).toBe(204);
    expect((await react(bob, "laugh")).status).toBe(204);
    const seen = (await (await get(`/v1/posts/${postId}`, bob.auth)).json()) as Post;
    expect(seen.reactions).toEqual({ heart: 1, thumbs_up: 0, laugh: 1, wow: 0, sad: 0 });
    expect(seen.myReaction).toBe("laugh");
    expect((await send("DELETE", `/v1/posts/${postId}/reaction`, bob.auth)).status).toBe(204);
    expect((await send("DELETE", `/v1/posts/${postId}/reaction`, bob.auth)).status).toBe(204);
    const after = (await (await get(`/v1/posts/${postId}`, bob.auth)).json()) as Post;
    expect(after.reactions.laugh).toBe(0);
    expect(after.myReaction).toBeNull();
    expect((await react(bob, "angry")).status).toBe(400);
    expect(
      (await send("PUT", "/v1/posts/post_none/reaction", bob.auth, { reaction: "wow" })).status,
    ).toBe(404);
  });
});

describe("replies", () => {
  it("lists a post's replies oldest first, a page at a time, and counts them", async () => {
    const [alice, bob] = [await person("A"), await person("B")];
    const { postId } = await write(alice, "thread");
    for (const n of [1, 2, 3]) await reply(bob, postId, `r${n}`);
    const first = await get(`/v1/posts/${postId}/replies?limit=2`, alice.auth);
    const one = (await first.json()) as { replies: Reply[]; next: string | null };
    expect(one.replies.map((r) => r.body)).toEqual(["r1", "r2"]);
    const two = (await (
      await get(`/v1/posts/${postId}/replies?limit=2&after=${one.next}`, alice.auth)
    ).json()) as { replies: Reply[]; next: string | null };
    expect(two.replies.map((r) => r.body)).toEqual(["r3"]);
    expect(two.next).toBeNull();
    expect(((await (await get(`/v1/posts/${postId}`, alice.auth)).json()) as Post).replyCount).toBe(
      3,
    );
  });

  it("refuses a reply to no post, or a blank one", async () => {
    const alice = await person("A");
    expect(
      (await send("POST", "/v1/posts/post_none/replies", alice.auth, { body: "x" })).status,
    ).toBe(404);
    const { postId } = await write(alice, "x");
    expect(
      (await send("POST", `/v1/posts/${postId}/replies`, alice.auth, { body: " " })).status,
    ).toBe(400);
  });
});

describe("deleting", () => {
  it("lets only the author delete a post, which takes its replies and reactions", async () => {
    const [alice, bob] = [await person("A"), await person("B")];
    const { postId } = await write(alice, "gone");
    await reply(bob, postId, "answer");
    await send("PUT", `/v1/posts/${postId}/reaction`, bob.auth, { reaction: "wow" });
    const refused = await send("DELETE", `/v1/posts/${postId}`, bob.auth);
    expect(refused.status).toBe(403);
    expect(await errorOf(refused)).toBe("not_author");
    expect((await send("DELETE", `/v1/posts/${postId}`, alice.auth)).status).toBe(204);
    expect((await send("DELETE", `/v1/posts/${postId}`, alice.auth)).status).toBe(404);
    expect((await get(`/v1/posts/${postId}`, bob.auth)).status).toBe(404);
    for (const table of ["post_replies", "post_reactions"]) {
      const row = await env.DB.prepare(`SELECT count(*) AS n FROM ${table} WHERE post_id = ?`)
        .bind(postId)
        .first<{ n: number }>();
      expect(row?.n).toBe(0);
    }
  });

  it("lets only the author delete a reply", async () => {
    const [alice, bob] = [await person("A"), await person("B")];
    const { postId } = await write(alice, "x");
    const { replyId } = await reply(bob, postId, "mine");
    expect((await send("DELETE", `/v1/replies/${replyId}`, alice.auth)).status).toBe(403);
    expect((await send("DELETE", `/v1/replies/${replyId}`, bob.auth)).status).toBe(204);
    expect((await send("DELETE", `/v1/replies/${replyId}`, bob.auth)).status).toBe(404);
  });

  it("takes an account's posts, replies and reactions with the account", async () => {
    const [alice, bob] = [await person("A"), await person("B")];
    const { postId } = await write(alice, "theirs");
    const mine = await write(bob, "mine");
    await reply(bob, postId, "answer");
    await send("PUT", `/v1/posts/${postId}/reaction`, bob.auth, { reaction: "sad" });
    expect((await send("DELETE", "/v1/me", bob.auth)).status).toBe(204);
    expect((await get(`/v1/posts/${mine.postId}`, alice.auth)).status).toBe(404);
    const seen = (await (await get(`/v1/posts/${postId}`, alice.auth)).json()) as Post;
    expect(seen.replyCount).toBe(0);
    expect(seen.reactions.sad).toBe(0);
  });
});

describe("block (decision 0024)", () => {
  it("hides the blocked account's posts and replies from the blocker, not the other way", async () => {
    const [alice, mallory] = [await person("A"), await person("M")];
    const { postId } = await write(alice, "alice");
    const theirs = await write(mallory, "mallory");
    await reply(mallory, postId, "from mallory");
    expect((await block(alice, mallory)).status).toBe(204);

    expect(await feedOf(alice, alice, mallory)).toEqual(["alice"]);
    expect((await page(`/v1/accounts/${mallory.accountId}/posts`, alice)).posts).toEqual([]);
    expect((await get(`/v1/posts/${theirs.postId}`, alice.auth)).status).toBe(404);
    const thread = (await (await get(`/v1/posts/${postId}/replies`, alice.auth)).json()) as {
      replies: Reply[];
    };
    expect(thread.replies).toEqual([]);
    expect(((await (await get(`/v1/posts/${postId}`, alice.auth)).json()) as Post).replyCount).toBe(
      0,
    );

    // The blocked account still reads the blocker's posts.
    expect(await feedOf(mallory, alice, mallory)).toEqual(["mallory", "alice"]);
  });

  it("refuses the blocked account's replies and reactions to the blocker's posts", async () => {
    const [alice, mallory] = [await person("A"), await person("M")];
    const { postId } = await write(alice, "alice");
    await block(alice, mallory);
    const replied = await send("POST", `/v1/posts/${postId}/replies`, mallory.auth, { body: "x" });
    expect(replied.status).toBe(403);
    expect(await errorOf(replied)).toBe("blocked");
    const reacted = await send("PUT", `/v1/posts/${postId}/reaction`, mallory.auth, {
      reaction: "heart",
    });
    expect(reacted.status).toBe(403);
    expect(await errorOf(reacted)).toBe("blocked");
  });
});

describe("logs", () => {
  afterEach(() => vi.restoreAllMocks());

  it("carry ids, never a body or a name", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const alice = await person("Leynd Leyndardóttir");
    const { postId } = await write(alice, "Leyndarmál dagsins");
    await reply(alice, postId, "Annað leyndarmál");
    const lines = spy.mock.calls.map(([line]) => String(line));
    expect(lines.some((line) => line.includes("post.created") && line.includes(postId))).toBe(true);
    for (const line of lines) {
      expect(line).not.toContain("Leynd");
      expect(line).not.toContain("leyndarmál");
    }
  });
});
