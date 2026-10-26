import { runDurableObjectAlarm } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { CLOSED_KEPT_MS, expireReports } from "../../../src/modules/moderation/reports.ts";
import { purgeRemoved } from "../../../src/modules/social/index.ts";
import { REMOVED_KEPT_MS } from "../../../src/modules/social/do/space-schema.ts";
import { euEnv } from "../../support.ts";
import { community, errorOf, ok, person, type Person } from "../../people.ts";

// Moderation (decisions 0063, 0066, #289): who may act on whom, the log entry
// every action leaves, mutes and bans, and reports in their two queues.

const DAY = 24 * 60 * 60 * 1000;

async function platformModerator(name: string): Promise<Person> {
  const one = await person(name);
  await env.DB.prepare("INSERT INTO platform_moderators (account_id, added_at) VALUES (?, ?)")
    .bind(one.accountId, Date.now())
    .run();
  return one;
}

const act = (by: Person, communityId: string, body: Record<string, unknown>) =>
  by.call("POST", `/v1/communities/${communityId}/actions`, { reason: "Prófun", ...body });

const postBy = async (author: Person, communityId: string, body = "Póstur") =>
  (
    await ok<{ postId: string }>(
      await author.call("POST", `/v1/communities/${communityId}/posts`, { body }),
    )
  ).postId;

type Entry = {
  action: string;
  actor: { accountId: string } | null;
  asPlatform: boolean;
  target: { kind: string; id: string };
  targetAccount: { accountId: string } | null;
  reason: string;
};

const logOf = async (by: Person, communityId: string) =>
  (
    await ok<{ entries: Entry[] }>(
      await by.call("GET", `/v1/communities/${communityId}/moderation-log`),
    )
  ).entries;

describe("moderation", () => {
  it("is done only by a moderator, and only to a lower rank", async () => {
    const [owner, moderator, other, member, outsider] = [
      await person("Eigandi"),
      await person("Stjórnandi"),
      await person("Annar stjórnandi"),
      await person("Meðlimur"),
      await person("Utangarðs"),
    ];
    const platform = await platformModerator("Samtak");
    const id = await community(owner, "private", moderator, other, member);
    for (const one of [moderator, other]) {
      await owner.call("PUT", `/v1/communities/${id}/members/${one.accountId}/role`, {
        role: "moderator",
      });
    }
    const posts = {
      owner: await postBy(owner, id),
      moderator: await postBy(moderator, id),
      member: await postBy(member, id),
    };
    const cases: [string, Person, string, number][] = [
      ["a member hides a post", member, posts.member, 403],
      ["an outsider hides a post", outsider, posts.member, 404],
      ["a moderator hides the owner's post", moderator, posts.owner, 403],
      ["a moderator hides another moderator's", other, posts.moderator, 403],
      ["a moderator hides its own", moderator, posts.moderator, 403],
      ["a moderator hides a member's", moderator, posts.member, 204],
      ["the owner hides a moderator's", owner, posts.moderator, 204],
      ["Samtak hides the owner's", platform, posts.owner, 204],
    ];
    const differs: string[] = [];
    for (const [name, by, postId, wanted] of cases) {
      const status = (await act(by, id, { action: "hide_post", targetId: postId })).status;
      if (status !== wanted) differs.push(`${name}: ${status}, not ${wanted}`);
    }
    expect(differs).toEqual([]);
    // A moderator of another community acts on nothing here.
    const elsewhere = await community(member, "open");
    expect(
      (await act(member, elsewhere, { action: "hide_post", targetId: posts.member })).status,
    ).toBe(404);
    // Member sanctions follow the same ranks.
    expect(
      (await act(moderator, id, { action: "ban_member", targetId: other.accountId })).status,
    ).toBe(403);
    expect(
      (await act(moderator, id, { action: "ban_member", targetId: owner.accountId })).status,
    ).toBe(403);
    expect(
      (await act(platform, id, { action: "remove_member", targetId: owner.accountId })).status,
    ).toBe(204);
    // The owner cannot be removed even so: the row stays.
    const left = await env.DB.prepare(
      "SELECT role FROM community_members WHERE community_id = ? AND account_id = ?",
    )
      .bind(id, owner.accountId)
      .first<{ role: string }>();
    expect(left?.role).toBe("owner");
  });

  it("leaves one log entry for every action, which nothing edits", async () => {
    const [owner, member] = [await person("Eigandi"), await person("Meðlimur")];
    const platform = await platformModerator("Samtak");
    const id = await community(owner, "open", member);
    const postId = await postBy(member, id);
    const { commentId } = await ok<{ commentId: string }>(
      await member.call("POST", `/v1/posts/${postId}/comments`, { body: "Athugasemd" }),
    );
    const done: [string, string][] = [
      ["hide_post", postId],
      ["restore_post", postId],
      ["remove_post", postId],
      ["hide_comment", commentId],
      ["restore_comment", commentId],
      ["remove_comment", commentId],
      ["unmute_member", member.accountId],
      ["remove_member", member.accountId],
      ["ban_member", member.accountId],
      ["unban_member", member.accountId],
    ];
    expect(
      (
        await act(owner, id, {
          action: "mute_member",
          targetId: member.accountId,
          until: Date.now() + DAY,
        })
      ).status,
    ).toBe(204);
    for (const [action, targetId] of done) {
      expect((await act(owner, id, { action, targetId })).status, action).toBe(204);
    }
    expect(
      (await act(platform, id, { action: "ban_member", targetId: member.accountId })).status,
    ).toBe(204);
    const entries = await logOf(owner, id);
    expect(entries.map((e) => e.action)).toEqual(
      ["mute_member", ...done.map(([a]) => a), "ban_member"].reverse(),
    );
    expect(entries[0]).toMatchObject({
      actor: { accountId: platform.accountId },
      asPlatform: true,
      target: { kind: "account", id: member.accountId },
      targetAccount: { accountId: member.accountId },
      reason: "Prófun",
    });
    expect(
      entries.slice(1).every((e) => e.actor?.accountId === owner.accountId && !e.asPlatform),
    ).toBe(true);
    // A refused action leaves nothing.
    expect((await act(member, id, { action: "hide_post", targetId: postId })).status).toBe(404);
    expect(await logOf(owner, id)).toHaveLength(entries.length);
    // The log is read by moderators, and Samtak's spans every community.
    expect(await errorOf(await member.call("GET", `/v1/communities/${id}/moderation-log`))).toBe(
      "not_found",
    );
    const all = await ok<{ entries: Entry[] }>(await platform.call("GET", "/v1/moderation/log"));
    expect(all.entries.length).toBeGreaterThanOrEqual(entries.length);
    expect((await owner.call("GET", "/v1/moderation/log")).status).toBe(403);
    // Nothing edits or deletes an entry.
    await expect(
      env.DB.prepare("UPDATE moderation_log SET reason = 'annað' WHERE community_id = ?")
        .bind(id)
        .run(),
    ).rejects.toThrow(/append-only/);
    await expect(
      env.DB.prepare("DELETE FROM moderation_log WHERE community_id = ?").bind(id).run(),
    ).rejects.toThrow(/append-only/);
    // An actor's deletion leaves its entries, without its id.
    await env.DB.prepare("DELETE FROM accounts WHERE account_id = ?")
      .bind(platform.accountId)
      .run();
    expect((await logOf(owner, id))[0]?.actor).toBeNull();
    // The entries go with their community, and only then.
    await env.DB.prepare("DELETE FROM communities WHERE community_id = ?").bind(id).run();
    const left = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM moderation_log WHERE community_id = ?",
    )
      .bind(id)
      .first<{ n: number }>();
    expect(left?.n).toBe(0);
  });

  it("mutes until a time, removes and bans", async () => {
    const [owner, member] = [await person("Eigandi"), await person("Meðlimur")];
    const id = await community(owner, "open", member);
    const mute = { action: "mute_member", targetId: member.accountId };
    expect((await act(owner, id, mute)).status).toBe(400);
    expect((await act(owner, id, { ...mute, until: Date.now() - 1 })).status).toBe(400);
    expect(
      (
        await act(owner, id, {
          action: "ban_member",
          targetId: member.accountId,
          until: Date.now() + DAY,
        })
      ).status,
    ).toBe(400);
    expect((await act(owner, id, { ...mute, until: Date.now() + DAY })).status).toBe(204);
    const posting = () => member.call("POST", `/v1/communities/${id}/posts`, { body: "Hæ" });
    expect(await errorOf(await posting())).toBe("muted");
    expect((await member.call("GET", `/v1/communities/${id}/posts`)).status).toBe(200);
    const mine = await ok<{ mutedUntil: number | null }>(
      await member.call("GET", `/v1/communities/${id}`),
    );
    expect(mine.mutedUntil).toBeGreaterThan(Date.now());
    expect(
      (await act(owner, id, { action: "unmute_member", targetId: member.accountId })).status,
    ).toBe(204);
    expect((await posting()).status).toBe(200);

    expect(
      (await act(owner, id, { action: "remove_member", targetId: member.accountId })).status,
    ).toBe(204);
    expect(
      (await act(owner, id, { action: "remove_member", targetId: member.accountId })).status,
    ).toBe(404);
    expect((await member.call("POST", `/v1/communities/${id}/join`)).status).toBe(200);
    expect(
      (await act(owner, id, { action: "ban_member", targetId: member.accountId })).status,
    ).toBe(204);
    expect((await member.call("GET", `/v1/communities/${id}/posts`)).status).toBe(404);
    expect((await member.call("POST", `/v1/communities/${id}/join`)).status).not.toBe(200);
    expect(
      (await act(owner, id, { action: "unban_member", targetId: member.accountId })).status,
    ).toBe(204);
    expect(
      (await act(owner, id, { action: "unban_member", targetId: member.accountId })).status,
    ).toBe(404);
    expect((await member.call("POST", `/v1/communities/${id}/join`)).status).toBe(200);
  });

  it("takes reports into the community's queue or Samtak's, never naming the reporter", async () => {
    const [owner, author, reader, witness, outsider] = [
      await person("Eigandi"),
      await person("Höfundur"),
      await person("Lesandi"),
      await person("Vitni"),
      await person("Utangarðs"),
    ];
    const platform = await platformModerator("Samtak");
    const id = await community(owner, "private", author, reader, witness);
    const postId = await postBy(author, id);
    const report = (by: Person, body: Record<string, unknown>) =>
      by.call("POST", "/v1/reports", { reason: "spam", ...body });
    const target = { kind: "post", id: postId };
    expect((await report(reader, { target, note: "Auglýsing" })).status).toBe(204);
    expect((await report(reader, { target })).status).toBe(204);
    // Once per reporter while open, whatever the reason.
    expect((await report(reader, { target, reason: "unlawful" })).status).toBe(204);
    expect((await report(witness, { target, reason: "unlawful" })).status).toBe(204);
    // Only what the reporter can see.
    expect((await report(outsider, { target })).status).toBe(404);
    expect((await report(reader, { target: { kind: "account", id: "acct_none" } })).status).toBe(
      404,
    );
    expect(
      (await report(outsider, { target: { kind: "account", id: author.accountId } })).status,
    ).toBe(204);

    type Page = { reports: Record<string, unknown>[] };
    const queue = await ok<Page>(await owner.call("GET", `/v1/communities/${id}/reports`));
    expect(queue.reports).toHaveLength(1);
    expect(queue.reports[0]).toMatchObject({
      target,
      targetAccount: { accountId: author.accountId },
      reason: "spam",
      note: "Auglýsing",
      state: "open",
    });
    expect(JSON.stringify(queue)).not.toContain(reader.accountId);
    const platformQueue = await ok<Page>(await platform.call("GET", "/v1/moderation/reports"));
    const ours = platformQueue.reports.filter(
      (r) => r.communityId === id || (r.target as { id: string }).id === author.accountId,
    );
    expect(ours.map((r) => r.reason).sort()).toEqual(["spam", "unlawful"]);
    expect(JSON.stringify(platformQueue)).not.toContain(witness.accountId);
    expect(JSON.stringify(platformQueue)).not.toContain(reader.accountId);
    expect((await reader.call("GET", `/v1/communities/${id}/reports`)).status).toBe(403);
    expect((await owner.call("GET", "/v1/moderation/reports")).status).toBe(403);

    // Acting on a report closes it; a platform report is Samtak's to close.
    const spam = String(queue.reports[0]?.reportId);
    const unlawful = String(ours.find((r) => r.reason === "unlawful")?.reportId);
    expect(
      (await act(owner, id, { action: "hide_post", targetId: postId, reportId: unlawful })).status,
    ).toBe(403);
    expect(
      (await owner.call("POST", `/v1/reports/${unlawful}/close`, { resolution: "Nei" })).status,
    ).toBe(403);
    expect(
      (await reader.call("POST", `/v1/reports/${spam}/close`, { resolution: "Nei" })).status,
    ).toBe(404);
    expect(
      (await act(owner, id, { action: "hide_post", targetId: postId, reportId: spam })).status,
    ).toBe(204);
    expect(
      (await ok<Page>(await owner.call("GET", `/v1/communities/${id}/reports`))).reports,
    ).toEqual([]);
    const closed = await ok<Page>(
      await owner.call("GET", `/v1/communities/${id}/reports?state=closed`),
    );
    expect(closed.reports.map((r) => r.reportId)).toEqual([spam]);
    // A closed report says what was done, why, and by whom.
    expect(closed.reports[0]).toMatchObject({
      decision: "hide_post",
      resolution: "Prófun",
      closedBy: { accountId: owner.accountId },
      targetState: "hidden",
      targetStanding: "member",
    });
    expect(
      (await platform.call("POST", `/v1/reports/${unlawful}/close`, { resolution: "Fjarlægt" }))
        .status,
    ).toBe(204);
    expect(
      (await platform.call("POST", `/v1/reports/${unlawful}/close`, { resolution: "Aftur" }))
        .status,
    ).toBe(404);
    expect((await logOf(owner, id)).map((e) => e.action)).toEqual(["close_report", "hide_post"]);
    const dismissed = (
      await ok<Page>(await platform.call("GET", "/v1/moderation/reports?state=closed"))
    ).reports.find((r) => r.reportId === unlawful);
    expect(dismissed).toMatchObject({
      decision: "dismissed",
      resolution: "Fjarlægt",
      closedBy: { accountId: platform.accountId },
    });
    // A closed report is kept a year, an open one until it is closed.
    const closedAt = Date.now();
    expect(await expireReports(env, closedAt)).toBe(0);
    const left = await expireReports(env, closedAt + CLOSED_KEPT_MS + DAY);
    expect(left).toBeGreaterThanOrEqual(2);
    expect(
      (await ok<Page>(await owner.call("GET", `/v1/communities/${id}/reports?state=closed`)))
        .reports,
    ).toEqual([]);
    await report(reader, { target: { kind: "community", id } });
    // A reporter's deletion leaves the report, without the reporter.
    await env.DB.prepare("DELETE FROM accounts WHERE account_id = ?").bind(reader.accountId).run();
    const kept = await env.DB.prepare(
      "SELECT reporter_id FROM reports WHERE target_kind = 'community' AND target_id = ?",
    )
      .bind(id)
      .first<{ reporter_id: string | null }>();
    expect(kept).toEqual({ reporter_id: null });
  });

  it("deletes a removed post's and comment's text 90 days after the removal", async () => {
    const [owner, member] = [await person("Eigandi"), await person("Meðlimur")];
    const id = await community(owner, "open", member);
    const removed = await postBy(member, id, "Fjarlægður");
    const kept = await postBy(member, id, "Falinn");
    const { commentId } = await ok<{ commentId: string }>(
      await member.call("POST", `/v1/posts/${kept}/comments`, { body: "Fjarlægð" }),
    );
    expect((await act(owner, id, { action: "remove_post", targetId: removed })).status).toBe(204);
    expect((await act(owner, id, { action: "hide_post", targetId: kept })).status).toBe(204);
    expect((await act(owner, id, { action: "remove_comment", targetId: commentId })).status).toBe(
      204,
    );

    const at = Date.now();
    expect(await purgeRemoved(euEnv(env), at)).toBe(0);
    expect(await purgeRemoved(euEnv(env), at + REMOVED_KEPT_MS + DAY)).toBeGreaterThanOrEqual(1);
    expect((await owner.call("GET", `/v1/posts/${removed}`)).status).toBe(404);
    expect((await owner.call("GET", `/v1/posts/${kept}`)).status).toBe(200);

    // The space's alarm deletes the comment once its 90 days are past.
    const stub = env.SPACE.getByName(id);
    await stub.moderateComment(commentId, "removed", at - REMOVED_KEPT_MS - 1);
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(await stub.comment(commentId)).toBeNull();
  });

  it("tells a report's queue where its target stands now (#359–#362)", async () => {
    const [owner, author, reader] = [
      await person("Eigandi"),
      await person("Höfundur"),
      await person("Lesandi"),
    ];
    const id = await community(owner, "open", author, reader);
    const postId = await postBy(author, id);
    await reader.call("POST", "/v1/reports", {
      reason: "spam",
      target: { kind: "post", id: postId },
    });
    type Standing = { targetStanding: string | null; targetState: string | null; decision: null };
    const now = async () =>
      (await ok<{ reports: Standing[] }>(await owner.call("GET", `/v1/communities/${id}/reports`)))
        .reports[0];
    expect(await now()).toMatchObject({
      targetStanding: "member",
      targetState: "visible",
      decision: null,
    });
    expect((await act(owner, id, { action: "hide_post", targetId: postId })).status).toBe(204);
    expect(await now()).toMatchObject({ targetState: "hidden" });
    expect((await act(owner, id, { action: "restore_post", targetId: postId })).status).toBe(204);
    expect(await now()).toMatchObject({ targetState: "visible" });
    const on = (action: string, extra: Record<string, unknown> = {}) =>
      act(owner, id, { action, targetId: author.accountId, ...extra });
    expect((await on("mute_member", { until: Date.now() + DAY })).status).toBe(204);
    expect(await now()).toMatchObject({ targetStanding: "muted" });
    expect((await on("unmute_member")).status).toBe(204);
    const role = `/v1/communities/${id}/members/${author.accountId}/role`;
    expect((await owner.call("PUT", role, { role: "moderator" })).status).toBe(204);
    expect(await now()).toMatchObject({ targetStanding: "moderator" });
    expect((await owner.call("PUT", role, { role: "member" })).status).toBe(204);
    expect((await on("remove_member")).status).toBe(204);
    expect(await now()).toMatchObject({ targetStanding: "not_member" });
    expect((await on("ban_member")).status).toBe(204);
    expect(await now()).toMatchObject({ targetStanding: "banned" });
    await env.DB.prepare("DELETE FROM accounts WHERE account_id = ?").bind(author.accountId).run();
    expect(await now()).toMatchObject({ targetStanding: "gone" });
  });
});
