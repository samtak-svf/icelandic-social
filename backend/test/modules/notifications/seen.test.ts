import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { community, errorOf, person } from "../../people.ts";
import { inbox, recorder, run, scene, tick } from "./support.ts";

// Seen, read one by one, and delete (decision 0104). Seen is about the badge:
// what the caller has had in front of it. Read is about each notification.

async function two() {
  const { author, readers, postId } = await scene("A", "B");
  const [a, b] = readers as [(typeof readers)[0], (typeof readers)[0]];
  await a.call("PUT", `/v1/posts/${postId}/reaction`, { kind: "like" });
  await run(recorder());
  await tick();
  await b.call("POST", `/v1/posts/${postId}/comments`, { body: "Hæ" });
  await run(recorder());
  return { author, a, b, postId };
}

describe("seen, read and delete", () => {
  it("count what is unseen apart from what is unread", async () => {
    const { author } = await two();
    const before = await inbox(author);
    expect(before).toMatchObject({ unread: 2, unseen: 2, seenAt: null });
    const [newest, oldest] = before.notifications as [
      (typeof before.notifications)[0],
      (typeof before.notifications)[0],
    ];

    // Seen up to the older one: the newer is unseen, both still unread.
    const response = await author.call("POST", "/v1/notifications/seen", {
      upTo: oldest.createdAt,
    });
    expect(response.status).toBe(204);
    expect(await inbox(author)).toMatchObject({
      unread: 2,
      unseen: 1,
      seenAt: oldest.createdAt,
    });
    // Seen never moves back.
    await author.call("POST", "/v1/notifications/seen", { upTo: 1 });
    expect((await inbox(author)).seenAt).toBe(oldest.createdAt);
    await author.call("POST", "/v1/notifications/seen", { upTo: newest.createdAt });
    expect(await inbox(author)).toMatchObject({ unread: 2, unseen: 0, seenAt: newest.createdAt });

    // Read the other way round: reading does not move seen.
    await author.call("POST", "/v1/notifications/read", { upTo: newest.createdAt });
    expect(await inbox(author)).toMatchObject({ unread: 0, unseen: 0, seenAt: newest.createdAt });
  });

  it("read one notification and unread it again", async () => {
    const { author } = await two();
    const [newest, oldest] = (await inbox(author)).notifications as unknown as [
      { notificationId: string },
      { notificationId: string },
    ];
    const mark = (notificationId: string, read: boolean) =>
      author.call("POST", "/v1/notifications/read", { notificationId, read });
    expect((await mark(oldest.notificationId, true)).status).toBe(204);
    let page = await inbox(author);
    expect(page.unread).toBe(1);
    expect(page.notifications.map((n) => n.read)).toEqual([false, true]);
    expect((await mark(oldest.notificationId, false)).status).toBe(204);
    page = await inbox(author);
    expect(page.notifications.map((n) => n.read)).toEqual([false, false]);
    expect(page.notifications[0]!.notificationId).toBe(newest.notificationId);
  });

  it("answer 404 for another account's notification and 400 for a body of both or neither", async () => {
    const { author, a } = await two();
    const id = (await inbox(author)).notifications[0]!.notificationId;
    const read = await a.call("POST", "/v1/notifications/read", { notificationId: id, read: true });
    expect(read.status).toBe(404);
    expect(await errorOf(read)).toBe("not_found");
    expect((await author.call("POST", "/v1/notifications/read", {})).status).toBe(400);
    expect(
      (
        await author.call("POST", "/v1/notifications/read", {
          upTo: 1,
          notificationId: id,
          read: true,
        })
      ).status,
    ).toBe(400);
    expect(
      (await author.call("POST", "/v1/notifications/read", { notificationId: id })).status,
    ).toBe(400);
    expect((await inbox(author)).unread).toBe(2);
  });

  it("delete the caller's own notification with its actors, and no one else's", async () => {
    const { author, a } = await two();
    const id = (await inbox(author)).notifications[0]!.notificationId;
    const path = `/v1/notifications/${encodeURIComponent(id)}`;
    expect((await a.call("DELETE", path)).status).toBe(404);
    expect((await inbox(author)).notifications).toHaveLength(2);

    expect((await author.call("DELETE", path)).status).toBe(204);
    expect((await author.call("DELETE", path)).status).toBe(404);
    expect((await inbox(author)).notifications).toHaveLength(1);
    const left = await env.DB.prepare(
      "SELECT count(*) AS n FROM notification_actors WHERE notification_id = ?",
    )
      .bind(id)
      .first<{ n: number }>();
    expect(left?.n).toBe(0);
  });

  it("keep seen for an account with no notifications", async () => {
    const one = await person("Nýr");
    await community(one, "open");
    expect(await inbox(one)).toMatchObject({ unread: 0, unseen: 0, seenAt: null });
  });
});
