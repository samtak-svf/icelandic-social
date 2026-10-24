import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { png } from "./images.ts";
import { community, errorOf, ok, person, type Person } from "./people.ts";

// The images tab of a community (decision 0089): one paged read over the
// media references posts and comments already store, through the community's
// read rule.

type Image = { mediaId: string; postId: string; commentId: string | null; createdAt: number };
type Page = { images: Image[]; next: string | null };

const upload = async (by: Person, communityId: string) =>
  (
    await ok<{ mediaId: string }>(
      await by.send(`/v1/communities/${communityId}/media`, await png(30, 20)),
    )
  ).mediaId;

/** A post by `by` with one image; its ids. */
async function withImage(by: Person, communityId: string) {
  const mediaId = await upload(by, communityId);
  const { postId } = await ok<{ postId: string }>(
    await by.call("POST", `/v1/communities/${communityId}/posts`, {
      body: "Mynd",
      media: [mediaId],
    }),
  );
  return { postId, mediaId };
}

const imagesOf = async (by: Person, communityId: string, query = "") =>
  ok<Page>(await by.call("GET", `/v1/communities/${communityId}/images${query}`));

const act = (by: Person, communityId: string, action: string, targetId: string) =>
  by.call("POST", `/v1/communities/${communityId}/actions`, { action, targetId, reason: "Prófun" });

/** Gives each image a distinct, increasing time so the order is not a tie-break. */
const spaced = async (...mediaIds: string[]) => {
  for (const [at, mediaId] of mediaIds.entries())
    await env.DB.prepare("UPDATE social_media SET created_at = ? WHERE media_id = ?")
      .bind(1_000_000 + at * 1000, mediaId)
      .run();
};

describe("a community's images", () => {
  it("are listed newest first, a page at a time, and the cursor is stable", async () => {
    const [owner, member] = [await person("Eigandi"), await person("Meðlimur")];
    const id = await community(owner, "open", member);
    const made = [];
    for (let i = 0; i < 5; i++) made.push(await withImage(i % 2 ? member : owner, id));
    await spaced(...made.map((m) => m.mediaId));
    const expected = made.map((m) => m.mediaId).reverse();

    const first = await imagesOf(member, id, "?limit=2");
    expect(first.images.map((i) => i.mediaId)).toEqual(expected.slice(0, 2));
    expect(first.next).not.toBeNull();
    // A newer image arriving does not move the cursor's page.
    const late = await withImage(owner, id);
    await spaced(...made.map((m) => m.mediaId));
    await env.DB.prepare("UPDATE social_media SET created_at = ? WHERE media_id = ?")
      .bind(9_000_000, late.mediaId)
      .run();
    const second = await imagesOf(member, id, `?limit=2&cursor=${first.next}`);
    expect(second.images.map((i) => i.mediaId)).toEqual(expected.slice(2, 4));
    const third = await imagesOf(member, id, `?limit=2&cursor=${second.next}`);
    expect(third.images.map((i) => i.mediaId)).toEqual(expected.slice(4));
    expect(third.next).toBeNull();
    expect(first.images[0]).toMatchObject({ postId: made[4]!.postId, commentId: null });
  });

  it("include a comment's image with its comment id", async () => {
    const [owner, member] = [await person("Eigandi"), await person("Meðlimur")];
    const id = await community(owner, "open", member);
    const { postId } = await withImage(owner, id);
    const mediaId = await upload(member, id);
    const written = await ok<{ commentId: string }>(
      await member.call("POST", `/v1/posts/${postId}/comments`, { body: "Mynd", media: [mediaId] }),
    );
    const listed = (await imagesOf(owner, id)).images.find((i) => i.mediaId === mediaId);
    expect(listed).toMatchObject({ postId, commentId: written.commentId });
  });

  it("leave out a removed post's, a hidden or removed comment's and a blocked account's", async () => {
    const [owner, writer, blocker, talker] = [
      await person("Eigandi"),
      await person("Höfundur"),
      await person("Blokkari"),
      await person("Spjallari"),
    ];
    const id = await community(owner, "open", writer, blocker, talker);
    const kept = await withImage(owner, id);
    const gone = await withImage(writer, id);
    const theirs = await withImage(writer, id);
    const commentsOn = await withImage(owner, id);
    const commentImages: string[] = [];
    const commentIds: string[] = [];
    for (let i = 0; i < 2; i++) {
      const mediaId = await upload(talker, id);
      const written = await ok<{ commentId: string }>(
        await talker.call("POST", `/v1/posts/${commentsOn.postId}/comments`, {
          body: "Mynd",
          media: [mediaId],
        }),
      );
      commentImages.push(mediaId);
      commentIds.push(written.commentId);
    }
    expect((await act(owner, id, "remove_post", gone.postId)).status).toBe(204);
    expect((await act(owner, id, "remove_comment", commentIds[0]!)).status).toBe(204);
    expect((await act(owner, id, "hide_comment", commentIds[1]!)).status).toBe(204);
    await blocker.call("PUT", `/v1/blocks/${writer.accountId}`);

    const listed = (await imagesOf(blocker, id)).images.map((i) => i.mediaId);
    expect(listed).toContain(kept.mediaId);
    expect(listed).toContain(commentsOn.mediaId);
    for (const hidden of [gone.mediaId, theirs.mediaId, ...commentImages])
      expect(listed).not.toContain(hidden);
    // The writer's own view of the same: a block hides both ways.
    const writers = (await imagesOf(writer, id)).images.map((i) => i.mediaId);
    expect(writers).toContain(theirs.mediaId);
    expect(writers).not.toContain(gone.mediaId);
    // A comment shown again returns.
    expect((await act(owner, id, "restore_comment", commentIds[1]!)).status).toBe(204);
    expect((await imagesOf(owner, id)).images.map((i) => i.mediaId)).toContain(commentImages[1]);
  });

  it("answer 404 to a reader who may not read a private community", async () => {
    const [owner, outsider] = [await person("Eigandi"), await person("Utangarðs")];
    const id = await community(owner, "private");
    await withImage(owner, id);
    const refused = await outsider.call("GET", `/v1/communities/${id}/images`);
    expect(refused.status).toBe(404);
    expect(await errorOf(refused)).toBe("not_found");
    expect((await imagesOf(owner, id)).images).toHaveLength(1);
  });
});

describe("a community's member list", () => {
  it("puts the owner and moderators first, then the members by name", async () => {
    const [owner, zed, anna, bjorn, mod] = [
      await person("Eigandi"),
      await person("Zed"),
      await person("anna"),
      await person("Björn"),
      await person("Þóra"),
    ];
    const id = await community(owner, "open", zed, anna, bjorn, mod);
    expect(
      (
        await owner.call("PUT", `/v1/communities/${id}/members/${mod.accountId}/role`, {
          role: "moderator",
        })
      ).status,
    ).toBe(204);
    const { members } = await ok<{ members: { accountId: string; role: string }[] }>(
      await zed.call("GET", `/v1/communities/${id}/members`),
    );
    expect(members.map((m) => m.accountId)).toEqual(
      [owner, mod, anna, bjorn, zed].map((p) => p.accountId),
    );
  });
});
