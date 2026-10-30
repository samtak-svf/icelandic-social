import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { community, errorOf, ok, person } from "../../people.ts";
import { inbox, recorder, run, scene, tick } from "./support.ts";

// Notification settings (decision 0106): a level for each kind and for each
// community, the lower of the two applies when a notice runs, and a missing
// row means push. Moderation is never below in_app.

type Settings = {
  kinds: Record<string, string>;
  communities: { communityId: string; level: string }[];
};

const settingsOf = async (one: Awaited<ReturnType<typeof person>>) =>
  ok<Settings>(await one.call("GET", "/v1/notification-settings"));

const comment = async (who: Awaited<ReturnType<typeof person>>, postId: string) =>
  ok<{ commentId: string }>(await who.call("POST", `/v1/posts/${postId}/comments`, { body: "Hæ" }));

describe("notification settings", () => {
  it("default to push for every kind, with no community stored", async () => {
    const one = await person("Ný");
    expect(await settingsOf(one)).toEqual({
      kinds: {
        comment: "push",
        reply: "push",
        reaction: "push",
        join_approved: "push",
        moderated: "push",
        friend_request: "push",
        friend_accepted: "push",
      },
      communities: [],
    });
  });

  it("change only the kinds given, and refuse off for moderated", async () => {
    const one = await person("Ný");
    expect(
      (await one.call("PUT", "/v1/notification-settings", { kinds: { reaction: "off" } })).status,
    ).toBe(204);
    expect(
      (await one.call("PUT", "/v1/notification-settings", { kinds: { comment: "in_app" } })).status,
    ).toBe(204);
    expect((await settingsOf(one)).kinds).toMatchObject({
      comment: "in_app",
      reaction: "off",
      reply: "push",
    });
    const refused = await one.call("PUT", "/v1/notification-settings", {
      kinds: { moderated: "off" },
    });
    expect(refused.status).toBe(400);
    expect(
      (await one.call("PUT", "/v1/notification-settings", { kinds: { moderated: "in_app" } }))
        .status,
    ).toBe(204);
    expect(
      (await one.call("PUT", "/v1/notification-settings", { kinds: { comment: "loud" } })).status,
    ).toBe(400);
    expect((await settingsOf(one)).kinds.moderated).toBe("in_app");
  });

  it("write nothing for off: no row, no actor, no push, and the job is done", async () => {
    const { author, readers, postId } = await scene("Lesandi");
    await author.call("PUT", "/v1/notification-settings", { kinds: { comment: "off" } });
    const { commentId } = await comment(readers[0]!, postId);
    const push = recorder();
    await run(push);
    expect(push.sent).toEqual([]);
    expect((await inbox(author)).notifications).toEqual([]);
    expect(
      (await env.DB.prepare("SELECT count(*) n FROM notification_actors").first<{ n: number }>())
        ?.n,
    ).toBe(0);
    expect(
      await env.DB.prepare("SELECT state FROM jobs WHERE key = ?")
        .bind(`comment:${commentId}`)
        .first(),
    ).toEqual({ state: "done" });
  });

  it("write the row for in_app but send no push, and run again to the same", async () => {
    const { author, readers, postId } = await scene("Lesandi");
    await author.call("PUT", "/v1/notification-settings", { kinds: { comment: "in_app" } });
    const { commentId } = await comment(readers[0]!, postId);
    const push = recorder();
    await run(push);
    await env.DB.prepare("UPDATE jobs SET state = 'pending' WHERE key = ?")
      .bind(`comment:${commentId}`)
      .run();
    await run(push, Date.now() + 10);
    expect(push.sent).toEqual([]);
    const page = await inbox(author);
    expect(page.notifications).toHaveLength(1);
    // Nothing to announce: the row is unread but its level is in_app.
    expect(page.notifications[0]).toMatchObject({ read: false, announce: false });
  });

  it("apply the lower of the kind and the community level", async () => {
    const { author, readers, id, postId } = await scene("Lesandi");
    const [reader] = readers as [(typeof readers)[0]];
    // The kind pushes, the community is off: off wins.
    expect(
      (await author.call("PUT", `/v1/communities/${id}/notification-level`, { level: "off" }))
        .status,
    ).toBe(204);
    await comment(reader, postId);
    const push = recorder();
    await run(push);
    expect((await inbox(author)).notifications).toEqual([]);
    expect(push.sent).toEqual([]);
    expect((await settingsOf(author)).communities).toEqual([{ communityId: id, level: "off" }]);
    // Back to push: the next comment is told, with a push.
    await author.call("PUT", `/v1/communities/${id}/notification-level`, { level: "push" });
    await tick();
    await comment(reader, postId);
    await run(push, Date.now() + 10);
    expect(push.sent).toEqual([author.deviceId]);
    expect((await inbox(author)).notifications[0]).toMatchObject({ announce: true });
  });

  it("keep moderation at in_app whatever is stored", async () => {
    const [owner, member] = [await person("Eigandi"), await person("Félagi")];
    const id = await community(owner, "open", member);
    const { postId } = await ok<{ postId: string }>(
      await member.call("POST", `/v1/communities/${id}/posts`, { body: "Halló" }),
    );
    // Stored behind the API's back, as a row from before the rule would be.
    await env.DB.prepare(
      "INSERT INTO notification_settings (account_id, kind, level) VALUES (?, 'moderated', 'off')",
    )
      .bind(member.accountId)
      .run();
    await owner.call("POST", `/v1/communities/${id}/actions`, {
      action: "hide_post",
      targetId: postId,
      reason: "Utan efnis",
    });
    const push = recorder();
    await run(push);
    expect(push.sent).toEqual([]);
    const [row] = (await inbox(member)).notifications;
    expect(row).toMatchObject({ kind: "moderated", announce: false });
  });

  it("stop announcing a row once its community goes in_app", async () => {
    const { author, readers, id, postId } = await scene("Lesandi");
    await comment(readers[0]!, postId);
    await run(recorder());
    expect((await inbox(author)).notifications[0]).toMatchObject({ read: false, announce: true });
    await author.call("PUT", `/v1/communities/${id}/notification-level`, { level: "in_app" });
    expect((await inbox(author)).notifications[0]).toMatchObject({ read: false, announce: false });
    await author.call("PUT", `/v1/communities/${id}/notification-level`, { level: "push" });
    await author.call("POST", "/v1/notifications/read", { upTo: Date.now() + 1000 });
    expect((await inbox(author)).notifications[0]).toMatchObject({ read: true, announce: false });
  });

  it("answer 404 to a community level for one the caller cannot read", async () => {
    const [owner, outsider] = [await person("Eigandi"), await person("Utanaðkomandi")];
    const id = await community(owner, "private");
    const response = await outsider.call("PUT", `/v1/communities/${id}/notification-level`, {
      level: "off",
    });
    expect(response.status).toBe(404);
    expect(await errorOf(response)).toBe("not_found");
    expect((await settingsOf(outsider)).communities).toEqual([]);
  });
});
