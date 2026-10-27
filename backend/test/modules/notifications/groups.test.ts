import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { ok } from "../../people.ts";
import { inbox, recorder, run, scene, tick } from "./support.ts";

// Grouped notifications (decision 0103): one row for each account, kind and
// post or parent comment, with the accounts that caused it on the row.

const actorRows = async (notificationId: string) =>
  (
    await env.DB.prepare("SELECT event_id FROM notification_actors WHERE notification_id = ?")
      .bind(notificationId)
      .all()
  ).results.length;

describe("grouped notifications", () => {
  it("make one row of two reactors, newest first, and count one reactor once", async () => {
    const { author, readers, postId } = await scene("Fyrst", "Annar");
    const [first, second] = readers as [(typeof readers)[0], (typeof readers)[0]];
    await first.call("PUT", `/v1/posts/${postId}/reaction`, { kind: "like" });
    await run(recorder());
    await tick();
    await second.call("PUT", `/v1/posts/${postId}/reaction`, { emoji: "🙏" });
    await run(recorder(), Date.now() + 10);
    // The same reactor changing its reaction is the same job: nothing more.
    await second.call("PUT", `/v1/posts/${postId}/reaction`, { kind: "like" });
    await run(recorder(), Date.now() + 20);

    const { notifications, unread } = await inbox(author);
    expect(unread).toBe(1);
    expect(notifications).toHaveLength(1);
    const [row] = notifications;
    expect(row).toMatchObject({
      kind: "reaction",
      postId,
      actorCount: 2,
      // The newest actor's values, as apps before the grouping read them.
      actor: { accountId: second.accountId },
      emoji: "🙏",
    });
    expect(row!.actors.map((a) => a.accountId)).toEqual([second.accountId, first.accountId]);
    expect(row!.notificationId).toBe(`reaction:${postId}:${author.accountId}`);
  });

  it("count a commenter who comments twice once, and name the newest three", async () => {
    const { author, readers, postId } = await scene("A", "B", "C", "D");
    const [a, b, c, d] = readers as [
      (typeof readers)[0],
      (typeof readers)[0],
      (typeof readers)[0],
      (typeof readers)[0],
    ];
    for (const who of [a, b, a, c, d]) {
      await who.call("POST", `/v1/posts/${postId}/comments`, { body: "Hæ" });
      await run(recorder());
      await tick();
    }
    const { notifications } = await inbox(author);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({ kind: "comment", actorCount: 4 });
    expect(notifications[0]!.actors.map((x) => x.accountId)).toEqual([
      d.accountId,
      c.accountId,
      a.accountId,
    ]);
  });

  it("tell the author of a parent comment of a reply, as a reply", async () => {
    const { author, readers, postId } = await scene("Foreldri", "Svarandi");
    const [parent, replier] = readers as [(typeof readers)[0], (typeof readers)[0]];
    const { commentId } = await ok<{ commentId: string }>(
      await parent.call("POST", `/v1/posts/${postId}/comments`, { body: "Fyrst" }),
    );
    await replier.call("POST", `/v1/posts/${postId}/comments`, {
      body: "Svar",
      parentCommentId: commentId,
    });
    await run(recorder());
    const { notifications } = await inbox(parent);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      kind: "reply",
      notificationId: `reply:${commentId}:${parent.accountId}`,
      actor: { accountId: replier.accountId },
      actorCount: 1,
    });
    // The author is told of both comments, as one comment notification.
    expect((await inbox(author)).notifications.map((n) => [n.kind, n.actorCount])).toEqual([
      ["comment", 2],
    ]);
  });

  it("run a job twice to one actor and one push", async () => {
    const { author, readers, postId } = await scene("Lesandi");
    const [reader] = readers as [(typeof readers)[0]];
    const { commentId } = await ok<{ commentId: string }>(
      await reader.call("POST", `/v1/posts/${postId}/comments`, { body: "Flott" }),
    );
    const push = recorder();
    await run(push);
    await env.DB.prepare("UPDATE jobs SET state = 'pending' WHERE key = ?")
      .bind(`comment:${commentId}`)
      .run();
    await run(push, Date.now() + 10);
    expect(push.sent).toEqual([author.deviceId]);
    expect(await actorRows(`comment:${postId}:${author.accountId}`)).toBe(1);
  });

  it("send the push of a job that stopped between the row and the push", async () => {
    const { author, readers, postId } = await scene("Lesandi");
    const [reader] = readers as [(typeof readers)[0]];
    const { commentId } = await ok<{ commentId: string }>(
      await reader.call("POST", `/v1/posts/${postId}/comments`, { body: "Flott" }),
    );
    const down = { send: async () => Promise.reject(new Error("fcm 503")) };
    await run(down);
    // The row and the actor are there, unpushed; the retry pushes and writes nothing twice.
    expect(await actorRows(`comment:${postId}:${author.accountId}`)).toBe(1);
    const push = recorder();
    await run(push, Date.now() + 2 * 60_000);
    expect(push.sent).toEqual([author.deviceId]);
    expect(await actorRows(`comment:${postId}:${author.accountId}`)).toBe(1);
    expect(
      (
        await env.DB.prepare("SELECT pushed_at FROM notification_actors WHERE event_id = ?")
          .bind(`comment:${commentId}`)
          .first<{ pushed_at: number | null }>()
      )?.pushed_at,
    ).not.toBeNull();
  });

  it("make a read group unread again and move it to the top on a new actor", async () => {
    const { author, readers, postId } = await scene("A", "B");
    const [a, b] = readers as [(typeof readers)[0], (typeof readers)[0]];
    await a.call("PUT", `/v1/posts/${postId}/reaction`, { kind: "like" });
    await run(recorder());
    await tick();
    await a.call("POST", `/v1/posts/${postId}/comments`, { body: "Hæ" });
    await run(recorder(), Date.now() + 10);
    await tick();
    const before = await inbox(author);
    expect(before.notifications.map((n) => n.kind)).toEqual(["comment", "reaction"]);
    await author.call("POST", "/v1/notifications/read", { upTo: Date.now() + 1000 });
    expect((await inbox(author)).unread).toBe(0);

    await b.call("PUT", `/v1/posts/${postId}/reaction`, { kind: "like" });
    await run(recorder(), Date.now() + 20);
    const after = await inbox(author);
    expect(after.unread).toBe(1);
    expect(after.notifications.map((n) => [n.kind, n.read, n.actorCount])).toEqual([
      ["reaction", false, 2],
      ["comment", true, 1],
    ]);
  });
});
