import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { deleteAccount } from "../src/account-deletion.ts";
import { deleteUnattached } from "../src/modules/social/index.ts";
import { feed } from "../src/modules/social/posts.ts";
import { ascii, png } from "./images.ts";
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
type Comment = { commentId: string; body: string; author: { accountId: string } };

const post = (by: Person, communityId: string, body: string, media: string[] = []) =>
  by.call("POST", `/v1/communities/${communityId}/posts`, { body, media });

const posted = async (by: Person, communityId: string, body: string, media: string[] = []) =>
  ok<Post>(await post(by, communityId, body, media));

const feedOf = async (by: Person, query = "") =>
  ok<{ posts: Post[]; next: string | null }>(await by.call("GET", `/v1/feed${query}`));

const getPost = (by: Person, postId: string) => by.call("GET", `/v1/posts/${postId}`);

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

  it("a community removes its space and its images", async () => {
    const owner = await person("Eigandi");
    const id = await community(owner, "open");
    const { mediaId } = await ok<{ mediaId: string }>(
      await owner.send(`/v1/communities/${id}/media`, await png(20, 20)),
    );
    const { postId } = await posted(owner, id, "Síðasti", [mediaId]);
    expect((await owner.call("DELETE", `/v1/communities/${id}`)).status).toBe(204);
    expect((await getPost(owner, postId)).status).toBe(404);
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
