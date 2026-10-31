import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { CLIENT_HEADER } from "../../../src/shared/client-version.ts";
import { png } from "../../images.ts";
import { worker } from "../../main.ts";
import { community, errorOf, ok, person, platformModerator, type Person } from "../../people.ts";
import { recorder, run } from "../notifications/support.ts";
import { type Audience, befriend, wallPost } from "../social/wall-support.ts";

// Moderation on a wall (decision 0115): a report goes to the platform's queue and
// not its owner's; a platform moderator reads through an open report alone, logged;
// and the owner removes a comment on their own wall with no review.

type Report = {
  reportId: string;
  onWall: boolean;
  communityId: string | null;
  target: { kind: string; id: string };
};

const report = (by: Person, kind: "post" | "comment", id: string) =>
  by.call("POST", "/v1/reports", { target: { kind, id }, reason: "spam" });

const queue = async (platform: Person) =>
  (await ok<{ reports: Report[] }>(await platform.call("GET", "/v1/moderation/reports"))).reports;

const reads = async (accountId: string) =>
  (
    await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM moderation_log WHERE actor_id = ? AND action = 'read_reported'",
    )
      .bind(accountId)
      .first<{ n: number }>()
  )?.n;

async function reportedPost(audience: Audience) {
  const owner = await person("eigandi");
  const friend = await person("vinur");
  await befriend(owner, friend);
  const platform = await platformModerator("Vettvangur");
  const post = await wallPost(owner, audience, "Texti á vegg");
  expect((await report(friend, "post", post.postId)).status).toBe(204);
  const filed = (await queue(platform)).find((r) => r.target.id === post.postId);
  if (!filed) throw new Error("not in the platform's queue");
  return { owner, friend, platform, post, filed };
}

describe("a report on a wall", () => {
  it.each(["friends", "everyone"] as const)(
    "of a %s post lands on the platform's queue, marked as a wall's",
    async (audience) => {
      const { filed, post } = await reportedPost(audience);
      expect(filed.onWall).toBe(true);
      expect(filed.target).toEqual({ kind: "post", id: post.postId });
    },
  );

  it("is neither seen nor closed by the wall's owner", async () => {
    const { owner, filed, post } = await reportedPost("friends");
    expect((await owner.call("GET", `/v1/communities/${post.communityId}/reports`)).status).toBe(
      404,
    );
    expect(
      (await owner.call("POST", `/v1/reports/${filed.reportId}/close`, { resolution: "x" })).status,
    ).toBe(404);
  });

  it("of a comment on it lands there too", async () => {
    const owner = await person("eigandi");
    const reader = await person("lesandi");
    const platform = await platformModerator("Vettvangur");
    const post = await wallPost(owner, "everyone");
    const { commentId } = await ok<{ commentId: string }>(
      await reader.call("POST", `/v1/posts/${post.postId}/comments`, { body: "Já" }),
    );
    expect((await report(owner, "comment", commentId)).status).toBe(204);
    const filed = (await queue(platform)).find((r) => r.target.id === commentId);
    expect(filed?.onWall).toBe(true);
  });

  it("cannot be filed by who cannot read the post", async () => {
    const owner = await person("eigandi");
    const stranger = await person("okunnugur");
    const post = await wallPost(owner, "friends");
    expect((await report(stranger, "post", post.postId)).status).toBe(404);
  });
});

describe("who moderates elsewhere, on each audience", () => {
  it.each([
    ["friends", 404],
    ["everyone", 200],
  ] as const)(
    "a community's moderator reads a %s post as anyone, report or none: %i",
    async (audience, status) => {
      const moderator = await person("stjornandi");
      await community(moderator, "open");
      const owner = await person("eigandi");
      const friend = await person("vinur");
      await befriend(owner, friend);
      const post = await wallPost(owner, audience);
      expect((await moderator.call("GET", `/v1/posts/${post.postId}`)).status).toBe(status);

      expect((await report(friend, "post", post.postId)).status).toBe(204);
      const platform = await platformModerator("Vettvangur");
      const filed = (await queue(platform)).find((r) => r.target.id === post.postId);
      expect((await moderator.call("GET", `/v1/posts/${post.postId}`)).status).toBe(status);
      const path = `/v1/moderation/reports/${filed?.reportId}/target`;
      expect((await moderator.call("GET", path)).status).toBe(403);
      const close = await moderator.call("POST", `/v1/reports/${filed?.reportId}/close`, {
        resolution: "dismissed",
      });
      expect(close.status).toBe(404);
    },
  );

  it.each([
    ["friends", 404],
    ["everyone", 200],
  ] as const)(
    "a platform moderator with no report on a %s post: %i, nothing logged",
    async (audience, status) => {
      const owner = await person("eigandi");
      const platform = await platformModerator("Vettvangur");
      const post = await wallPost(owner, audience);
      expect((await platform.call("GET", `/v1/posts/${post.postId}`)).status).toBe(status);
      expect(await reads(platform.accountId)).toBe(0);
    },
  );

  it.each(["friends", "everyone"] as const)(
    "a platform moderator with an open report on a %s post reads it, logged",
    async (audience) => {
      const { platform, filed } = await reportedPost(audience);
      const before = await reads(platform.accountId);
      const path = `/v1/moderation/reports/${filed.reportId}/target`;
      expect((await ok<{ body: string }>(await platform.call("GET", path))).body).toBe(
        "Texti á vegg",
      );
      expect(await reads(platform.accountId)).toBe((before ?? 0) + 1);
    },
  );
});

describe("a platform moderator on a wall", () => {
  it("reads a friends post only through an open report, each read logged", async () => {
    const { platform, post, filed } = await reportedPost("friends");
    const direct = await platform.call("GET", `/v1/posts/${post.postId}`);
    expect(direct.status).toBe(404);
    expect(await reads(platform.accountId)).toBe(0);

    const read = await ok<{ body: string | null; media: string[] }>(
      await platform.call("GET", `/v1/moderation/reports/${filed.reportId}/target`),
    );
    expect(read.body).toBe("Texti á vegg");
    expect(await reads(platform.accountId)).toBe(1);
  });

  it("reads an everyone post as any signed-in account does, and no more", async () => {
    const owner = await person("eigandi");
    const platform = await platformModerator("Vettvangur");
    const open = await wallPost(owner, "everyone");
    const closed = await wallPost(owner, "friends");
    expect((await platform.call("GET", `/v1/posts/${open.postId}`)).status).toBe(200);
    expect((await platform.call("GET", `/v1/posts/${closed.postId}`)).status).toBe(404);
  });

  it("reads a reported post's image only through its report, each read logged", async () => {
    const owner = await person("eigandi");
    const reader = await person("lesandi");
    const platform = await platformModerator("Vettvangur");
    await befriend(owner, reader);
    const { mediaId } = await ok<{ mediaId: string }>(
      await worker.fetch("https://spjall.test/v1/wall/media", {
        method: "POST",
        headers: { ...owner.auth, "content-type": "application/octet-stream" },
        body: await png(40, 30),
      }),
    );
    const post = await ok<{ postId: string }>(
      await owner.call("POST", "/v1/wall/posts", { body: "Mynd", media: [mediaId] }),
    );
    await report(reader, "post", post.postId);
    const filed = (await queue(platform)).find((r) => r.target.id === post.postId);
    const path = `/v1/moderation/reports/${filed?.reportId}`;

    const { media } = await ok<{ media: string[] }>(await platform.call("GET", `${path}/target`));
    expect(media).toEqual([mediaId]);
    const before = await reads(platform.accountId);
    const image = await platform.call("GET", `${path}/media/${mediaId}`);
    expect(image.status).toBe(200);
    expect(image.headers.get("cache-control")).toBe("private, no-store");
    expect(await reads(platform.accountId)).toBe((before ?? 0) + 1);

    const other = await platform.call("GET", `${path}/media/md_${"0".repeat(32)}`);
    expect(other.status).toBeGreaterThanOrEqual(400);
    expect(await reads(platform.accountId)).toBe((before ?? 0) + 1);
    expect((await reader.call("GET", `${path}/media/${mediaId}`)).status).toBe(403);
  });

  it("no longer reads it once the report is closed", async () => {
    const { platform, filed } = await reportedPost("friends");
    const closed = await platform.call("POST", `/v1/reports/${filed.reportId}/close`, {
      resolution: "dismissed",
    });
    expect(closed.status).toBe(204);
    const path = `/v1/moderation/reports/${filed.reportId}/target`;
    expect((await platform.call("GET", path)).status).toBe(404);
  });

  it("reaches nothing through that route as anyone else, nor for a community's report", async () => {
    const { owner, friend, filed } = await reportedPost("friends");
    const path = `/v1/moderation/reports/${filed.reportId}/target`;
    for (const by of [owner, friend]) {
      const answer = await by.call("GET", path);
      expect(answer.status).toBe(403);
    }
    const platform = await platformModerator("Annar");
    const moderator = await person("stjornandi");
    const communityId = await community(moderator, "open");
    const made = await ok<{ postId: string }>(
      await moderator.call("POST", `/v1/communities/${communityId}/posts`, { body: "Halló" }),
    );
    const unlawful = await moderator.call("POST", "/v1/reports", {
      target: { kind: "post", id: made.postId },
      reason: "unlawful",
    });
    expect(unlawful.status).toBe(204);
    const theirs = (await queue(platform)).find((r) => r.target.id === made.postId);
    if (!theirs) throw new Error("not in the queue");
    expect(theirs.onWall).toBe(false);
    const answer = await platform.call("GET", `/v1/moderation/reports/${theirs.reportId}/target`);
    expect(answer.status).toBe(404);
  });

  it("removes a reported post, closing its report, logged as the platform", async () => {
    const { platform, owner, friend, post, filed } = await reportedPost("friends");
    const acted = await platform.call("POST", `/v1/communities/${post.communityId}/actions`, {
      action: "remove_post",
      targetId: post.postId,
      reason: "Prófun",
      reportId: filed.reportId,
    });
    expect(acted.status).toBe(204);
    expect((await friend.call("GET", `/v1/posts/${post.postId}`)).status).toBe(404);
    expect((await queue(platform)).map((r) => r.reportId)).not.toContain(filed.reportId);
    const log = await env.DB.prepare(
      "SELECT as_platform AS asPlatform FROM moderation_log WHERE action = 'remove_post' AND target_id = ?",
    )
      .bind(post.postId)
      .first<{ asPlatform: number }>();
    expect(log?.asPlatform).toBe(1);
    expect(owner.accountId).not.toBe(platform.accountId);
  });

  it("clears a bio and a cover, each one row, and only one that is there", async () => {
    const owner = await person("eigandi");
    const platform = await platformModerator("Vettvangur");
    await owner.call("PUT", "/v1/me/bio", { bio: "Smiður" });
    const act = (action: string) =>
      platform.call("POST", "/v1/moderation/actions", {
        action,
        targetId: owner.accountId,
        reason: "Prófun",
      });
    expect((await act("clear_account_bio")).status).toBe(204);
    const wall = await ok<{ bio: string | null }>(
      await platform.call("GET", `/v1/accounts/${owner.accountId}/wall`),
    );
    expect(wall.bio).toBeNull();
    const again = await act("clear_account_bio");
    expect(again.status).toBe(404);
    expect((await act("clear_account_cover")).status).toBe(404);
  });

  it("sees no wall's text in the review queue, which is no way around a report", async () => {
    const { platform, owner, post, filed } = await reportedPost("friends");
    const second = await platformModerator("Annar");
    await platform.call("POST", `/v1/communities/${post.communityId}/actions`, {
      action: "remove_post",
      targetId: post.postId,
      reason: "Prófun",
      reportId: filed.reportId,
    });
    const { statements } = await ok<{ statements: { entryId: number; canAsk: boolean }[] }>(
      await owner.call("GET", "/v1/moderation/statements"),
    );
    const [statement] = statements;
    expect(statement?.canAsk).toBe(true);
    expect(
      (await owner.call("POST", `/v1/moderation/statements/${statement?.entryId}/review`)).status,
    ).toBeLessThan(300);
    const { reviews } = await ok<{ reviews: { entryId: number; body: string | null }[] }>(
      await second.call("GET", "/v1/moderation/reviews"),
    );
    const open = reviews.find((r) => r.entryId === statement?.entryId);
    expect(open).toMatchObject({ body: null });
  });
});

/** Runs every waiting job: one run takes a batch, and this file's earlier tests left some. */
const drained = async () => {
  for (let pass = 0; pass < 20; pass++) await run(recorder());
};

/** Below the wall's rung no client hears of a cleared bio, which it could not word. */
const belowWall = () => [
  "android/0.17.7",
  `android/${env.NOTICE_CLIENT_VERSION}`,
  `android/${env.SUSPENSION_NOTICE_CLIENT_VERSION}`,
  `android/${env.FRIEND_NOTICE_CLIENT_VERSION}`,
];

const kinds = async (one: Person, client: string) => {
  await drained();
  return (
    await ok<{ notifications: { kind: string }[] }>(
      await worker.fetch("https://spjall.test/v1/notifications", {
        headers: { ...one.auth, [CLIENT_HEADER]: client },
      }),
    )
  ).notifications.map((n) => n.kind);
};

describe("a wall's owner", () => {
  async function commented() {
    const owner = await person("eigandi");
    const reader = await person("lesandi");
    const post = await wallPost(owner, "everyone");
    const { commentId } = await ok<{ commentId: string }>(
      await reader.call("POST", `/v1/posts/${post.postId}/comments`, { body: "Bull" }),
    );
    return { owner, reader, post, commentId };
  }
  const remove = (by: Person, commentId: string) =>
    by.call("POST", `/v1/wall/comments/${commentId}/remove`, { reason: "Óviðeigandi" });

  it("removes a comment on it, logged as themselves and not as the platform", async () => {
    const { owner, reader, commentId } = await commented();
    expect((await remove(owner, commentId)).status).toBe(204);
    const log = await env.DB.prepare(
      `SELECT actor_id AS actor, as_platform AS asPlatform, target_account AS target
         FROM moderation_log WHERE action = 'remove_comment' AND target_id = ?`,
    )
      .bind(commentId)
      .first();
    expect(log).toEqual({ actor: owner.accountId, asPlatform: 0, target: reader.accountId });
  });

  it("tells the commenter, who may not ask for a review", async () => {
    const { owner, reader, commentId } = await commented();
    expect((await remove(owner, commentId)).status).toBe(204);
    const { statements } = await ok<{ statements: { entryId: number; canAsk: boolean }[] }>(
      await reader.call("GET", "/v1/moderation/statements"),
    );
    expect(statements.map((s) => s.canAsk)).toEqual([false]);
    const [statement] = statements;
    const asked = await reader.call(
      "POST",
      `/v1/moderation/statements/${statement?.entryId}/review`,
    );
    expect(asked.status).toBe(404);
    expect(await kinds(reader, `android/${env.WALL_NOTICE_CLIENT_VERSION}`)).toContain("moderated");
  });

  it("hears of a comment on it, and a client that cannot word that hears nothing", async () => {
    const { owner } = await commented();
    expect(await kinds(owner, `android/${env.WALL_NOTICE_CLIENT_VERSION}`)).toEqual(["comment"]);
    expect(await kinds(owner, "android/0.17.7")).toEqual([]);
    for (const version of [
      env.NOTICE_CLIENT_VERSION,
      env.SUSPENSION_NOTICE_CLIENT_VERSION,
      env.FRIEND_NOTICE_CLIENT_VERSION,
    ]) {
      expect(await kinds(owner, `android/${version}`)).toEqual([]);
    }
    const counted = await worker.fetch("https://spjall.test/v1/notifications", {
      headers: { ...owner.auth, [CLIENT_HEADER]: "android/0.17.7" },
    });
    expect((await ok<{ unread: number }>(counted)).unread).toBe(0);
  });

  it("removes nothing as anyone else, moderator of a community or commenter", async () => {
    const { reader, commentId } = await commented();
    const answer = await remove(reader, commentId);
    expect(answer.status).toBe(404);
    expect(await errorOf(answer)).toBe("not_found");
    expect((await remove(await person("okunnugur"), commentId)).status).toBe(404);
  });
});

describe("the notice of a cleared bio", () => {
  it("reaches a client that words it and no other", async () => {
    const owner = await person("eigandi");
    const platform = await platformModerator("Vettvangur");
    await owner.call("PUT", "/v1/me/bio", { bio: "Smiður" });
    await platform.call("POST", "/v1/moderation/actions", {
      action: "clear_account_bio",
      targetId: owner.accountId,
      reason: "Prófun",
    });
    expect(await kinds(owner, `android/${env.WALL_NOTICE_CLIENT_VERSION}`)).toContain("moderated");
    for (const client of belowWall()) expect(await kinds(owner, client)).toEqual([]);
  });
});
