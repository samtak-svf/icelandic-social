import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { deleteAccount } from "../src/account-deletion.ts";
import { runJobs } from "../src/modules/jobs/index.ts";
import { jobHandlers } from "../src/modules/notifications/index.ts";
import { community, errorOf, ok, person, type Person } from "./people.ts";
import { euEnv } from "./support.ts";

// Anonymous posts (decision 0091): approved before they show, and the author's
// account id reaches no reader. Every answer goes through `seen`, which keeps
// the raw text, so the leak test searches everything that was ever answered.

type Byline = { accountId: string; name: string | null };
type Seen = {
  postId: string;
  body: string;
  state: string;
  anonymous: boolean;
  mine: boolean;
  author: Byline | null;
};

const answered: string[] = [];

async function seen<T>(response: Response): Promise<T> {
  const text = await response.clone().text();
  answered.push(text);
  return ok<T>(response);
}

const switchOn = (owner: Person, id: string, on = true) =>
  owner.call("PATCH", `/v1/communities/${id}`, { anonymousPosts: on });
const create = (by: Person, id: string, body: string, anonymous = true) =>
  by.call("POST", `/v1/communities/${id}/posts`, { body, media: [], anonymous });
const queue = (by: Person, id: string) => by.call("GET", `/v1/communities/${id}/anonymous`);
const log = async (by: Person, id: string) =>
  (
    await seen<{
      entries: { action: string; actor: Byline | null; targetAccount: Byline | null }[];
    }>(await by.call("GET", `/v1/communities/${id}/moderation-log`))
  ).entries;

async function scene() {
  const [owner, moderator, author, reader, third] = [
    await person("Eigandi"),
    await person("Umsjónarmaður"),
    await person("Höfundur"),
    await person("Lesandi"),
    await person("Þriðji"),
  ];
  const id = await community(owner, "open", moderator, author, reader, third);
  await owner.call("PUT", `/v1/communities/${id}/members/${moderator.accountId}/role`, {
    role: "moderator",
  });
  expect((await switchOn(owner, id)).status).toBe(200);
  return { owner, moderator, author, reader, third, id };
}

describe("the community switch", () => {
  it("is the owner's, off by default, logged, and gates anonymous posts", async () => {
    const [owner, member] = [await person("Eigandi"), await person("Meðlimur")];
    const id = await community(owner, "open", member);
    const before = await seen<{ anonymousPosts: boolean }>(
      await owner.call("GET", `/v1/communities/${id}`),
    );
    expect(before.anonymousPosts).toBe(false);
    expect(await errorOf(await create(member, id, "Nafnlaust"))).toBe("anonymous_off");
    expect((await switchOn(member, id)).status).toBe(403);
    expect((await switchOn(owner, id)).status).toBe(200);
    expect((await create(member, id, "Nafnlaust")).status).toBe(200);
    // Unchanged is no entry; off is one.
    expect((await switchOn(owner, id)).status).toBe(200);
    expect((await switchOn(owner, id, false)).status).toBe(200);
    expect((await log(owner, id)).map((e) => e.action)).toEqual([
      "anonymous_posts_off",
      "anonymous_posts_on",
    ]);
  });
});

describe("approval", () => {
  it("keeps a post from readers until a moderator approves it, and tells the author of a decline", async () => {
    const { owner, moderator, author, reader, id } = await scene();
    const made = await seen<Seen>(await create(author, id, "Spurning sem ég þori ekki að spyrja"));
    expect(made).toMatchObject({ state: "pending", anonymous: true, mine: true });
    expect(made.author?.accountId).toBe(author.accountId);

    // Invisible to a reader, visible to the author as their own.
    const feedOf = async (by: Person) =>
      (await seen<{ posts: Seen[] }>(await by.call("GET", `/v1/communities/${id}/posts`))).posts;
    expect(await feedOf(reader)).toEqual([]);
    expect((await reader.call("GET", `/v1/posts/${made.postId}`)).status).toBe(404);
    expect((await author.call("GET", `/v1/posts/${made.postId}`)).status).toBe(200);
    // A pending post takes no comment or reaction.
    expect(
      (await reader.call("POST", `/v1/posts/${made.postId}/comments`, { body: "x", media: [] }))
        .status,
    ).toBe(404);

    // The queue is the moderators', and it names no author.
    expect((await queue(reader, id)).status).toBe(403);
    const waiting = await seen<{ posts: Seen[] }>(await queue(moderator, id));
    expect(waiting.posts.map((p) => p.postId)).toEqual([made.postId]);
    expect(waiting.posts[0]?.author).toBeNull();
    expect(JSON.stringify(waiting)).not.toContain(author.accountId);
    const counted = await seen<{ pendingAnonymous: number }>(
      await owner.call("GET", `/v1/communities/${id}`),
    );
    expect(counted.pendingAnonymous).toBe(1);
    const plain = await seen<{ pendingAnonymous: number }>(
      await reader.call("GET", `/v1/communities/${id}`),
    );
    expect(plain.pendingAnonymous).toBe(0);

    expect((await reader.call("POST", `/v1/posts/${made.postId}/approve`)).status).toBe(403);
    expect((await moderator.call("POST", `/v1/posts/${made.postId}/approve`)).status).toBe(204);
    expect((await feedOf(reader)).map((p) => p.postId)).toEqual([made.postId]);
    // Approving again is no error and no second effect.
    expect((await moderator.call("POST", `/v1/posts/${made.postId}/approve`)).status).toBe(404);

    // A decline deletes the post and tells only its author.
    const second = await seen<Seen>(await create(author, id, "Önnur"));
    expect((await moderator.call("POST", `/v1/posts/${second.postId}/decline`)).status).toBe(204);
    expect((await author.call("GET", `/v1/posts/${second.postId}`)).status).toBe(404);
    await runJobs(euEnv(env), jobHandlers({ send: async () => {} }), Date.now() + 1);
    const told = await seen<{ notifications: { kind: string; action: string | null }[] }>(
      await author.call("GET", "/v1/notifications"),
    );
    expect(told.notifications.some((n) => n.action === "decline_anonymous_post")).toBe(true);
  });
});

describe("the leak test", () => {
  it("serves the author's account id to no reader", async () => {
    const { owner, moderator, author, reader, third, id } = await scene();
    // The author's own answers name the author to the author, so they are not recorded.
    const made = await ok<Seen>(await create(author, id, "Nafnlaus færsla"));
    expect((await moderator.call("POST", `/v1/posts/${made.postId}/approve`)).status).toBe(204);
    const comment = await seen<{ commentId: string }>(
      await reader.call("POST", `/v1/posts/${made.postId}/comments`, { body: "Svar", media: [] }),
    );
    expect(
      (await third.call("PUT", `/v1/posts/${made.postId}/reaction`, { kind: "like" })).status,
    ).toBe(204);
    expect(
      (await reader.call("PUT", `/v1/posts/${made.postId}/reaction`, { kind: "love" })).status,
    ).toBe(204);
    // A reply to the commenter, so the commenter has a notification.
    await seen(
      await third.call("POST", `/v1/posts/${made.postId}/comments`, {
        body: "Svar við svari",
        media: [],
        parentCommentId: comment.commentId,
      }),
    );

    // Every response a third member can read.
    await seen(await third.call("GET", `/v1/communities/${id}/posts`));
    await seen(await third.call("GET", "/v1/feed"));
    const one = await seen<Seen>(await third.call("GET", `/v1/posts/${made.postId}`));
    expect(one).toMatchObject({ anonymous: true, mine: false, author: null });
    await seen(await third.call("GET", `/v1/posts/${made.postId}/comments`));
    await seen(await third.call("GET", `/v1/communities/${id}`));
    await seen(await third.call("GET", "/v1/communities"));
    await seen(
      await third.call("POST", "/v1/cards", { refs: [{ kind: "post", id: made.postId }] }),
    );
    for (const by of [reader, third, moderator, owner]) {
      await seen(await by.call("GET", "/v1/notifications"));
    }
    await seen(await reader.call("GET", `/v1/communities/${id}/posts`));
    // The moderators' own queue, log and (after approving) post.
    await seen(await moderator.call("GET", `/v1/posts/${made.postId}`));
    await seen(await owner.call("GET", `/v1/communities/${id}/anonymous`));
    await log(owner, id);

    for (const text of answered) expect(text).not.toContain(author.accountId);

    // The author sees it as their own.
    const mine = await ok<Seen>(await author.call("GET", `/v1/posts/${made.postId}`));
    expect(mine).toMatchObject({ anonymous: true, mine: true, state: "visible" });
    expect(mine.author?.accountId).toBe(author.accountId);
  });
});

describe("revealing", () => {
  it("is for moderators, is logged by who revealed, and a plain member is refused", async () => {
    const { moderator, author, reader, id } = await scene();
    const made = await seen<Seen>(await create(author, id, "Nafnlaus"));
    await moderator.call("POST", `/v1/posts/${made.postId}/approve`);

    expect((await reader.call("POST", `/v1/posts/${made.postId}/reveal`)).status).toBe(403);
    expect(await log(moderator, id)).not.toContainEqual(
      expect.objectContaining({ action: "reveal_author" }),
    );
    const revealed = await ok<Byline>(
      await moderator.call("POST", `/v1/posts/${made.postId}/reveal`),
    );
    expect(revealed.accountId).toBe(author.accountId);
    const entries = await log(moderator, id);
    const entry = entries.find((e) => e.action === "reveal_author");
    expect(entry?.actor?.accountId).toBe(moderator.accountId);
    // The entry names who revealed, not whom.
    expect(entry?.targetAccount).toBeNull();
  });
});

describe("everything else still applies", () => {
  it("deletes with the account and hides from a blocker, and a removal leaves no author in the log", async () => {
    const { owner, moderator, author, reader, id } = await scene();
    const made = await seen<Seen>(await create(author, id, "Nafnlaus"));
    await moderator.call("POST", `/v1/posts/${made.postId}/approve`);

    // A block hides the post from the blocker.
    expect((await reader.call("PUT", `/v1/blocks/${author.accountId}`)).status).toBeLessThan(300);
    expect((await reader.call("GET", `/v1/posts/${made.postId}`)).status).toBe(404);
    await reader.call("DELETE", `/v1/blocks/${author.accountId}`);

    // A removal acts on the real account, and the log does not name it.
    expect(
      (
        await moderator.call("POST", `/v1/communities/${id}/actions`, {
          action: "remove_post",
          targetId: made.postId,
          reason: "Brot á reglum",
        })
      ).status,
    ).toBe(204);
    const removal = (await log(owner, id)).find((e) => e.action === "remove_post");
    expect(removal?.targetAccount).toBeNull();

    // Deleting the account deletes the post.
    const other = await seen<Seen>(await create(author, id, "Önnur"));
    await moderator.call("POST", `/v1/posts/${other.postId}/approve`);
    await deleteAccount(euEnv(env), author.accountId);
    expect((await owner.call("GET", `/v1/posts/${other.postId}`)).status).toBe(404);
  });
});

describe("nothing answers by who the author is", () => {
  const act = (by: Person, id: string, action: string, targetId: string, until?: number) =>
    by.call("POST", `/v1/communities/${id}/actions`, {
      action,
      targetId,
      reason: "Prófun",
      ...(until === undefined ? {} : { until }),
    });
  const published = async (by: Person, approver: Person, id: string, body: string) => {
    const made = await ok<Seen>(await create(by, id, body));
    expect((await approver.call("POST", `/v1/posts/${made.postId}/approve`)).status).toBe(204);
    return made.postId;
  };

  it("takes a reply across a block, which the author never sees", async () => {
    const { moderator, author, id } = await scene();
    const postId = await published(author, moderator, id, "Nafnlaus");
    expect((await author.call("PUT", `/v1/blocks/${moderator.accountId}`)).status).toBeLessThan(
      300,
    );

    // The moderator reads across the block, and is answered as for any post.
    const reply = await moderator.call("POST", `/v1/posts/${postId}/comments`, {
      body: "Svar",
      media: [],
    });
    expect(reply.status).toBe(200);
    expect(
      (await moderator.call("PUT", `/v1/posts/${postId}/reaction`, { kind: "like" })).status,
    ).toBe(204);

    // The block still holds for the author: no reply, no notice.
    const comments = await ok<{ comments: unknown[] }>(
      await author.call("GET", `/v1/posts/${postId}/comments`),
    );
    expect(comments.comments).toEqual([]);
    await runJobs(euEnv(env), jobHandlers({ send: async () => {} }), Date.now() + 1);
    const told = await ok<{ notifications: { kind: string }[] }>(
      await author.call("GET", "/v1/notifications"),
    );
    expect(told.notifications.filter((n) => n.kind !== "moderated")).toEqual([]);
  });

  it("moderates an anonymous post the same whether its author outranks, equals or has left", async () => {
    const { owner, moderator, author, third, id } = await scene();
    await owner.call("PUT", `/v1/communities/${id}/members/${third.accountId}/role`, {
      role: "moderator",
    });
    const byOwner = await published(owner, moderator, id, "Frá eiganda");
    const byPeer = await published(third, moderator, id, "Frá jafningja");
    const byLeaver = await published(author, moderator, id, "Frá þeim sem fór");
    expect((await author.call("POST", `/v1/communities/${id}/leave`)).status).toBe(204);

    for (const postId of [byOwner, byPeer, byLeaver]) {
      expect((await act(moderator, id, "hide_post", postId)).status).toBe(204);
      expect((await act(moderator, id, "restore_post", postId)).status).toBe(204);
    }

    // An account action names the account, so rank still decides it.
    const DAY = 24 * 60 * 60 * 1000;
    expect(
      (await act(moderator, id, "mute_member", owner.accountId, Date.now() + DAY)).status,
    ).toBe(403);
  });
});
