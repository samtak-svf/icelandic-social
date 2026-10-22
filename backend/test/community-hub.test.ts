import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { communitiesOf } from "../src/modules/communities/communities.ts";
import { community, errorOf, ok, person, type Person } from "./people.ts";

// The server half of the community hub (decision 0080): unread counts and pins
// of communities answered from D1, the post pinned to the top of a community,
// and the 👍 on a comment.

type Hub = {
  communityId: string;
  unread: number;
  lastPostAt: number | null;
  pinned: boolean;
};
type Post = { postId: string; pinned: boolean; body: string };
type Comment = { commentId: string; likes: number; liked: boolean };

const mine = async (by: Person) =>
  (await ok<{ communities: Hub[] }>(await by.call("GET", "/v1/me/communities"))).communities;

const hubOf = async (by: Person, communityId: string) => {
  const found = (await mine(by)).find((c) => c.communityId === communityId);
  if (!found) throw new Error("the community is not in the list");
  return found;
};

const posted = async (by: Person, communityId: string, body = "Póstur") =>
  ok<Post>(await by.call("POST", `/v1/communities/${communityId}/posts`, { body }));

const pageOf = async (by: Person, communityId: string, query = "") =>
  ok<{ posts: Post[]; next: string | null }>(
    await by.call("GET", `/v1/communities/${communityId}/posts${query}`),
  );

const pinPost = (by: Person, communityId: string, postId: string) =>
  by.call("PUT", `/v1/communities/${communityId}/posts/${postId}/pin`);
const unpinPost = (by: Person, communityId: string, postId: string) =>
  by.call("DELETE", `/v1/communities/${communityId}/posts/${postId}/pin`);

describe("unread on the hub", () => {
  it("counts the posts of others since the reader opened the feed", async () => {
    const [owner, member] = [await person("Eigandi"), await person("Meðlimur")];
    const id = await community(owner, "open", member);
    // The author's own fresh community has nothing unread, nor does its first post.
    expect(await hubOf(owner, id)).toMatchObject({ unread: 0, lastPostAt: null, pinned: false });
    await posted(owner, id);
    expect((await hubOf(owner, id)).unread).toBe(0);
    // The member never opened the feed, so all of it is unread.
    expect((await hubOf(member, id)).unread).toBe(1);
    await pageOf(member, id);
    expect((await hubOf(member, id)).unread).toBe(0);
    for (const n of [1, 2, 3]) await posted(owner, id, `Fleiri ${n}`);
    const after = await hubOf(member, id);
    expect(after.unread).toBe(3);
    expect(after.lastPostAt).toBeGreaterThan(0);
    // A later page, and a search, are not opening the feed.
    await pageOf(member, id, "?before=1");
    await pageOf(member, id, "?q=Fleiri");
    expect((await hubOf(member, id)).unread).toBe(3);
    await pageOf(member, id);
    expect((await hubOf(member, id)).unread).toBe(0);
    // A post made while the reader is up to date is not unread to its author.
    await posted(member, id, "Mitt");
    expect((await hubOf(member, id)).unread).toBe(0);
    expect((await hubOf(owner, id)).unread).toBe(1);
  });

  it("is read from D1 alone: the list never asks a space", async () => {
    const owner = await person("Eigandi");
    const id = await community(owner, "open");
    await posted(owner, id);
    // A namespace that throws on any use stands for every Durable Object.
    const noSpaces = new Proxy(env.SPACE, {
      get(_target, property) {
        throw new Error(`the list asked a space: ${String(property)}`);
      },
    });
    const list = await communitiesOf({ ...env, SPACE: noSpaces }, owner.accountId);
    expect(list.map((c) => c.communityId)).toEqual([id]);
  });

  it("hides the last post of a private community from an outsider", async () => {
    const [owner, outsider] = [await person("Eigandi"), await person("Utangarðs")];
    const id = await community(owner, "private");
    await posted(owner, id);
    expect((await hubOf(owner, id)).lastPostAt).not.toBeNull();
    const view = await ok<Hub>(await outsider.call("GET", `/v1/communities/${id}`));
    expect(view).toMatchObject({ unread: 0, lastPostAt: null });
  });
});

describe("pinning a community", () => {
  it("is the caller's own, ordered by when it was pinned, and refused when unreadable", async () => {
    const [owner, reader] = [await person("Eigandi"), await person("Lesandi")];
    const [a, b, c] = [
      await community(owner, "open", reader),
      await community(owner, "open", reader),
      await community(owner, "open", reader),
    ];
    const order = async () => (await mine(reader)).map((x) => x.communityId);
    const plain = await order();
    expect(new Set(plain)).toEqual(new Set([a, b, c]));
    const pin = (id: string) => reader.call("PUT", `/v1/communities/${id}/pin`);
    expect((await pin(c)).status).toBe(204);
    expect((await pin(a)).status).toBe(204);
    // Pinning again keeps the first pin's place.
    expect((await pin(c)).status).toBe(204);
    const pinned = await order();
    expect(pinned.slice(0, 2)).toEqual([c, a]);
    expect(pinned[2]).toBe(b);
    expect((await mine(reader)).map((x) => x.pinned)).toEqual([true, true, false]);
    // The pin is the reader's: the owner's list is as it was.
    expect((await mine(owner)).every((x) => !x.pinned)).toBe(true);
    expect((await reader.call("DELETE", `/v1/communities/${c}/pin`)).status).toBe(204);
    expect((await reader.call("DELETE", `/v1/communities/${c}/pin`)).status).toBe(204);
    expect((await order()).slice(0, 1)).toEqual([a]);
    expect((await mine(reader)).find((x) => x.communityId === c)?.pinned).toBe(false);

    const hidden = await community(owner, "private");
    const outsider = await person("Utangarðs");
    for (const method of ["PUT", "DELETE"]) {
      const refused = await outsider.call(method, `/v1/communities/${hidden}/pin`);
      expect(refused.status).toBe(404);
      expect(await errorOf(refused)).toBe("not_found");
    }
    expect((await outsider.call("PUT", "/v1/communities/c_nope/pin")).status).toBe(404);
  });
});

describe("pinning a post", () => {
  const logOf = async (by: Person, communityId: string) =>
    (
      await ok<{ entries: { action: string; target: { id: string } }[] }>(
        await by.call("GET", `/v1/communities/${communityId}/moderation-log`),
      )
    ).entries;

  it("is done by a moderator, one post at a time, with a log entry each way", async () => {
    const [owner, moderator, member] = [
      await person("Eigandi"),
      await person("Umsjón"),
      await person("Meðlimur"),
    ];
    const id = await community(owner, "open", moderator, member);
    await owner.call("PUT", `/v1/communities/${id}/members/${moderator.accountId}/role`, {
      role: "moderator",
    });
    const first = await posted(member, id, "Fyrst");
    const second = await posted(member, id, "Annað");
    const third = await posted(member, id, "Þriðja");

    const refused = await pinPost(member, id, first.postId);
    expect(refused.status).toBe(403);
    expect(await errorOf(refused)).toBe("not_permitted");
    expect((await pageOf(member, id)).posts.some((p) => p.pinned)).toBe(false);

    expect((await pinPost(moderator, id, first.postId)).status).toBe(204);
    // The pinned post leads the first page, flagged, and appears once.
    const page = await pageOf(member, id);
    expect(page.posts.map((p) => p.postId)).toEqual([first.postId, third.postId, second.postId]);
    expect(page.posts.map((p) => p.pinned)).toEqual([true, false, false]);
    const single = await ok<Post>(await member.call("GET", `/v1/posts/${first.postId}`));
    expect(single.pinned).toBe(true);
    // A later page does not repeat it.
    const later = await pageOf(member, id, `?before=${Date.now() + 1000}-zzz`);
    expect(later.posts.map((p) => p.postId)).not.toContain(first.postId);

    // Pinning it again changes and logs nothing; a second pin replaces the first.
    expect((await pinPost(owner, id, first.postId)).status).toBe(204);
    expect((await pinPost(moderator, id, second.postId)).status).toBe(204);
    expect((await pageOf(member, id)).posts.map((p) => p.pinned)).toEqual([true, false, false]);
    expect((await pageOf(member, id)).posts[0]?.postId).toBe(second.postId);

    // Unpinning a post that is not the pinned one does nothing.
    expect((await unpinPost(moderator, id, first.postId)).status).toBe(204);
    expect((await pageOf(member, id)).posts[0]?.pinned).toBe(true);
    expect((await unpinPost(member, id, second.postId)).status).toBe(403);
    expect((await unpinPost(moderator, id, second.postId)).status).toBe(204);
    expect((await pageOf(member, id)).posts.some((p) => p.pinned)).toBe(false);

    const log = (await logOf(owner, id)).filter((e) => e.action.endsWith("pin_post"));
    expect(log.map((e) => `${e.action} ${e.target.id}`).sort()).toEqual(
      [
        `pin_post ${first.postId}`,
        `pin_post ${second.postId}`,
        `unpin_post ${second.postId}`,
      ].sort(),
    );
  });

  it("is cleared when the pinned post is removed, hidden or deleted", async () => {
    const [owner, member, outsider] = [
      await person("Eigandi"),
      await person("Meðlimur"),
      await person("Utangarðs"),
    ];
    const id = await community(owner, "open", member);
    const lost = await posted(member, id, "Fjarlægð");
    await pinPost(owner, id, lost.postId);
    const act = await owner.call("POST", `/v1/communities/${id}/actions`, {
      action: "remove_post",
      targetId: lost.postId,
      reason: "Prófun",
    });
    expect(act.status).toBe(204);
    expect((await pageOf(member, id)).posts.some((p) => p.pinned)).toBe(false);
    // Restoring it does not bring the pin back.
    await owner.call("POST", `/v1/communities/${id}/actions`, {
      action: "restore_post",
      targetId: lost.postId,
      reason: "Prófun",
    });
    expect((await pageOf(member, id)).posts.some((p) => p.pinned)).toBe(false);

    const own = await posted(member, id, "Eytt");
    await pinPost(owner, id, own.postId);
    expect((await member.call("DELETE", `/v1/posts/${own.postId}`)).status).toBe(204);
    expect((await pageOf(owner, id)).posts.some((p) => p.pinned)).toBe(false);
    // Neither a post that is gone nor one of another community takes a pin.
    expect((await pinPost(owner, id, own.postId)).status).toBe(404);
    const other = await community(owner, "open");
    const foreign = await posted(owner, other, "Annars staðar");
    expect((await pinPost(owner, id, foreign.postId)).status).toBe(404);
    expect((await pinPost(outsider, id, lost.postId)).status).toBe(403);
  });
});

describe("liking a comment", () => {
  const commentsOf = async (by: Person, postId: string) =>
    (await ok<{ comments: Comment[] }>(await by.call("GET", `/v1/posts/${postId}/comments`)))
      .comments;
  const like = (by: Person, commentId: string) => by.call("PUT", `/v1/comments/${commentId}/like`);
  const unlike = (by: Person, commentId: string) =>
    by.call("DELETE", `/v1/comments/${commentId}/like`);

  it("is one like for each account, counted for everyone and told to nobody", async () => {
    const [owner, one, two] = [await person("Eigandi"), await person("Eitt"), await person("Tvö")];
    const id = await community(owner, "open", one, two);
    const post = await posted(owner, id);
    const said = await ok<Comment>(
      await one.call("POST", `/v1/posts/${post.postId}/comments`, { body: "Athugasemd" }),
    );
    expect(said).toMatchObject({ likes: 0, liked: false });
    const jobs = async () =>
      (await env.DB.prepare("SELECT COUNT(*) AS n FROM jobs").first<{ n: number }>())?.n;
    const before = await jobs();

    expect((await like(two, said.commentId)).status).toBe(204);
    expect((await like(two, said.commentId)).status).toBe(204);
    expect((await like(one, said.commentId)).status).toBe(204);
    expect(await jobs()).toBe(before);
    expect((await commentsOf(owner, post.postId))[0]).toMatchObject({ likes: 2, liked: false });
    expect((await commentsOf(two, post.postId))[0]).toMatchObject({ likes: 2, liked: true });

    expect((await unlike(two, said.commentId)).status).toBe(204);
    expect((await unlike(two, said.commentId)).status).toBe(204);
    expect((await commentsOf(two, post.postId))[0]).toMatchObject({ likes: 1, liked: false });
    expect((await commentsOf(one, post.postId))[0]).toMatchObject({ likes: 1, liked: true });

    // Deleting the comment takes its likes with it.
    await like(two, said.commentId);
    expect((await one.call("DELETE", `/v1/comments/${said.commentId}`)).status).toBe(204);
    expect((await like(two, said.commentId)).status).toBe(404);
  });

  it("is refused to one who may not read, or may not reply", async () => {
    const [owner, member, outsider] = [
      await person("Eigandi"),
      await person("Meðlimur"),
      await person("Utangarðs"),
    ];
    const hidden = await community(owner, "private", member);
    const post = await posted(owner, hidden);
    const said = await ok<Comment>(
      await member.call("POST", `/v1/posts/${post.postId}/comments`, { body: "Aðeins hér" }),
    );
    for (const method of ["PUT", "DELETE"]) {
      const refused = await outsider.call(method, `/v1/comments/${said.commentId}/like`);
      expect(refused.status).toBe(404);
    }
    expect((await like(owner, "p_nope-nope")).status).toBe(404);
    // An open community is read by anyone, but only its members like.
    const open = await community(owner, "open");
    const openPost = await posted(owner, open);
    const openSaid = await ok<Comment>(
      await owner.call("POST", `/v1/posts/${openPost.postId}/comments`, { body: "Opið" }),
    );
    const refused = await like(outsider, openSaid.commentId);
    expect(refused.status).toBe(403);
    expect(await errorOf(refused)).toBe("not_a_member");
  });
});
