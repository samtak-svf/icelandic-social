import { describe, expect, it } from "vitest";
import { png } from "../../images.ts";
import { ok, person, type Person } from "../../people.ts";

// Every path to a community's content against every kind of account, in both
// audiences (decision 0063, #287). One table says what each kind gets; the
// test fails on the first cell that differs, naming it.

const KINDS = [
  "owner",
  "moderator",
  "member",
  "outsider",
  "banned",
  "blocked",
  "blockedModerator",
] as const;
type Kind = (typeof KINDS)[number];
type Audience = "open" | "private";

/** A community of `audience` with an author's post, image and comment, and one kind each. */
async function world(audience: Audience) {
  const owner = await person("Eigandi");
  const author = await person("Höfundur");
  const kinds: Record<Kind, Person> = {
    owner,
    moderator: await person("Stjórnandi"),
    member: await person("Meðlimur"),
    outsider: await person("Utangarðs"),
    banned: await person("Bannaður"),
    blocked: await person("Lokaður"),
    blockedModerator: await person("Lokaður stjórnandi"),
  };
  const { communityId } = await ok<{ communityId: string }>(
    await owner.call("POST", "/v1/communities", { name: "Prófunarfélag", audience }),
  );
  for (const one of [author, ...KINDS.filter((k) => k !== "owner").map((k) => kinds[k])]) {
    if (one === kinds.outsider) continue;
    if (audience === "private") {
      await owner.call("PUT", `/v1/communities/${communityId}/invitations/${one.accountId}`);
    }
    expect((await one.call("POST", `/v1/communities/${communityId}/join`)).status).toBe(200);
  }
  for (const one of [kinds.moderator, kinds.blockedModerator]) {
    const role = `/v1/communities/${communityId}/members/${one.accountId}/role`;
    expect((await owner.call("PUT", role, { role: "moderator" })).status).toBe(204);
  }
  const moderate = async (action: string, targetId: string) =>
    expect(
      (
        await owner.call("POST", `/v1/communities/${communityId}/actions`, {
          action,
          targetId,
          reason: "Prófun",
        })
      ).status,
    ).toBe(204);
  // A ban removes the member and keeps it out.
  await moderate("ban_member", kinds.banned.accountId);

  const { mediaId } = await ok<{ mediaId: string }>(
    await author.send(`/v1/communities/${communityId}/media`, await png(16, 16)),
  );
  const { postId } = await ok<{ postId: string }>(
    await author.call("POST", `/v1/communities/${communityId}/posts`, {
      body: "Póstur höfundar",
      media: [mediaId],
    }),
  );
  const { commentId } = await ok<{ commentId: string }>(
    await author.call("POST", `/v1/posts/${postId}/comments`, { body: "Athugasemd höfundar" }),
  );
  const removedComment = await ok<{ commentId: string }>(
    await author.call("POST", `/v1/posts/${postId}/comments`, { body: "Fjarlægð athugasemd" }),
  );
  await moderate("remove_comment", removedComment.commentId);
  const removed = await ok<{ postId: string }>(
    await author.call("POST", `/v1/communities/${communityId}/posts`, { body: "Fjarlægður" }),
  );
  await moderate("remove_post", removed.postId);
  for (const one of [kinds.blocked, kinds.blockedModerator]) {
    expect((await author.call("PUT", `/v1/blocks/${one.accountId}`)).status).toBe(204);
  }
  return {
    communityId,
    postId,
    mediaId,
    commentId,
    removedId: removed.postId,
    removedCommentId: removedComment.commentId,
    kinds,
  };
}
type World = Awaited<ReturnType<typeof world>>;

type Path = {
  name: string;
  call: (by: Person, w: World) => Promise<Response>;
  /** The status each kind gets, in each audience. */
  expect: (kind: Kind, audience: Audience) => number;
};

const moderating = (k: Kind) => k === "owner" || k === "moderator" || k === "blockedModerator";
const inside = (k: Kind) => moderating(k) || k === "member" || k === "blocked";

/** Reading the community: members, and anyone signed in to an open one; never the banned. */
const reads = (k: Kind, a: Audience) =>
  inside(k) || (k === "outsider" && a === "open") ? 200 : 404;
/** Reading the author's post: as reads, but a block hides it, except from a moderator. */
const readsPost = (k: Kind, a: Audience) => (k === "blocked" ? 404 : reads(k, a));
/** Adding to the community: members; one who may read but is no member is refused. */
const writes = (done: number) => (k: Kind, a: Audience) =>
  inside(k) ? done : reads(k, a) === 200 ? 403 : 404;
/** Replying to the author's post: as writes, but never across a block, a moderator's either. */
const writesOnPost = (done: number) => (k: Kind, a: Audience) => {
  if (readsPost(k, a) === 404) return 404;
  return k === "blockedModerator" ? 403 : writes(done)(k, a);
};

const PATHS: Path[] = [
  {
    name: "list the community's posts",
    call: (by, w) => by.call("GET", `/v1/communities/${w.communityId}/posts`),
    expect: reads,
  },
  {
    name: "get the post",
    call: (by, w) => by.call("GET", `/v1/posts/${w.postId}`),
    expect: readsPost,
  },
  {
    name: "list its comments",
    call: (by, w) => by.call("GET", `/v1/posts/${w.postId}/comments`),
    expect: readsPost,
  },
  {
    name: "get its image",
    call: (by, w) => by.call("GET", `/v1/posts/${w.postId}/media/${w.mediaId}`),
    expect: readsPost,
  },
  {
    name: "get the removed post",
    call: (by, w) => by.call("GET", `/v1/posts/${w.removedId}`),
    expect: (k) => (moderating(k) ? 200 : 404),
  },
  {
    // A moderator sees a removed post; nobody replies to one.
    name: "comment on the removed post",
    call: (by, w) => by.call("POST", `/v1/posts/${w.removedId}/comments`, { body: "Hæ" }),
    expect: (k) => (moderating(k) ? 403 : 404),
  },
  {
    // Only a moderator sees a removed comment; its author no longer deletes it.
    name: "delete the removed comment",
    call: (by, w) => by.call("DELETE", `/v1/comments/${w.removedCommentId}`),
    expect: (k, a) => (moderating(k) && readsPost(k, a) === 200 ? 403 : 404),
  },
  {
    name: "post",
    call: (by, w) => by.call("POST", `/v1/communities/${w.communityId}/posts`, { body: "Nýtt" }),
    expect: writes(200),
  },
  {
    name: "upload an image",
    call: async (by, w) => by.send(`/v1/communities/${w.communityId}/media`, await png(8, 8)),
    expect: writes(200),
  },
  {
    name: "comment",
    call: (by, w) => by.call("POST", `/v1/posts/${w.postId}/comments`, { body: "Hæ" }),
    expect: writesOnPost(200),
  },
  {
    name: "react",
    call: (by, w) => by.call("PUT", `/v1/posts/${w.postId}/reaction`, { kind: "like" }),
    expect: writesOnPost(204),
  },
  {
    // Only its author deletes a comment (a moderator removes it, #289).
    name: "delete the author's comment",
    call: (by, w) => by.call("DELETE", `/v1/comments/${w.commentId}`),
    expect: (k, a) => (readsPost(k, a) === 404 ? 404 : 403),
  },
  {
    name: "delete the author's post",
    call: (by, w) => by.call("DELETE", `/v1/posts/${w.postId}`),
    expect: (k, a) => (readsPost(k, a) === 404 ? 404 : 403),
  },
];

/**
 * Each case builds a world, then makes 91 table requests and the list reads in sequence: 1 s
 * locally, 2 s on a CI runner with coverage, and past vitest's default 5 s on a busy one.
 */
const table = { timeout: 20_000 };

describe("who reaches a community's content (decision 0063)", table, () => {
  for (const audience of ["open", "private"] as const) {
    it(`holds the table in a ${audience} community`, async () => {
      const w = await world(audience);
      const differs: string[] = [];
      for (const path of PATHS) {
        for (const kind of KINDS) {
          const status = (await path.call(w.kinds[kind], w)).status;
          const wanted = path.expect(kind, audience);
          if (status !== wanted) differs.push(`${path.name} as ${kind}: ${status}, not ${wanted}`);
        }
      }
      expect(differs).toEqual([]);

      // What a list shows follows the same rule as a single read.
      for (const kind of KINDS) {
        if (reads(kind, audience) !== 200) continue;
        const listed = await ok<{ posts: { postId: string }[] }>(
          await w.kinds[kind].call("GET", `/v1/communities/${w.communityId}/posts`),
        );
        const ids = listed.posts.map((p) => p.postId);
        expect(ids.includes(w.postId), kind).toBe(readsPost(kind, audience) === 200);
        expect(ids.includes(w.removedId), kind).toBe(false);
        if (readsPost(kind, audience) !== 200) continue;
        const comments = await ok<{ comments: { commentId: string; state: string }[] }>(
          await w.kinds[kind].call("GET", `/v1/posts/${w.postId}/comments`),
        );
        const shown = comments.comments.map((c) => c.commentId);
        expect(shown.includes(w.removedCommentId), kind).toBe(moderating(kind));
        const post = await ok<{ commentCount: number }>(
          await w.kinds[kind].call("GET", `/v1/posts/${w.postId}`),
        );
        expect(post.commentCount, kind).toBe(shown.length);
        const { cards } = await ok<{ cards: { kind: string }[] }>(
          await w.kinds[kind].call("POST", "/v1/cards", {
            refs: [
              { kind: "post", id: w.removedId },
              { kind: "comment", id: w.removedCommentId },
            ],
          }),
        );
        expect(
          cards.map((c) => c.kind),
          kind,
        ).toEqual(moderating(kind) ? ["post", "comment"] : ["unavailable", "unavailable"]);
      }
    });
  }
});
