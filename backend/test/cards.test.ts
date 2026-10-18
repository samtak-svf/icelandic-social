import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { png } from "./images.ts";
import { community, ok, person, type Person } from "./people.ts";

// Typed references and the cards they resolve to (#288): a card shows what
// the thing itself would show the caller, and nothing when it may not see it.

type Ref = { kind: "post" | "comment" | "community"; id: string };
type Card = { kind: string; ref: Ref } & Record<string, unknown>;

const resolve = async (by: Person, ...refs: Ref[]) =>
  (await ok<{ cards: Card[] }>(await by.call("POST", "/v1/cards", { refs }))).cards;

const available = async (by: Person, ...refs: Ref[]) =>
  (await resolve(by, ...refs)).map((card) => card.kind !== "unavailable");

describe("cards", () => {
  it("show a post, a comment and a community, in the order asked", async () => {
    const [owner, reader] = [await person("Eigandi"), await person("Lesandi")];
    const id = await community(owner, "open", reader);
    const { mediaId } = await ok<{ mediaId: string }>(
      await owner.send(`/v1/communities/${id}/media`, await png(40, 20)),
    );
    const long = "Langur texti. ".repeat(30);
    const { postId } = await ok<{ postId: string }>(
      await owner.call("POST", `/v1/communities/${id}/posts`, { body: long, media: [mediaId] }),
    );
    const { commentId } = await ok<{ commentId: string }>(
      await reader.call("POST", `/v1/posts/${postId}/comments`, { body: "Sammála" }),
    );
    const [post, comment, place] = await resolve(
      reader,
      { kind: "post", id: postId },
      { kind: "comment", id: commentId },
      { kind: "community", id },
    );
    expect(post).toMatchObject({
      kind: "post",
      ref: { kind: "post", id: postId },
      community: { communityId: id, name: "Garðyrkjufélagið" },
      author: { accountId: owner.accountId, name: "Eigandi" },
      image: { mediaId, width: 40, height: 20 },
    });
    // The excerpt is 280 characters, the last an ellipsis.
    const text = String(post?.excerpt);
    expect(Array.from(text)).toHaveLength(280);
    expect(text.endsWith("…")).toBe(true);
    expect(long.startsWith(text.slice(0, -1))).toBe(true);
    expect(comment).toMatchObject({
      kind: "comment",
      postId,
      author: { accountId: reader.accountId },
      excerpt: "Sammála",
    });
    expect(place).toMatchObject({ kind: "community", audience: "open", memberCount: 2 });
  });

  it("are unavailable for whatever the caller may no longer see", async () => {
    const [owner, member, outsider] = [
      await person("Eigandi"),
      await person("Meðlimur"),
      await person("Utangarðs"),
    ];
    const id = await community(owner, "private", member);
    const { postId } = await ok<{ postId: string }>(
      await owner.call("POST", `/v1/communities/${id}/posts`, { body: "Fyrir meðlimi" }),
    );
    const { commentId } = await ok<{ commentId: string }>(
      await member.call("POST", `/v1/posts/${postId}/comments`, { body: "Já" }),
    );
    const refs: Ref[] = [
      { kind: "post", id: postId },
      { kind: "comment", id: commentId },
      { kind: "community", id },
    ];
    expect(await available(member, ...refs)).toEqual([true, true, true]);

    // Outside a private community: its name, but none of its content (0063).
    expect(await available(outsider, ...refs)).toEqual([false, false, true]);
    const [place] = await resolve(outsider, { kind: "community", id });
    expect(place).toMatchObject({ audience: "private", memberCount: null });

    // A block hides the author's post, and the post's comments with it.
    await owner.call("PUT", `/v1/blocks/${member.accountId}`);
    expect(await available(member, ...refs)).toEqual([false, false, true]);
    await owner.call("DELETE", `/v1/blocks/${member.accountId}`);

    // A removed post, for a member; a moderator still sees it.
    const act = (action: string, targetId: string) =>
      owner.call("POST", `/v1/communities/${id}/actions`, { action, targetId, reason: "Prófun" });
    // The post is the owner's own, which no moderator of the community removes.
    await env.DB.prepare("UPDATE post_index SET state = 'removed' WHERE post_id = ?")
      .bind(postId)
      .run();
    expect(await available(member, ...refs)).toEqual([false, false, true]);
    expect(await available(owner, ...refs)).toEqual([true, true, true]);

    // A ban, and a deleted post.
    expect((await act("ban_member", member.accountId)).status).toBe(204);
    expect(await available(member, ...refs)).toEqual([false, false, false]);
    await env.DB.prepare("UPDATE post_index SET state = 'visible' WHERE post_id = ?")
      .bind(postId)
      .run();
    expect((await owner.call("DELETE", `/v1/posts/${postId}`)).status).toBe(204);
    expect(await available(owner, ...refs)).toEqual([false, false, true]);
  });

  it("are unavailable for what is not there, the same as for what is hidden", async () => {
    const owner = await person("Eigandi");
    const cards = await resolve(
      owner,
      { kind: "post", id: "p_00000000000000000000000000000000" },
      { kind: "comment", id: "p_00000000000000000000000000000000-0000000000000000" },
      { kind: "comment", id: "no-post" },
      { kind: "community", id: "cm_00000000000000000000000000000000" },
    );
    expect(cards.map((c) => Object.keys(c).sort())).toEqual(
      Array.from({ length: 4 }, () => ["kind", "ref"]),
    );
  });

  it("are resolved fifty at a time at most", async () => {
    const owner = await person("Eigandi");
    const refs = Array.from({ length: 51 }, () => ({ kind: "community", id: "cm_x" }));
    expect((await owner.call("POST", "/v1/cards", { refs })).status).toBe(400);
    expect((await owner.call("POST", "/v1/cards", { refs: [] })).status).toBe(400);
  });
});
