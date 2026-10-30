import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { commentModeration } from "../../../src/modules/moderation/index.ts";
import { CLIENT_HEADER } from "../../../src/shared/client-version.ts";
import { png } from "../../images.ts";
import { worker } from "../../main.ts";
import { community, errorOf, ok, person, platformModerator, type Person } from "../../people.ts";
import { euEnv } from "../../support.ts";
import { recorder, run, type Page } from "../notifications/support.ts";

// The statement of reasons, the single review and the tombstone (decisions 0063,
// 0115): what a member, an author and a moderator each read of a removed post,
// who may ask and who may answer, and what an old client is never sent.

const BASE = "https://spjall.test";
const KNOWING = () => `android/${env.NOTICE_CLIENT_VERSION}`;
const OLD = "android/0.18.0";
const SECRET = "Textinn sem var fjarlægður";

const as = (one: Person, path: string, client: string) =>
  worker.fetch(`${BASE}${path}`, { headers: { ...one.auth, [CLIENT_HEADER]: client } });

const act = (by: Person, id: string, action: string, targetId: string, reason = "Ástæðan") =>
  by.call("POST", `/v1/communities/${id}/actions`, { action, targetId, reason });

type Listed = { postId: string; state?: string; body: string; author: unknown; media: unknown[] };
const listOf = async (one: Person, path: string, client: string) =>
  (await ok<{ posts: Listed[] }>(await as(one, path, client))).posts;

type Statement = {
  entryId: number;
  action: string;
  target: { kind: string; id: string };
  reason: string;
  body: string | null;
  canAsk: boolean;
  review: { state: string; reason: string | null; restored: boolean } | null;
};
const statements = async (one: Person) =>
  (await ok<{ statements: Statement[] }>(await one.call("GET", "/v1/moderation/statements")))
    .statements;

const ask = (one: Person, entryId: number) =>
  one.call("POST", `/v1/moderation/statements/${entryId}/review`);

type Open = {
  entryId: number;
  body: string | null;
  actor: { accountId: string } | null;
  targetAccount: { accountId: string } | null;
  canDecide: boolean;
};
const openReviews = async (one: Person) =>
  (await ok<{ reviews: Open[] }>(await one.call("GET", "/v1/moderation/reviews"))).reviews;

const decide = (by: Person, entryId: number, outcome: string, reason = "Svarið") =>
  by.call("POST", `/v1/moderation/reviews/${entryId}`, { outcome, reason });

const logged = async (targetId: string) =>
  (
    await env.DB.prepare("SELECT action FROM moderation_log WHERE target_id = ? ORDER BY entry_id")
      .bind(targetId)
      .all<{ action: string }>()
  ).results.map((r) => r.action);

const noticesOf = async (one: Person, client = KNOWING()) => {
  await run(recorder());
  return ok<Page>(await as(one, "/v1/notifications", client));
};

/** A community with a member's post that its owner, a moderator, removed. */
async function removed(action = "remove_post") {
  const [owner, author, reader] = [
    await person("Eigandi"),
    await person("Höfundur"),
    await person("Lesandi"),
  ];
  const id = await community(owner, "open", author, reader);
  const { postId } = await ok<{ postId: string }>(
    await author.call("POST", `/v1/communities/${id}/posts`, { body: SECRET }),
  );
  expect((await act(owner, id, action, postId)).status).toBe(204);
  const [statement] = await statements(author);
  return { owner, author, reader, id, postId, entryId: statement!.entryId };
}

describe("the tombstone of a removed post", () => {
  it("keeps its place for a member, with none of what the post held", async () => {
    const { reader, id, postId } = await removed();
    for (const path of [`/v1/communities/${id}/posts`, "/v1/feed"]) {
      const [post] = await listOf(reader, path, KNOWING());
      expect(post).toMatchObject({ postId, state: "removed", body: "", author: null, media: [] });
      expect(JSON.stringify(post)).not.toContain(SECRET);
    }
    const one = await ok<Listed>(await as(reader, `/v1/posts/${postId}`, KNOWING()));
    expect(one).toMatchObject({ state: "removed", body: "", author: null });
  });

  it("is what its author reads in a list too, whose text is in the statement", async () => {
    const { author, id, postId } = await removed();
    const [post] = await listOf(author, `/v1/communities/${id}/posts`, KNOWING());
    expect(post).toMatchObject({ postId, state: "removed", body: "", mine: true });
    expect((await statements(author))[0]!.body).toBe(SECRET);
  });

  it("is not sent to a client that would draw an empty post", async () => {
    const { reader, id, postId } = await removed();
    expect(await listOf(reader, `/v1/communities/${id}/posts`, OLD)).toEqual([]);
    expect(await listOf(reader, "/v1/feed", OLD)).toEqual([]);
    expect((await as(reader, `/v1/posts/${postId}`, OLD)).status).toBe(404);
  });

  it("is not found by a search, and a hidden post stays out of every list", async () => {
    const { reader, id } = await removed();
    expect(await listOf(reader, `/v1/communities/${id}/posts?q=Textinn`, KNOWING())).toEqual([]);
    const other = await removed("hide_post");
    expect(await listOf(other.reader, `/v1/communities/${other.id}/posts`, KNOWING())).toEqual([]);
    expect((await as(other.reader, `/v1/posts/${other.postId}`, KNOWING())).status).toBe(404);
  });

  it("reaches no reader who is outside the space or blocked by the author", async () => {
    const [owner, author, reader, outsider] = [
      await person("Eigandi"),
      await person("Höfundur"),
      await person("Lesandi"),
      await person("Utangarðs"),
    ];
    const id = await community(owner, "private", author, reader);
    const { postId } = await ok<{ postId: string }>(
      await author.call("POST", `/v1/communities/${id}/posts`, { body: SECRET }),
    );
    expect((await act(owner, id, "remove_post", postId)).status).toBe(204);
    expect((await as(outsider, `/v1/posts/${postId}`, KNOWING())).status).toBe(404);
    expect((await as(reader, `/v1/posts/${postId}`, KNOWING())).status).toBe(200);
    expect((await reader.call("PUT", `/v1/blocks/${author.accountId}`)).status).toBeLessThan(300);
    expect((await as(reader, `/v1/posts/${postId}`, KNOWING())).status).toBe(404);
  });

  it("gives the post back to a moderator, who may restore it", async () => {
    const { owner, postId } = await removed();
    const post = await ok<Listed>(await as(owner, `/v1/posts/${postId}`, KNOWING()));
    expect(post.body).toBe(SECRET);
  });
});

describe("the statement of reasons", () => {
  it("says what was done and why, and never who did it", async () => {
    const { author, owner, postId } = await removed();
    const [statement] = await statements(author);
    expect(statement).toMatchObject({
      action: "remove_post",
      target: { kind: "post", id: postId },
      reason: "Ástæðan",
      body: SECRET,
      canAsk: true,
      review: null,
    });
    expect(JSON.stringify(statement)).not.toContain(owner.accountId);
    expect(JSON.stringify(statement)).not.toContain("actor");
  });

  it("is read by nobody else, and asked for by nobody else", async () => {
    const { reader, owner, entryId } = await removed();
    expect(await statements(reader)).toEqual([]);
    expect(await statements(owner)).toEqual([]);
    for (const one of [reader, owner]) {
      const refused = await ask(one, entryId);
      expect(refused.status).toBe(404);
      expect(await errorOf(refused)).toBe("not_found");
    }
    const platform = await platformModerator("Samtak");
    expect((await ask(platform, entryId)).status).toBe(404);
  });

  it("offers no review of something that is back already", async () => {
    const { author, owner, id, postId, entryId } = await removed();
    expect((await act(owner, id, "restore_post", postId)).status).toBe(204);
    const statement = (await statements(author)).find((s) => s.entryId === entryId)!;
    expect(statement.canAsk).toBe(false);
    const refused = await ask(author, entryId);
    expect(refused.status).toBe(409);
    expect(await errorOf(refused)).toBe("restored");
  });

  it("is found by its author on an anonymous post whose log entry names nobody", async () => {
    const [owner, author] = [await person("Eigandi"), await person("Höfundur")];
    const id = await community(owner, "open", author);
    const { postId } = await ok<{ postId: string }>(
      await author.call("POST", `/v1/communities/${id}/posts`, { body: SECRET }),
    );
    await env.DB.prepare("UPDATE post_index SET anonymous = 1 WHERE post_id = ?")
      .bind(postId)
      .run();
    expect((await act(owner, id, "remove_post", postId)).status).toBe(204);
    const row = await env.DB.prepare(
      "SELECT target_account FROM moderation_log WHERE target_id = ?",
    )
      .bind(postId)
      .first<{ target_account: string | null }>();
    expect(row?.target_account).toBeNull();

    const [statement] = await statements(author);
    expect(statement?.target.id).toBe(postId);
    expect((await ask(author, statement!.entryId)).status).toBe(204);

    const platform = await platformModerator("Samtak");
    const open = (await openReviews(platform)).find((r) => r.entryId === statement!.entryId);
    expect(open?.targetAccount).toBeNull();
    expect((await decide(platform, statement!.entryId, "upheld")).status).toBe(204);
    const kept = await env.DB.prepare(
      "SELECT account_id FROM moderation_reviews WHERE entry_id = ?",
    )
      .bind(statement!.entryId)
      .first<{ account_id: string | null }>();
    expect(kept?.account_id).toBeNull();
  });
});

describe("the single review", () => {
  it("is asked for once, and the database refuses a second", async () => {
    const { author, entryId } = await removed();
    expect((await ask(author, entryId)).status).toBe(204);
    const again = await ask(author, entryId);
    expect(again.status).toBe(409);
    expect(await errorOf(again)).toBe("already_asked");
    await expect(
      env.DB.prepare(
        "INSERT INTO moderation_reviews (entry_id, account_id, asked_at) VALUES (?, ?, ?)",
      )
        .bind(entryId, author.accountId, Date.now())
        .run(),
    ).rejects.toThrow(/UNIQUE/);
    expect((await statements(author))[0]).toMatchObject({
      canAsk: false,
      review: { state: "open", reason: null, restored: false },
    });
  });

  it("is listed for platform moderators and nobody else, with the text kept", async () => {
    const { author, owner, entryId } = await removed();
    await ask(author, entryId);
    expect((await owner.call("GET", "/v1/moderation/reviews")).status).toBe(403);
    expect((await decide(owner, entryId, "upheld")).status).toBe(403);
    const platform = await platformModerator("Samtak");
    const open = (await openReviews(platform)).find((r) => r.entryId === entryId);
    expect(open).toMatchObject({ body: SECRET, canDecide: true });
    expect(open?.actor?.accountId).toBe(owner.accountId);
    expect(open?.targetAccount?.accountId).toBe(author.accountId);
  });

  it("is not decided by the moderator who acted; another one decides", async () => {
    const [actor, other] = [await platformModerator("Sá"), await platformModerator("Hin")];
    const [owner, author] = [await person("Eigandi"), await person("Höfundur")];
    const id = await community(owner, "open", author);
    const { postId } = await ok<{ postId: string }>(
      await author.call("POST", `/v1/communities/${id}/posts`, { body: SECRET }),
    );
    expect((await act(actor, id, "remove_post", postId)).status).toBe(204);
    const [statement] = await statements(author);
    await ask(author, statement!.entryId);

    const own = (await openReviews(actor)).find((r) => r.entryId === statement!.entryId);
    expect(own?.canDecide).toBe(false);
    const refused = await decide(actor, statement!.entryId, "overturned");
    expect(refused.status).toBe(403);
    expect(await errorOf(refused)).toBe("not_permitted");
    expect((await decide(other, statement!.entryId, "upheld")).status).toBe(204);
  });

  it("overturned, restores the post and tells the person", async () => {
    const { author, reader, id, postId, entryId } = await removed();
    await ask(author, entryId);
    const platform = await platformModerator("Samtak");
    expect((await decide(platform, entryId, "overturned", "Mistök")).status).toBe(204);

    const [post] = await listOf(reader, `/v1/communities/${id}/posts`, KNOWING());
    expect(post).toMatchObject({ postId, body: SECRET });
    expect(await logged(postId)).toEqual(["remove_post", "review_overturned", "restore_post"]);
    const restoring = await env.DB.prepare(
      "SELECT actor_id, as_platform, reason FROM moderation_log WHERE target_id = ? AND action = 'restore_post'",
    )
      .bind(postId)
      .first();
    expect(restoring).toEqual({ actor_id: platform.accountId, as_platform: 1, reason: "Mistök" });
    expect((await statements(author))[0]).toMatchObject({
      canAsk: false,
      review: { state: "overturned", reason: "Mistök", restored: true },
    });
    const page = await noticesOf(author);
    expect(page.notifications[0]).toMatchObject({
      kind: "moderated",
      action: "review_overturned",
      communityId: id,
      actor: null,
      actors: [],
      actorCount: 0,
    });
  });

  it("upheld, leaves the post removed and tells the person", async () => {
    const { author, reader, id, postId, entryId } = await removed();
    await ask(author, entryId);
    const platform = await platformModerator("Samtak");
    expect((await decide(platform, entryId, "upheld", "Stendur")).status).toBe(204);
    const [post] = await listOf(reader, `/v1/communities/${id}/posts`, KNOWING());
    expect(post).toMatchObject({ state: "removed", body: "" });
    expect(await logged(postId)).toEqual(["remove_post", "review_upheld"]);
    expect((await noticesOf(author)).notifications[0]?.action).toBe("review_upheld");
    // An app that would word this as a second removal is not told.
    const old = await noticesOf(author, OLD);
    expect(old.notifications.map((n) => n.action)).not.toContain("review_upheld");
  });

  it("restores and logs in one write: without the entry the post stays removed", async () => {
    const { author, reader, id, entryId } = await removed();
    await ask(author, entryId);
    const platform = await platformModerator("Samtak");
    await env.DB.exec(
      "CREATE TRIGGER refuse_entry BEFORE INSERT ON moderation_log BEGIN SELECT RAISE(ABORT, 'no'); END;",
    );
    try {
      expect((await decide(platform, entryId, "overturned")).status).toBe(500);
    } finally {
      await env.DB.exec("DROP TRIGGER refuse_entry;");
    }
    const [post] = await listOf(reader, `/v1/communities/${id}/posts`, KNOWING());
    expect(post).toMatchObject({ state: "removed" });
    expect((await statements(author))[0]?.review?.state).toBe("open");
  });

  it("is decided once, and a second answer changes nothing", async () => {
    const { author, postId, entryId } = await removed();
    await ask(author, entryId);
    const platform = await platformModerator("Samtak");
    expect((await decide(platform, entryId, "upheld")).status).toBe(204);
    const second = await decide(platform, entryId, "overturned");
    expect(second.status).toBe(409);
    expect(await errorOf(second)).toBe("already_decided");
    expect(await logged(postId)).toEqual(["remove_post", "review_upheld"]);
    // The trigger holds under the check, for two moderators at the same moment.
    await expect(
      env.DB.prepare("UPDATE moderation_reviews SET state = 'overturned' WHERE entry_id = ?")
        .bind(entryId)
        .run(),
    ).rejects.toThrow(/already decided/);
    expect((await decide(platform, 999_999, "upheld")).status).toBe(404);
  });

  it("outlives the account of whoever decided it", async () => {
    const { author, entryId } = await removed();
    await ask(author, entryId);
    const platform = await platformModerator("Samtak");
    await decide(platform, entryId, "upheld");
    // A deleted account clears decided_by: the trigger takes that for no second decision.
    await env.DB.prepare("DELETE FROM accounts WHERE account_id = ?")
      .bind(platform.accountId)
      .run();
    const row = await env.DB.prepare(
      "SELECT state, decided_by FROM moderation_reviews WHERE entry_id = ?",
    )
      .bind(entryId)
      .first();
    expect(row).toEqual({ state: "upheld", decided_by: null });
    expect((await statements(author))[0]?.review?.state).toBe("upheld");
  });

  it("restores a comment", async () => {
    const [owner, author, reader] = [
      await person("Eigandi"),
      await person("Höfundur"),
      await person("Lesandi"),
    ];
    const id = await community(owner, "open", author, reader);
    const { postId } = await ok<{ postId: string }>(
      await owner.call("POST", `/v1/communities/${id}/posts`, { body: "Póstur" }),
    );
    const { commentId } = await ok<{ commentId: string }>(
      await author.call("POST", `/v1/posts/${postId}/comments`, { body: SECRET }),
    );
    expect((await act(owner, id, "remove_comment", commentId)).status).toBe(204);
    const [statement] = await statements(author);
    expect(statement).toMatchObject({ action: "remove_comment", body: SECRET, canAsk: true });
    await ask(author, statement!.entryId);
    const platform = await platformModerator("Samtak");
    expect((await decide(platform, statement!.entryId, "overturned")).status).toBe(204);
    expect((await statements(author))[0]?.review?.restored).toBe(true);
    expect((await noticesOf(author)).notifications[0]).toMatchObject({
      action: "review_overturned",
      postId,
      commentId,
    });
  });

  describe("an overturned older entry with a newer one standing", () => {
    /** A community with a member's post, and its owner, who moderates it. */
    async function posted() {
      const [owner, author, reader] = [
        await person("Eigandi"),
        await person("Höfundur"),
        await person("Lesandi"),
      ];
      const id = await community(owner, "open", author, reader);
      const { postId } = await ok<{ postId: string }>(
        await author.call("POST", `/v1/communities/${id}/posts`, { body: SECRET }),
      );
      return { owner, author, reader, id, postId };
    }

    /** The entry of `action` in the author's statements. */
    const entryOf = async (author: Person, action: string) =>
      (await statements(author)).find((s) => s.action === action)!.entryId;

    const reviewOf = async (author: Person, entryId: number) =>
      (await statements(author)).find((s) => s.entryId === entryId)?.review;

    it("leaves a post removed after it was hidden, and its own review may still restore it", async () => {
      const { owner, author, reader, id, postId } = await posted();
      expect((await act(owner, id, "hide_post", postId)).status).toBe(204);
      const hidden = await entryOf(author, "hide_post");
      // The asking comes first: the newer entry can land while the review waits.
      expect((await ask(author, hidden)).status).toBe(204);
      expect((await act(owner, id, "remove_post", postId)).status).toBe(204);

      const platform = await platformModerator("Samtak");
      expect((await decide(platform, hidden, "overturned", "Mistök")).status).toBe(204);
      expect(await reviewOf(author, hidden)).toMatchObject({
        state: "overturned",
        restored: false,
      });
      const [post] = await listOf(reader, `/v1/communities/${id}/posts`, KNOWING());
      expect(post).toMatchObject({ postId, state: "removed", body: "" });
      expect((await noticesOf(author)).notifications[0]).toMatchObject({
        action: "review_overturned",
      });

      const removal = await entryOf(author, "remove_post");
      expect((await ask(author, removal)).status).toBe(204);
      expect((await decide(platform, removal, "overturned")).status).toBe(204);
      expect((await reviewOf(author, removal))?.restored).toBe(true);
      const [back] = await listOf(reader, `/v1/communities/${id}/posts`, KNOWING());
      expect(back).toMatchObject({ postId, body: SECRET });
    });

    it("leaves a post hidden again after a restoring", async () => {
      const { owner, author, reader, id, postId } = await posted();
      expect((await act(owner, id, "hide_post", postId)).status).toBe(204);
      const first = await entryOf(author, "hide_post");
      expect((await act(owner, id, "restore_post", postId)).status).toBe(204);
      expect((await act(owner, id, "hide_post", postId)).status).toBe(204);
      // Asking about the older decision stays allowed.
      expect((await ask(author, first)).status).toBe(204);

      const platform = await platformModerator("Samtak");
      expect((await decide(platform, first, "overturned")).status).toBe(204);
      expect(await reviewOf(author, first)).toMatchObject({
        state: "overturned",
        restored: false,
      });
      expect(await listOf(reader, `/v1/communities/${id}/posts`, KNOWING())).toEqual([]);
    });

    it("leaves a comment removed after it was hidden", async () => {
      const { owner, author, reader, id, postId } = await posted();
      const { commentId } = await ok<{ commentId: string }>(
        await author.call("POST", `/v1/posts/${postId}/comments`, { body: SECRET }),
      );
      expect((await act(owner, id, "hide_comment", commentId)).status).toBe(204);
      const hidden = await entryOf(author, "hide_comment");
      expect((await ask(author, hidden)).status).toBe(204);
      expect((await act(owner, id, "remove_comment", commentId)).status).toBe(204);

      const platform = await platformModerator("Samtak");
      expect((await decide(platform, hidden, "overturned")).status).toBe(204);
      expect(await reviewOf(author, hidden)).toMatchObject({
        state: "overturned",
        restored: false,
      });
      const { comments } = await ok<{ comments: { commentId: string; body: string }[] }>(
        await reader.call("GET", `/v1/posts/${postId}/comments`),
      );
      expect(comments.find((c) => c.commentId === commentId)?.body ?? "").not.toContain(SECRET);
    });

    it("says the content is back when a moderator already restored it after the newer entry", async () => {
      const { owner, author, reader, id, postId } = await posted();
      expect((await act(owner, id, "hide_post", postId)).status).toBe(204);
      const first = await entryOf(author, "hide_post");
      expect((await ask(author, first)).status).toBe(204);
      expect((await act(owner, id, "hide_post", postId)).status).toBe(204);
      expect((await act(owner, id, "restore_post", postId)).status).toBe(204);

      const platform = await platformModerator("Samtak");
      expect((await decide(platform, first, "overturned")).status).toBe(204);
      expect((await reviewOf(author, first))?.restored).toBe(true);
      const [post] = await listOf(reader, `/v1/communities/${id}/posts`, KNOWING());
      expect(post).toMatchObject({ postId, body: SECRET });
      expect(await logged(postId)).toEqual([
        "hide_post",
        "hide_post",
        "restore_post",
        "review_overturned",
      ]);
    });

    it("logs no second restoring of what a moderator restored while the review waited", async () => {
      const { owner, author, id, postId } = await posted();
      expect((await act(owner, id, "hide_post", postId)).status).toBe(204);
      const hidden = await entryOf(author, "hide_post");
      expect((await ask(author, hidden)).status).toBe(204);
      expect((await act(owner, id, "restore_post", postId)).status).toBe(204);

      const platform = await platformModerator("Samtak");
      expect((await decide(platform, hidden, "overturned")).status).toBe(204);
      expect((await reviewOf(author, hidden))?.restored).toBe(true);
      expect(await logged(postId)).toEqual(["hide_post", "restore_post", "review_overturned"]);
    });

    /** A member's comment its owner hid, whose author has asked for the review. */
    async function commented() {
      const { owner, author, id, postId } = await posted();
      const { commentId } = await ok<{ commentId: string }>(
        await author.call("POST", `/v1/posts/${postId}/comments`, { body: SECRET }),
      );
      expect((await act(owner, id, "hide_comment", commentId)).status).toBe(204);
      const hidden = await entryOf(author, "hide_comment");
      expect((await ask(author, hidden)).status).toBe(204);
      return { owner, author, id, commentId, hidden };
    }

    const replayed = async (id: string, commentId: string) =>
      (await commentModeration(euEnv(env), id)).find((m) => m.commentId === commentId)?.state;

    it("keeps a comment removed in a space's replay when the overturn restored nothing", async () => {
      const { owner, id, commentId, hidden } = await commented();
      expect((await act(owner, id, "remove_comment", commentId)).status).toBe(204);

      const platform = await platformModerator("Samtak");
      expect((await decide(platform, hidden, "overturned")).status).toBe(204);
      expect(await logged(commentId)).toEqual([
        "hide_comment",
        "remove_comment",
        "review_overturned",
      ]);
      expect(await replayed(id, commentId)).toBe("removed");
    });

    it("replays a comment as visible when the overturn restored it, with no notice of its own", async () => {
      const { author, id, commentId, hidden } = await commented();

      const platform = await platformModerator("Samtak");
      expect((await decide(platform, hidden, "overturned", "Mistök")).status).toBe(204);
      expect(await logged(commentId)).toEqual([
        "hide_comment",
        "review_overturned",
        "restore_comment",
      ]);
      expect(await replayed(id, commentId)).toBe("visible");
      const actions = (await noticesOf(author)).notifications.map((n) => n.action);
      expect(actions).toContain("review_overturned");
      expect(actions).not.toContain("restore_comment");
    });
  });

  it("does not reach a member's sanction, which has no review yet", async () => {
    const [owner, member] = [await person("Eigandi"), await person("Meðlimur")];
    const id = await community(owner, "open", member);
    const muted = await owner.call("POST", `/v1/communities/${id}/actions`, {
      action: "mute_member",
      targetId: member.accountId,
      reason: "Ástæðan",
      until: Date.now() + 60_000,
    });
    expect(muted.status).toBe(204);
    expect(await statements(member)).toEqual([]);
  });
});

describe("a cleared photo", () => {
  const cleared = async () => {
    const [platform, other] = [await platformModerator("Sá"), await platformModerator("Hin")];
    const one = await person("Eigandi myndar");
    const set = await worker.fetch(`${BASE}/v1/me/photo`, {
      method: "PUT",
      headers: { ...one.auth, "content-type": "application/octet-stream" },
      body: await png(40, 30),
    });
    expect(set.status).toBe(200);
    const done = await platform.call("POST", "/v1/moderation/actions", {
      action: "clear_account_photo",
      targetId: one.accountId,
      reason: "Ástæðan",
    });
    expect(done.status).toBe(204);
    return { platform, other, one };
  };

  it("tells the person through a notice with no community, and only a knowing client", async () => {
    const { one } = await cleared();
    const page = await noticesOf(one);
    expect(page.notifications[0]).toMatchObject({
      kind: "moderated",
      communityId: null,
      action: "clear_account_photo",
      actor: null,
    });
    const old = await noticesOf(one, OLD);
    expect(old.notifications).toEqual([]);
    expect([old.unread, old.unseen]).toEqual([0, 0]);
  });

  it("may be reviewed, and overturning says the photo did not come back", async () => {
    const { one, platform, other } = await cleared();
    const [statement] = await statements(one);
    expect(statement).toMatchObject({ action: "clear_account_photo", body: null, canAsk: true });
    expect((await ask(one, statement!.entryId)).status).toBe(204);
    expect((await decide(platform, statement!.entryId, "overturned")).status).toBe(403);
    expect((await decide(other, statement!.entryId, "overturned", "Mistök")).status).toBe(204);
    expect((await statements(one))[0]?.review).toMatchObject({
      state: "overturned",
      restored: false,
    });
    expect((await noticesOf(one)).notifications[0]).toMatchObject({
      action: "review_overturned",
      communityId: null,
    });
  });
});
