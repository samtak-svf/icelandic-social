import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { community, ok, person, type Person } from "./people.ts";

// A byline carries its picture and role, and a post its newest comment
// (decision 0080): the server says it once, so no client looks it up.

type Author = {
  accountId: string;
  photo: string | null;
  role: "owner" | "moderator" | null;
};
type Comment = {
  commentId: string;
  author: Author;
  body: string;
  likes: number;
  liked: boolean;
  state: string;
};
type Post = { postId: string; author: Author; latestComment: Comment | null };

const posted = async (by: Person, communityId: string, body = "Póstur") =>
  ok<Post>(await by.call("POST", `/v1/communities/${communityId}/posts`, { body }));

// Comments are ordered by their millisecond, so two in a row need a gap.
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

const commented = async (by: Person, postId: string, body: string, parent?: string) => {
  await tick();
  return ok<Comment>(
    await by.call("POST", `/v1/posts/${postId}/comments`, {
      body,
      ...(parent ? { parentCommentId: parent } : {}),
    }),
  );
};

const commentsOf = async (by: Person, postId: string) =>
  (await ok<{ comments: Comment[] }>(await by.call("GET", `/v1/posts/${postId}/comments`)))
    .comments;

const postOf = async (by: Person, postId: string) =>
  ok<Post>(await by.call("GET", `/v1/posts/${postId}`));

const feedOf = async (by: Person) =>
  (await ok<{ posts: Post[] }>(await by.call("GET", "/v1/feed"))).posts;

const promote = (owner: Person, communityId: string, to: Person) =>
  owner.call("PUT", `/v1/communities/${communityId}/members/${to.accountId}/role`, {
    role: "moderator",
  });

const hide = (by: Person, communityId: string, commentId: string) =>
  by.call("POST", `/v1/communities/${communityId}/actions`, {
    action: "hide_comment",
    targetId: commentId,
    reason: "Prófun",
  });

describe("a byline's role", () => {
  it("is owner, moderator or null on a post and on a comment", async () => {
    const [owner, moderator, member] = [
      await person("Eigandi"),
      await person("Umsjón"),
      await person("Meðlimur"),
    ];
    const id = await community(owner, "open", moderator, member);
    expect((await promote(owner, id, moderator)).status).toBe(204);
    for (const [by, role] of [
      [owner, "owner"],
      [moderator, "moderator"],
      [member, null],
    ] as const) {
      const post = await posted(by, id);
      expect(post.author.role).toBe(role);
      const said = await commented(by, post.postId, "Athugasemd");
      expect(said.author.role).toBe(role);
      expect((await postOf(member, post.postId)).author.role).toBe(role);
      expect((await commentsOf(member, post.postId))[0]!.author.role).toBe(role);
    }
  });

  it("is the role in the community the content belongs to, never another's, feed included", async () => {
    const [alice, bob] = [await person("Alda"), await person("Bergur")];
    const mineId = await community(alice, "open");
    const theirsId = await community(bob, "open", alice);
    const own = await posted(alice, mineId, "Í mínu");
    const guest = await posted(alice, theirsId, "Í þeirra");
    await commented(alice, guest.postId, "Gestur");
    expect(own.author.role).toBe("owner");
    expect(guest.author.role).toBeNull();
    const feed = await feedOf(alice);
    expect(feed.find((p) => p.postId === own.postId)?.author.role).toBe("owner");
    const seen = feed.find((p) => p.postId === guest.postId)!;
    expect(seen.author.role).toBeNull();
    expect(seen.latestComment?.author.role).toBeNull();
    // The reader's own feed lists both; a third reader sees the same roles.
    const reader = await person("Lesandi");
    await reader.call("POST", `/v1/communities/${mineId}/join`);
    await reader.call("POST", `/v1/communities/${theirsId}/join`);
    const other = await feedOf(reader);
    expect(other.find((p) => p.postId === own.postId)?.author.role).toBe("owner");
    expect(other.find((p) => p.postId === guest.postId)?.author.role).toBeNull();
  });
});

describe("a byline's photo", () => {
  it("is null with no photo and the version once one is set", async () => {
    const [owner, member] = [await person("Eigandi"), await person("Meðlimur")];
    const id = await community(owner, "open", member);
    const post = await posted(member, id);
    expect(post.author.photo).toBeNull();
    await env.DB.prepare("UPDATE accounts SET photo_version = ? WHERE account_id = ?")
      .bind("ph_0123456789abcdef", member.accountId)
      .run();
    const said = await commented(member, post.postId, "Mynd");
    expect(said.author.photo).toBe("ph_0123456789abcdef");
    expect((await postOf(owner, post.postId)).author.photo).toBe("ph_0123456789abcdef");
    expect((await commentsOf(owner, post.postId))[0]!.author.photo).toBe("ph_0123456789abcdef");
  });
});

describe("a member row's photo", () => {
  it("is null with no photo and the version once one is set", async () => {
    const [owner, member] = [await person("Eigandi"), await person("Meðlimur")];
    const id = await community(owner, "open", member);
    type Row = { accountId: string; photo: string | null };
    const photoOf = async () =>
      (
        await ok<{ members: Row[] }>(await owner.call("GET", `/v1/communities/${id}/members`))
      ).members.find((m) => m.accountId === member.accountId)?.photo;
    expect(await photoOf()).toBeNull();
    await env.DB.prepare("UPDATE accounts SET photo_version = ? WHERE account_id = ?")
      .bind("ph_0123456789abcdef", member.accountId)
      .run();
    expect(await photoOf()).toBe("ph_0123456789abcdef");
  });
});

describe("a post's latestComment", () => {
  it("is null with no comments, then the newest of two, with its likes", async () => {
    const [owner, member] = [await person("Eigandi"), await person("Meðlimur")];
    const id = await community(owner, "open", member);
    const post = await posted(owner, id);
    expect((await postOf(member, post.postId)).latestComment).toBeNull();
    await commented(member, post.postId, "Fyrri");
    const newest = await commented(owner, post.postId, "Seinni");
    expect((await member.call("PUT", `/v1/comments/${newest.commentId}/like`)).status).toBe(204);
    const seen = (await postOf(member, post.postId)).latestComment;
    expect(seen).toMatchObject({
      commentId: newest.commentId,
      body: "Seinni",
      likes: 1,
      liked: true,
      author: { accountId: owner.accountId, role: "owner" },
    });
    expect((await postOf(owner, post.postId)).latestComment).toMatchObject({
      likes: 1,
      liked: false,
    });
    // The community's own page and the feed carry it too.
    expect((await feedOf(member)).find((p) => p.postId === post.postId)?.latestComment?.body).toBe(
      "Seinni",
    );
  });

  it("skips a removed comment for a member, not for a moderator", async () => {
    const [owner, member] = [await person("Eigandi"), await person("Meðlimur")];
    const id = await community(owner, "open", member);
    const post = await posted(owner, id);
    await commented(owner, post.postId, "Stendur");
    const bad = await commented(member, post.postId, "Fellt");
    expect((await hide(owner, id, bad.commentId)).status).toBe(204);
    expect((await postOf(member, post.postId)).latestComment?.body).toBe("Stendur");
    expect((await postOf(owner, post.postId)).latestComment?.body).toBe("Fellt");
  });

  it("skips a comment of an account blocked either way", async () => {
    const [owner, reader, writer] = [
      await person("Eigandi"),
      await person("Lesandi"),
      await person("Skrifari"),
    ];
    const id = await community(owner, "open", reader, writer);
    const post = await posted(owner, id);
    await commented(owner, post.postId, "Eldri");
    await commented(writer, post.postId, "Nýrri");
    await reader.call("PUT", `/v1/blocks/${writer.accountId}`);
    expect((await postOf(reader, post.postId)).latestComment?.body).toBe("Eldri");
    // The blocked side sees the same: a block hides both ways.
    expect((await postOf(writer, post.postId)).latestComment?.body).toBe("Nýrri");
    await reader.call("DELETE", `/v1/blocks/${writer.accountId}`);
    await writer.call("PUT", `/v1/blocks/${reader.accountId}`);
    expect((await postOf(reader, post.postId)).latestComment?.body).toBe("Eldri");
  });

  it("never chooses a tombstone, which is a slot and not a comment", async () => {
    const [owner, writer, reader] = [
      await person("Eigandi"),
      await person("Skrifari"),
      await person("Lesandi"),
    ];
    const id = await community(owner, "open", writer, reader);
    const post = await posted(owner, id);
    const parent = await commented(writer, post.postId, "Foreldri");
    await commented(reader, post.postId, "Svar", parent.commentId);
    await hide(owner, id, parent.commentId);
    // The list shows the tombstone first, then the reply; the newest is the reply.
    expect((await postOf(reader, post.postId)).latestComment?.body).toBe("Svar");
    // Block the reply's author: only the tombstone is left to show, and it is not chosen.
    const other = await person("Annar");
    await other.call("POST", `/v1/communities/${id}/join`);
    await other.call("PUT", `/v1/blocks/${reader.accountId}`);
    expect((await commentsOf(other, post.postId)).map((c) => c.state)).toEqual([]);
    expect((await postOf(other, post.postId)).latestComment).toBeNull();
  });
});

describe("a tombstone's likes", () => {
  it("are none, for the one who liked it and for anyone else", async () => {
    const [owner, liker, reader] = [
      await person("Eigandi"),
      await person("Þumall"),
      await person("Lesandi"),
    ];
    const id = await community(owner, "open", liker, reader);
    const post = await posted(owner, id);
    const parent = await commented(reader, post.postId, "Foreldri");
    expect((await liker.call("PUT", `/v1/comments/${parent.commentId}/like`)).status).toBe(204);
    await commented(owner, post.postId, "Svar", parent.commentId);
    expect((await hide(owner, id, parent.commentId)).status).toBe(204);
    for (const by of [reader, liker]) {
      const [tombstone] = await commentsOf(by, post.postId);
      expect(tombstone).toMatchObject({
        commentId: parent.commentId,
        state: "removed",
        likes: 0,
        liked: false,
      });
    }
  });
});
