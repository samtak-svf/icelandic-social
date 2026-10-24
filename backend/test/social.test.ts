import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { deleteAccount } from "../src/account-deletion.ts";
import { communityLifecycle } from "../src/community-lifecycle.ts";
import { expireCommunities } from "../src/modules/communities/index.ts";
import { deleteUnattached } from "../src/modules/social/index.ts";
import { feed } from "../src/modules/social/posts.ts";
import { purgeRemoved } from "../src/modules/social/moderation.ts";
import { ascii, png } from "./images.ts";
import { REMOVED_KEPT_MS } from "../src/modules/social/do/space-schema.ts";
import { community, errorOf, ok, person, type Person } from "./people.ts";
import { euEnv } from "./support.ts";

// A community's content (decisions 0060, 0063, 0065): posts, comments,
// reactions, the feed within its D1 budget (#275), and the images of posts,
// validated and re-encoded.

const DAY_MS = 24 * 60 * 60 * 1000;

type Post = {
  postId: string;
  communityId: string;
  author: { accountId: string; name: string | null };
  body: string;
  media: { mediaId: string; width: number; height: number }[];
  reactions: { kind: string; count: number }[];
  myReaction: string | null;
  commentCount: number;
};
type Comment = {
  commentId: string;
  parentCommentId: string | null;
  body: string;
  author: { accountId: string; name: string | null };
  createdAt: number;
  state: string;
  media: { mediaId: string; width: number; height: number }[];
};

const post = (by: Person, communityId: string, body: string, media: string[] = []) =>
  by.call("POST", `/v1/communities/${communityId}/posts`, { body, media });

const posted = async (by: Person, communityId: string, body: string, media: string[] = []) =>
  ok<Post>(await post(by, communityId, body, media));

const feedOf = async (by: Person, query = "") =>
  ok<{ posts: Post[]; next: string | null }>(await by.call("GET", `/v1/feed${query}`));

const getPost = (by: Person, postId: string) => by.call("GET", `/v1/posts/${postId}`);

const comment = (by: Person, postId: string, body: string, parentCommentId?: string | null) =>
  by.call("POST", `/v1/posts/${postId}/comments`, {
    body,
    parentCommentId: parentCommentId ?? null,
  });

const commented = async (
  by: Person,
  postId: string,
  body: string,
  parentCommentId?: string | null,
) => ok<Comment>(await comment(by, postId, body, parentCommentId));

const commentsOf = async (by: Person, postId: string) =>
  ok<{ comments: Comment[]; next: string | null }>(
    await by.call("GET", `/v1/posts/${postId}/comments`),
  );

describe("posts", () => {
  it("are written by members, read by whoever may read the community", async () => {
    const [owner, member, outsider] = [
      await person("Eigandi"),
      await person("Meðlimur"),
      await person("Utangarðs"),
    ];
    const open = await community(owner, "open", member);
    const created = await posted(member, open, "Fyrsta uppskeran í ár");
    expect(created).toMatchObject({
      communityId: open,
      author: { accountId: member.accountId, name: "Meðlimur" },
      body: "Fyrsta uppskeran í ár",
      reactions: [],
      myReaction: null,
      commentCount: 0,
    });
    // An open community is read by any signed-in account, but only members post.
    expect((await ok<Post>(await getPost(outsider, created.postId))).body).toBe(
      "Fyrsta uppskeran í ár",
    );
    const refused = await post(outsider, open, "Má ég?");
    expect(refused.status).toBe(403);
    expect(await errorOf(refused)).toBe("not_a_member");
    const empty = await post(member, open, "   ");
    expect(empty.status).toBe(400);

    // A private one only by its members: to anyone else it is not there.
    const closed = await community(owner, "private", member);
    const secret = await posted(member, closed, "Aðeins fyrir okkur");
    expect((await getPost(outsider, secret.postId)).status).toBe(404);
    expect((await outsider.call("GET", `/v1/communities/${closed}/posts`)).status).toBe(404);
    expect((await post(outsider, closed, "Halló")).status).toBe(404);
    expect((await getPost(member, secret.postId)).status).toBe(200);
  });

  it("list newest first in pages, and only the author deletes one", async () => {
    const [owner, member] = [await person("Eigandi"), await person("Meðlimur")];
    const id = await community(owner, "open", member);
    const ids: string[] = [];
    for (const n of [1, 2, 3, 4, 5]) ids.push((await posted(member, id, `Póstur ${n}`)).postId);
    const first = await ok<{ posts: Post[]; next: string }>(
      await owner.call("GET", `/v1/communities/${id}/posts?limit=3`),
    );
    expect(first.posts.map((p) => p.body)).toEqual(["Póstur 5", "Póstur 4", "Póstur 3"]);
    const second = await ok<{ posts: Post[]; next: string | null }>(
      await owner.call("GET", `/v1/communities/${id}/posts?limit=3&before=${first.next}`),
    );
    expect(second.posts.map((p) => p.body)).toEqual(["Póstur 2", "Póstur 1"]);
    expect(second.next).toBeNull();

    const notTheirs = await owner.call("DELETE", `/v1/posts/${ids[0]}`);
    expect(notTheirs.status).toBe(403);
    expect(await errorOf(notTheirs)).toBe("not_author");
    expect((await member.call("DELETE", `/v1/posts/${ids[0]}`)).status).toBe(204);
    expect((await getPost(owner, ids[0]!)).status).toBe(404);
  });

  it("are hidden, with comments and reactions, across a block in either direction", async () => {
    const [owner, writer, blocker] = [
      await person("Eigandi"),
      await person("Skrifari"),
      await person("Lokari"),
    ];
    const id = await community(owner, "open", writer, blocker);
    const theirs = await posted(writer, id, "Skrifað af skrifara");
    const owners = await posted(owner, id, "Skrifað af eiganda");
    await writer.call("POST", `/v1/posts/${owners.postId}/comments`, { body: "Gott" });
    await writer.call("PUT", `/v1/posts/${owners.postId}/reaction`, { kind: "love" });
    await blocker.call("PUT", `/v1/blocks/${writer.accountId}`);

    expect((await getPost(blocker, theirs.postId)).status).toBe(404);
    const seen = await ok<Post>(await getPost(blocker, owners.postId));
    expect(seen).toMatchObject({ commentCount: 0, reactions: [] });
    const comments = await ok<{ comments: Comment[] }>(
      await blocker.call("GET", `/v1/posts/${owners.postId}/comments`),
    );
    expect(comments.comments).toEqual([]);
    expect((await feedOf(blocker)).posts.map((p) => p.postId)).not.toContain(theirs.postId);
    // The blocked side sees the same: a block hides both ways.
    const listed = await ok<{ posts: Post[] }>(
      await blocker.call("GET", `/v1/communities/${id}/posts`),
    );
    expect(listed.posts.map((p) => p.postId)).toEqual([owners.postId]);

    // The moderators see through a block (decision 0063).
    await owner.call("PUT", `/v1/blocks/${writer.accountId}`);
    expect((await getPost(owner, theirs.postId)).status).toBe(200);
    expect(await ok<Post>(await getPost(owner, owners.postId))).toMatchObject({ commentCount: 1 });
  });
});

describe("comments and reactions", () => {
  it("are added by members, paged oldest first, and deleted only by their author", async () => {
    const [owner, member, outsider] = [
      await person("Eigandi"),
      await person("Meðlimur"),
      await person("Utangarðs"),
    ];
    const id = await community(owner, "open", member);
    const { postId } = await posted(owner, id, "Hvað segið þið?");
    const added: Comment[] = [];
    for (const body of ["Eitt", "Tvö", "Þrjú"]) {
      added.push(
        await ok<Comment>(await member.call("POST", `/v1/posts/${postId}/comments`, { body })),
      );
    }
    expect(
      (await outsider.call("POST", `/v1/posts/${postId}/comments`, { body: "Ég" })).status,
    ).toBe(403);
    const first = await ok<{ comments: Comment[]; next: string }>(
      await outsider.call("GET", `/v1/posts/${postId}/comments?limit=2`),
    );
    expect(first.comments.map((c) => c.body)).toEqual(["Eitt", "Tvö"]);
    const rest = await ok<{ comments: Comment[]; next: string | null }>(
      await outsider.call("GET", `/v1/posts/${postId}/comments?limit=2&after=${first.next}`),
    );
    expect(rest).toMatchObject({ comments: [{ body: "Þrjú" }], next: null });

    expect((await owner.call("DELETE", `/v1/comments/${added[0]!.commentId}`)).status).toBe(403);
    expect((await member.call("DELETE", `/v1/comments/${added[0]!.commentId}`)).status).toBe(204);
    expect((await ok<Post>(await getPost(owner, postId))).commentCount).toBe(2);
  });

  it("are one per account, replaced by the next and removed on request", async () => {
    const [owner, a, b] = [await person("Eigandi"), await person("Anna"), await person("Bjarni")];
    const id = await community(owner, "open", a, b);
    const { postId } = await posted(owner, id, "Kjósið");
    await a.call("PUT", `/v1/posts/${postId}/reaction`, { kind: "like" });
    await b.call("PUT", `/v1/posts/${postId}/reaction`, { kind: "like" });
    await a.call("PUT", `/v1/posts/${postId}/reaction`, { kind: "wow" });
    expect(await ok<Post>(await getPost(a, postId))).toMatchObject({
      reactions: [
        { kind: "like", count: 1 },
        { kind: "wow", count: 1 },
      ],
      myReaction: "wow",
    });
    expect((await a.call("DELETE", `/v1/posts/${postId}/reaction`)).status).toBe(204);
    expect(await ok<Post>(await getPost(a, postId))).toMatchObject({
      reactions: [{ kind: "like", count: 1 }],
      myReaction: null,
    });
    const odd = await a.call("PUT", `/v1/posts/${postId}/reaction`, { kind: "angry" });
    expect(odd.status).toBe(400);
  });
});

describe("finding a post by its text (decision 0079)", () => {
  it("keeps only the posts whose text contains q, without case, in pages", async () => {
    const [owner, member] = [await person("Eigandi"), await person("Meðlimur")];
    const id = await community(owner, "open", member);
    const hit = await posted(member, id, "Þjóðlagasamkoma í febrúar");
    await posted(member, id, "Annað sem enginn leitar að");
    const otherHit = await posted(member, id, "Önnur þjóðlagasamkoma");
    const found = (q: string, after?: string) =>
      owner.call(
        "GET",
        `/v1/communities/${id}/posts?limit=1&q=${encodeURIComponent(q)}${after ? `&before=${after}` : ""}`,
      );

    const first = await ok<{ posts: Post[]; next: string }>(await found("þjóðlaga", undefined));
    expect(first.posts.map((p) => p.postId)).toEqual([otherHit.postId]);
    // A page named by the search, on the same cursor rules.
    const second = await ok<{ posts: Post[]; next: string | null }>(
      await found("þjóðlaga", first.next),
    );
    expect(second.posts.map((p) => p.postId)).toEqual([hit.postId]);
    expect(second.next).toBeNull();

    const none = await ok<{ posts: Post[]; next: string | null }>(
      await found("kemst ekkert", undefined),
    );
    expect(none).toEqual({ posts: [], next: null });
    // A search of what another account wrote too, and a page without one keeps everything.
    const theirs = await ok<{ posts: Post[]; next: string | null }>(
      await owner.call("GET", `/v1/communities/${id}/posts?q=samkoma í febrúar`),
    );
    expect(theirs.posts.map((p) => p.postId)).toEqual([hit.postId]);
    const plain = await ok<{ posts: Post[] }>(
      await owner.call("GET", `/v1/communities/${id}/posts`),
    );
    expect(plain.posts).toHaveLength(3);
  });

  it("hides the posts of a block and the community's private ones, a search same as not", async () => {
    const [owner, writer, blocker] = [
      await person("Eigandi"),
      await person("Skrifari"),
      await person("Lokari"),
    ];
    const id = await community(owner, "open", writer, blocker);
    await posted(writer, id, "þjóðleg athugasemd");
    await blocker.call("PUT", `/v1/blocks/${writer.accountId}`);
    const listed = await ok<{ posts: Post[]; next: string | null }>(
      await blocker.call("GET", `/v1/communities/${id}/posts?q=þjóð`),
    );
    expect(listed).toEqual({ posts: [], next: null });
  });
});

describe("comment replies (decision 0071)", () => {
  it("attach to a top-level comment only, and tell its author", async () => {
    const [owner, member, another] = [
      await person("Eigandi"),
      await person("Meðlimur"),
      await person("Útlagi af völdum tilfalla"),
    ];
    const id = await community(owner, "open", member, another);
    const { postId } = await posted(owner, id, "Hver styður?");
    const top = await commented(member, postId, "Ég");
    const reply = await commented(another, postId, "Og ég með", top.commentId);
    expect(reply).toMatchObject({
      parentCommentId: top.commentId,
      body: "Og ég með",
      author: { accountId: another.accountId },
      state: "visible",
    });
    // Every comment keeps its own parent in the list.
    const page = await commentsOf(another, postId);
    const byId = Object.fromEntries(page.comments.map((c) => [c.commentId, c]));
    expect(byId[reply.commentId]?.parentCommentId).toBe(top.commentId);
    expect(byId[top.commentId]?.parentCommentId).toBeNull();

    // A reply to a reply is refused, and so is a parent of another post or none.
    expect(await errorOf(await comment(member, postId, "Of djúpt", reply.commentId))).toBe(
      "invalid_parent_comment",
    );
    const elsewhere = await posted(member, id, "Annað spjall");
    expect((await comment(member, postId, "Rétt spjall", elsewhere.postId)).status).toBe(400);
    expect((await comment(member, postId, "Ekkert slíkt", "p_nothing")).status).toBe(400);
  });

  it("tell the parent comment's author, deduplicated with the post's author", async () => {
    const [author, reader] = [await person("Höfundur"), await person("Lesandi")];
    const stranger = await person("Þriðji");
    const id = await community(author, "open", reader, stranger);
    const { postId } = await posted(author, id, "Póstur");
    // Another's top-level comment: the reply tells the post's author and its own.
    const top = await commented(stranger, postId, "Fyrstur");
    const reply = await commented(reader, postId, "Vamos", top.commentId);
    const job = async (key: string) => {
      const row = await env.DB.prepare("SELECT kind, payload FROM jobs WHERE key = ?")
        .bind(key)
        .first<{ kind: string; payload: string }>();
      return row === null
        ? null
        : { kind: row.kind, payload: JSON.parse(row.payload) as { accountId: string } };
    };
    expect(await job(`comment:${reply.commentId}`)).toMatchObject({
      payload: { accountId: author.accountId },
    });
    expect(await job(`comment:${reply.commentId}:parent`)).toMatchObject({
      payload: { accountId: stranger.accountId },
    });

    // A reply to the post author's own comment tells the account once.
    const mine = await commented(author, postId, "Mitt eitt");
    const own = await commented(reader, postId, "Til þín", mine.commentId);
    expect(await job(`comment:${own.commentId}`)).toMatchObject({
      payload: { accountId: author.accountId },
    });
    expect(await job(`comment:${own.commentId}:parent`)).toBeNull();
  });

  it("keep a tombstone in place while the parent has a visible reply", async () => {
    const [owner, writer, reader] = [
      await person("Eigandi"),
      await person("Skrifari"),
      await person("Lesandi"),
    ];
    const id = await community(owner, "open", writer, reader);
    const { postId } = await posted(reader, id, "Kannabara");
    const top = await commented(writer, postId, "Fyrra yfirlit");
    const reply = await commented(reader, postId, "Fyrsta svar", top.commentId);

    // The author deletes its parent: the reader keeps the slot and the reply.
    await writer.call("DELETE", `/v1/comments/${top.commentId}`);
    const page = await commentsOf(reader, postId);
    expect(page.comments.map((c) => [c.state, c.body])).toEqual([
      ["removed", ""],
      ["visible", "Fyrsta svar"],
    ]);
    const tombstone = page.comments[0]!;
    expect(tombstone).toMatchObject({
      author: { accountId: "deleted", name: null },
      parentCommentId: null,
    });
    expect(tombstone.createdAt).toBe(top.createdAt);
    // The moderator still sees what stands: the blanked parent and its reply.
    expect((await commentsOf(owner, postId)).comments.map((c) => [c.commentId, c.state])).toEqual([
      [top.commentId, "removed"],
      [reply.commentId, "visible"],
    ]);
    // The post's comment count counts what a member can read (one reply).
    expect((await ok<Post>(await getPost(reader, postId))).commentCount).toBe(1);

    // When the last visible reply is deleted, the empty tombstone goes with it.
    await reader.call("DELETE", `/v1/comments/${reply.commentId}`);
    expect(await commentsOf(owner, postId)).toEqual({ comments: [], next: null });
  });

  it("leave no tombstone when nothing stands under the parent", async () => {
    const [owner, writer, reader] = [
      await person("Eigandi"),
      await person("Skrifari"),
      await person("Lesandi"),
    ];
    const id = await community(owner, "open", writer, reader);
    const { postId } = await posted(reader, id, "Aðeins yfirlit");
    const gone = await commented(writer, postId, "Fjarlægt yfirlit");
    await writer.call("DELETE", `/v1/comments/${gone.commentId}`);
    // A parent with no reply vanishes, as it always did (0065).
    expect(await commentsOf(reader, postId)).toEqual({ comments: [], next: null });
    // A reply under a moderator's hidden parent keeps its tombstone too.
    const under = await commented(writer, postId, "Fallið yfirlit");
    await commented(reader, postId, "Svar við fallnum", under.commentId);
    await owner.call("POST", `/v1/communities/${id}/actions`, {
      action: "hide_comment",
      targetId: under.commentId,
      reason: "Prófun",
    });
    const page = await commentsOf(reader, postId);
    expect(page.comments.map((c) => [c.state, c.body])).toEqual([
      ["removed", ""],
      ["visible", "Svar við fallnum"],
    ]);
  });
});

describe("the images of posts (decision 0065)", () => {
  it("are re-encoded to WebP no larger than 2048 a side, and shown to those who see the post", async () => {
    const [owner, outsider] = [await person("Eigandi"), await person("Utangarðs")];
    const id = await community(owner, "private");
    const media = await ok<{ mediaId: string; width: number; height: number }>(
      await owner.send(`/v1/communities/${id}/media`, await png(3000, 1500)),
    );
    expect(media).toMatchObject({ width: 2048, height: 1024 });
    const { postId } = await posted(owner, id, "", [media.mediaId]);
    const image = await owner.call("GET", `/v1/posts/${postId}/media/${media.mediaId}`);
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/webp");
    const info = await env.IMAGES.info(new Blob([await image.arrayBuffer()]).stream());
    expect(info).toMatchObject({ format: "image/webp", width: 2048, height: 1024 });
    expect((await outsider.call("GET", `/v1/posts/${postId}/media/${media.mediaId}`)).status).toBe(
      404,
    );

    // A post's images go with it.
    expect(await env.PROFILES.head(`social/${id}/${media.mediaId}`)).not.toBeNull();
    await owner.call("DELETE", `/v1/posts/${postId}`);
    expect(await env.PROFILES.head(`social/${id}/${media.mediaId}`)).toBeNull();
  });

  it("refuse what is not an image the server takes", async () => {
    const owner = await person("Eigandi");
    const id = await community(owner, "open");
    const svg = ascii(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>',
    );
    for (const body of [svg, ascii("%PDF-1.7 not an image"), new Uint8Array(64)]) {
      const refused = await owner.send(`/v1/communities/${id}/media`, body);
      expect(refused.status).toBe(400);
      expect(await errorOf(refused)).toBe("invalid_image");
    }
    const huge = await owner.send(
      `/v1/communities/${id}/media`,
      new Uint8Array(10 * 1024 * 1024 + 1),
    );
    expect(huge.status).toBe(413);
  });

  it("are taken by one post only, the uploader's, in the community they were uploaded to", async () => {
    const [owner, member] = [await person("Eigandi"), await person("Meðlimur")];
    const id = await community(owner, "open", member);
    const other = await community(owner, "open", member);
    const { mediaId } = await ok<{ mediaId: string }>(
      await member.send(`/v1/communities/${id}/media`, await png(20, 20)),
    );
    for (const [by, where] of [
      [owner, id],
      [member, other],
    ] as const) {
      const refused = await post(by, where, "Stolið", [mediaId]);
      expect(refused.status).toBe(400);
      expect(await errorOf(refused)).toBe("invalid_media");
    }
    await posted(member, id, "Mín mynd", [mediaId]);
    expect(await errorOf(await post(member, id, "Aftur", [mediaId]))).toBe("invalid_media");
  });

  it("not taken by a post within a day are deleted", async () => {
    const owner = await person("Eigandi");
    const id = await community(owner, "open");
    const { mediaId } = await ok<{ mediaId: string }>(
      await owner.send(`/v1/communities/${id}/media`, await png(20, 20)),
    );
    expect(await deleteUnattached(env, { now: Date.now() + DAY_MS / 2 })).toBe(0);
    expect(await deleteUnattached(env, { now: Date.now() + 2 * DAY_MS })).toBeGreaterThanOrEqual(1);
    expect(await env.PROFILES.head(`social/${id}/${mediaId}`)).toBeNull();
  });
});

describe("deleting", () => {
  it("an account removes its posts, comments, reactions and images everywhere", async () => {
    const [owner, leaver] = [await person("Eigandi"), await person("Fer")];
    const id = await community(owner, "open", leaver);
    const { mediaId } = await ok<{ mediaId: string }>(
      await leaver.send(`/v1/communities/${id}/media`, await png(20, 20)),
    );
    const theirs = await posted(leaver, id, "Bless", [mediaId]);
    const owners = await posted(owner, id, "Halló");
    await leaver.call("POST", `/v1/posts/${owners.postId}/comments`, { body: "Hæ" });
    await leaver.call("PUT", `/v1/posts/${owners.postId}/reaction`, { kind: "sad" });

    await deleteAccount(euEnv(env), leaver.accountId);
    expect((await getPost(owner, theirs.postId)).status).toBe(404);
    expect(await ok<Post>(await getPost(owner, owners.postId))).toMatchObject({
      commentCount: 0,
      reactions: [],
    });
    expect(await env.PROFILES.head(`social/${id}/${mediaId}`)).toBeNull();
    const indexed = await env.DB.prepare("SELECT COUNT(*) AS n FROM post_index WHERE author_id = ?")
      .bind(leaver.accountId)
      .first<{ n: number }>();
    expect(indexed?.n).toBe(0);
  });

  it("a community hides its posts at once, and its images go when it is purged", async () => {
    const owner = await person("Eigandi");
    const id = await community(owner, "open");
    const { mediaId } = await ok<{ mediaId: string }>(
      await owner.send(`/v1/communities/${id}/media`, await png(20, 20)),
    );
    const { postId } = await posted(owner, id, "Síðasti", [mediaId]);
    expect((await owner.call("DELETE", `/v1/communities/${id}`)).status).toBe(204);
    expect((await getPost(owner, postId)).status).toBe(404);
    // Restorable for 30 days (decision 0070).
    expect(await env.PROFILES.head(`social/${id}/${mediaId}`)).not.toBeNull();
    await expireCommunities(euEnv(env), communityLifecycle, Date.now() + 31 * DAY_MS);
    expect(await env.PROFILES.head(`social/${id}/${mediaId}`)).toBeNull();
  });
});

describe("the feed (#275)", () => {
  it("is the caller's communities' posts, newest first", async () => {
    const [owner, reader] = [await person("Eigandi"), await person("Lesandi")];
    const joined = await community(owner, "open", reader);
    const elsewhere = await community(owner, "open");
    const a = await posted(owner, joined, "Í mínu");
    await posted(owner, elsewhere, "Annars staðar");
    const b = await posted(owner, joined, "Aftur í mínu");
    const page = await feedOf(reader);
    expect(page.posts.map((p) => p.postId)).toEqual([b.postId, a.postId]);
  });

  it("reads within the measured budget, and its pages reach every post once", async () => {
    const reader = await person("Lesandi");
    const now = Date.now();
    const communities = Array.from({ length: 10 }, (_, n) => `cm_budget_${reader.accountId}_${n}`);
    const statements = communities.flatMap((communityId) => [
      env.DB.prepare(
        `INSERT INTO communities (community_id, name, name_key, description, audience, created_at)
         VALUES (?, 'Mæling', 'maeling', '', 'open', ?)`,
      ).bind(communityId, now - 301 * DAY_MS),
      env.DB.prepare(
        `INSERT INTO community_members (community_id, account_id, role, joined_at)
         VALUES (?, ?, 'member', ?)`,
      ).bind(communityId, reader.accountId, now - 301 * DAY_MS),
    ]);
    // 1500 posts over 300 days, spread over the ten communities.
    for (let n = 0; n < 1500; n++) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO post_index (post_id, community_id, author_id, created_at)
           VALUES (?, ?, ?, ?)`,
        ).bind(
          `p_budget_${reader.accountId}_${n}`,
          communities[n % 10]!,
          reader.accountId,
          now - Math.floor((n * 300 * DAY_MS) / 1500),
        ),
      );
    }
    await env.DB.batch(statements);

    const seen = new Set<string>();
    let before: string | undefined;
    let pages = 0;
    let most = 0;
    for (;;) {
      const page = await feed(env, reader.accountId, before, 30, now + 1);
      most = Math.max(most, page.rowsRead);
      for (const row of page.rows) {
        expect(seen.has(row.postId)).toBe(false);
        seen.add(row.postId);
      }
      pages++;
      if (page.next === null) break;
      before = page.next;
      expect(pages).toBeLessThan(200);
    }
    expect(seen.size).toBe(1500);
    expect(most).toBeLessThan(400);
  });
});

describe("the image of a comment (decision 0082)", () => {
  const upload = async (by: Person, communityId: string) =>
    (
      await ok<{ mediaId: string }>(
        await by.send(`/v1/communities/${communityId}/media`, await png(30, 20)),
      )
    ).mediaId;
  const withImage = (by: Person, postId: string, body: string, media: string[]) =>
    by.call("POST", `/v1/posts/${postId}/comments`, { body, media });
  const imageOf = (by: Person, postId: string, mediaId: string) =>
    by.call("GET", `/v1/posts/${postId}/media/${mediaId}`);
  const stored = async (communityId: string, mediaId: string) =>
    (await env.PROFILES.head(`social/${communityId}/${mediaId}`)) !== null;
  const rowOf = (mediaId: string) =>
    env.DB.prepare("SELECT post_id, comment_id FROM social_media WHERE media_id = ?")
      .bind(mediaId)
      .first<{ post_id: string | null; comment_id: string | null }>();
  const act = (by: Person, communityId: string, action: string, targetId: string) =>
    by.call("POST", `/v1/communities/${communityId}/actions`, {
      action,
      targetId,
      reason: "Prófun",
    });

  /** An owner, a member who comments with an image, and a reader, in one open community. */
  async function scene() {
    const [owner, member, reader] = [
      await person("Eigandi"),
      await person("Meðlimur"),
      await person("Lesandi"),
    ];
    const id = await community(owner, "open", member, reader);
    const { postId } = await posted(owner, id, "Færsla");
    const mediaId = await upload(member, id);
    const written = await ok<Comment>(await withImage(member, postId, "Mynd", [mediaId]));
    return { owner, member, reader, id, postId, mediaId, written };
  }

  it("is attached to the comment, listed with it and served to those who see the post", async () => {
    const { member, reader, id, postId, mediaId, written } = await scene();
    expect(written.media).toEqual([{ mediaId, width: 30, height: 20 }]);
    expect(await rowOf(mediaId)).toEqual({ post_id: postId, comment_id: written.commentId });
    for (const by of [member, reader]) {
      const [listed] = (await commentsOf(by, postId)).comments;
      expect(listed?.media).toEqual(written.media);
    }
    const image = await imageOf(reader, postId, mediaId);
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/webp");
    expect(await stored(id, mediaId)).toBe(true);
    const plain = await commented(member, postId, "Án myndar");
    expect(plain.media).toEqual([]);
  });

  it("makes an image-only comment, and still refuses one with neither text nor image", async () => {
    const { member, id, postId } = await scene();
    const mediaId = await upload(member, id);
    const only = await ok<Comment>(await withImage(member, postId, "", [mediaId]));
    expect(only).toMatchObject({ body: "", media: [{ mediaId }] });
    const empty = await withImage(member, postId, "", []);
    expect(empty.status).toBe(400);
    expect(await errorOf(empty)).toBe("invalid_request");
    expect((await member.call("POST", `/v1/posts/${postId}/comments`, { media: [] })).status).toBe(
      400,
    );
  });

  it("refuses more than one image, and one that is not the commenter's own, unattached and from the community", async () => {
    const { owner, member, id, postId } = await scene();
    const [a, b] = [await upload(member, id), await upload(member, id)];
    expect((await withImage(member, postId, "Tvær", [a, b])).status).toBe(400);
    const other = await community(owner, "open", member);
    const elsewhere = await upload(member, other);
    const theirs = await upload(owner, id);
    for (const media of [elsewhere, theirs, "sm_00000000000000000000000000000000"]) {
      const refused = await withImage(member, postId, "Stolið", [media]);
      expect(refused.status).toBe(400);
      expect(await errorOf(refused)).toBe("invalid_media");
    }
    await ok<Comment>(await withImage(member, postId, "Mín", [a]));
    expect(await errorOf(await withImage(member, postId, "Aftur", [a]))).toBe("invalid_media");
    // The same id twice is the post's rule too: one image, named twice, is refused.
    expect((await withImage(member, postId, "Tvisvar", [b, b])).status).toBe(400);
  });

  it("is not served to someone who cannot see the post", async () => {
    const owner = await person("Eigandi");
    const outsider = await person("Utangarðs");
    const id = await community(owner, "private");
    const { postId } = await posted(owner, id, "Lokað");
    const mediaId = await upload(owner, id);
    await ok<Comment>(await withImage(owner, postId, "Mynd", [mediaId]));
    expect((await imageOf(outsider, postId, mediaId)).status).toBe(404);
  });

  it("goes, row and object, when its author deletes the comment", async () => {
    const { member, reader, id, postId, mediaId, written } = await scene();
    expect((await member.call("DELETE", `/v1/comments/${written.commentId}`)).status).toBe(204);
    expect(await rowOf(mediaId)).toBeNull();
    expect(await stored(id, mediaId)).toBe(false);
    expect((await imageOf(reader, postId, mediaId)).status).toBe(404);
  });

  it("goes with the post when its author deletes it", async () => {
    const { owner, id, postId, mediaId } = await scene();
    expect((await owner.call("DELETE", `/v1/posts/${postId}`)).status).toBe(204);
    expect(await rowOf(mediaId)).toBeNull();
    expect(await stored(id, mediaId)).toBe(false);
  });

  it("is not served while a moderator has the comment hidden, and is again when it is shown", async () => {
    const { owner, reader, id, postId, mediaId, written } = await scene();
    expect((await act(owner, id, "hide_comment", written.commentId)).status).toBe(204);
    expect((await imageOf(reader, postId, mediaId)).status).toBe(404);
    expect((await imageOf(owner, postId, mediaId)).status).toBe(200);
    expect(await stored(id, mediaId)).toBe(true);
    expect((await act(owner, id, "restore_comment", written.commentId)).status).toBe(204);
    expect((await imageOf(reader, postId, mediaId)).status).toBe(200);
  });

  it("is not served once a moderator removes the comment, and is deleted by the purge REMOVED_KEPT_MS later", async () => {
    const { owner, reader, id, postId, mediaId, written } = await scene();
    expect((await act(owner, id, "remove_comment", written.commentId)).status).toBe(204);
    expect((await imageOf(reader, postId, mediaId)).status).toBe(404);
    expect((await imageOf(owner, postId, mediaId)).status).toBe(404);
    expect(await stored(id, mediaId)).toBe(true);
    await purgeRemoved(env, Date.now() + REMOVED_KEPT_MS - DAY_MS);
    expect(await stored(id, mediaId)).toBe(true);
    await purgeRemoved(env, Date.now() + REMOVED_KEPT_MS + DAY_MS);
    expect(await rowOf(mediaId)).toBeNull();
    expect(await stored(id, mediaId)).toBe(false);
  });

  it("a removed comment that is restored keeps its image out of the purge", async () => {
    const { owner, id, mediaId, written } = await scene();
    await act(owner, id, "remove_comment", written.commentId);
    await act(owner, id, "restore_comment", written.commentId);
    await purgeRemoved(env, Date.now() + REMOVED_KEPT_MS + DAY_MS);
    expect(await stored(id, mediaId)).toBe(true);
  });

  it("goes with the post when the post is removed and purged", async () => {
    const { owner, member, id, mediaId } = await scene();
    const { postId } = await posted(member, id, "Brottleg");
    const own = await upload(member, id);
    const written = await ok<Comment>(await withImage(member, postId, "Mynd", [own]));
    expect(written.media).toHaveLength(1);
    expect((await act(owner, id, "remove_post", postId)).status).toBe(204);
    await purgeRemoved(env, Date.now() + REMOVED_KEPT_MS + DAY_MS);
    expect(await rowOf(own)).toBeNull();
    expect(await stored(id, own)).toBe(false);
    expect(await stored(id, mediaId)).toBe(true);
  });

  it("goes when the community is purged", async () => {
    const { owner, id, mediaId } = await scene();
    expect((await owner.call("DELETE", `/v1/communities/${id}`)).status).toBeLessThan(300);
    await expireCommunities(euEnv(env), communityLifecycle, Date.now() + 400 * DAY_MS);
    expect(await rowOf(mediaId)).toBeNull();
    expect(await stored(id, mediaId)).toBe(false);
  });

  it("goes when its author's account is forgotten, in other people's posts too", async () => {
    const { owner, member, id, postId, mediaId } = await scene();
    await deleteAccount(euEnv(env), member.accountId);
    expect(await rowOf(mediaId)).toBeNull();
    expect(await stored(id, mediaId)).toBe(false);
    expect((await getPost(owner, postId)).status).toBe(200);
  });

  it("is shown to the moderator with a report on its comment", async () => {
    const { owner, reader, id, mediaId, written } = await scene();
    const target = { kind: "comment", id: written.commentId };
    expect((await reader.call("POST", "/v1/reports", { reason: "spam", target })).status).toBe(204);
    const { reports } = await ok<{ reports: { target: { id: string }; targetMedia: string[] }[] }>(
      await owner.call("GET", `/v1/communities/${id}/reports`),
    );
    expect(reports.find((r) => r.target.id === written.commentId)?.targetMedia).toEqual([mediaId]);
  });
});
