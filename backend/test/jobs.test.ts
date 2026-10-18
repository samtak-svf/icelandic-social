import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { MAX_ATTEMPTS, runJobs } from "../src/modules/jobs/index.ts";
import { apnsPayload } from "../src/modules/messaging/push/apns.ts";
import { fcmMessage } from "../src/modules/messaging/push/fcm.ts";
import { sender } from "../src/modules/messaging/push/index.ts";
import { jobHandlers } from "../src/modules/notifications/index.ts";
import { community, ok, person, type Person } from "./people.ts";
import { apns, fcm, json, oauth, provider } from "./push.ts";
import { euEnv } from "./support.ts";

// Jobs and notifications (decision 0067, #290): a job written with the change
// that causes it, run by the cron until done or failed for good; a notice run
// twice is one notification and one push, and a push names nothing.

const MINUTE = 60_000;

/** A push sender that records the devices it was asked to push. */
function recorder() {
  const sent: string[] = [];
  return { sent, send: async ({ deviceId }: { deviceId: string }) => void sent.push(deviceId) };
}

const run = (push: { send: (p: { deviceId: string }) => Promise<void> }, at = Date.now() + 1) =>
  runJobs(euEnv(env), jobHandlers(push), at);

const jobOf = (key: string) =>
  env.DB.prepare("SELECT state, attempts, error FROM jobs WHERE key = ?")
    .bind(key)
    .first<{ state: string; attempts: number; error: string | null }>();

type Notification = {
  notificationId: string;
  kind: string;
  actor: { accountId: string } | null;
  postId: string | null;
  commentId: string | null;
  action: string | null;
  read: boolean;
};
const inbox = async (one: Person) =>
  ok<{ notifications: Notification[]; unread: number }>(await one.call("GET", "/v1/notifications"));

async function scene() {
  const [author, reader] = [await person("Höfundur"), await person("Lesandi")];
  const id = await community(author, "open", reader);
  const { postId } = await ok<{ postId: string }>(
    await author.call("POST", `/v1/communities/${id}/posts`, { body: "Póstur" }),
  );
  return { author, reader, id, postId };
}

describe("jobs", () => {
  it("tell a post's author of a comment once, however often they run", async () => {
    const { author, reader, postId } = await scene();
    const { commentId } = await ok<{ commentId: string }>(
      await reader.call("POST", `/v1/posts/${postId}/comments`, { body: "Flott" }),
    );
    // The job was written with the comment, before any cron ran.
    expect(await jobOf(`comment:${commentId}`)).toMatchObject({ state: "pending", attempts: 0 });
    expect((await inbox(author)).notifications).toEqual([]);

    const push = recorder();
    await run(push);
    expect(await jobOf(`comment:${commentId}`)).toMatchObject({ state: "done", attempts: 1 });
    // Run again, as a lease that ran out would: still one notification, one push.
    await env.DB.prepare("UPDATE jobs SET state = 'pending' WHERE key = ?")
      .bind(`comment:${commentId}`)
      .run();
    await run(push);
    expect(push.sent).toEqual([author.deviceId]);
    const { notifications, unread } = await inbox(author);
    expect(notifications).toEqual([
      expect.objectContaining({
        kind: "comment",
        actor: expect.objectContaining({ accountId: reader.accountId }),
        postId,
        commentId,
        read: false,
      }),
    ]);
    expect(unread).toBe(1);
    expect((await inbox(reader)).notifications).toEqual([]);

    expect((await author.call("POST", "/v1/notifications/read", { upTo: Date.now() })).status).toBe(
      204,
    );
    const after = await inbox(author);
    expect(after.unread).toBe(0);
    expect(after.notifications[0]?.read).toBe(true);
  });

  it("tell of a reaction once, and nothing across a block or to oneself", async () => {
    const { author, reader, postId } = await scene();
    for (const kind of ["like", "love", "like"]) {
      await reader.call("PUT", `/v1/posts/${postId}/reaction`, { kind });
    }
    await author.call("PUT", `/v1/posts/${postId}/reaction`, { kind: "like" });
    await author.call("POST", `/v1/posts/${postId}/comments`, { body: "Takk" });
    const push = recorder();
    await run(push);
    expect((await inbox(author)).notifications.map((n) => n.kind)).toEqual(["reaction"]);

    // A comment from an account the author then blocks is not told.
    const { commentId } = await ok<{ commentId: string }>(
      await reader.call("POST", `/v1/posts/${postId}/comments`, { body: "Hæ" }),
    );
    await author.call("PUT", `/v1/blocks/${reader.accountId}`);
    await run(push);
    expect(await jobOf(`comment:${commentId}`)).toMatchObject({ state: "done" });
    expect((await inbox(author)).notifications.map((n) => n.kind)).toEqual(["reaction"]);
    expect(push.sent).toEqual([author.deviceId]);
  });

  it("tell of an approved join request and of a moderator's action, across a block", async () => {
    const [owner, asker] = [await person("Eigandi"), await person("Umsækjandi")];
    const id = await community(owner, "private");
    expect(await ok(await asker.call("POST", `/v1/communities/${id}/join`))).toMatchObject({
      state: "requested",
    });
    // Approving a request that is not there writes no job.
    const none = await person("Enginn");
    await owner.call("POST", `/v1/communities/${id}/join-requests/${none.accountId}`);
    expect(
      (await owner.call("POST", `/v1/communities/${id}/join-requests/${asker.accountId}`)).status,
    ).toBe(204);
    const { postId } = await ok<{ postId: string }>(
      await asker.call("POST", `/v1/communities/${id}/posts`, { body: "Halló" }),
    );
    await run(recorder());
    expect((await inbox(asker)).notifications.map((n) => n.kind)).toEqual(["join_approved"]);
    await asker.call("PUT", `/v1/blocks/${owner.accountId}`);
    await owner.call("POST", `/v1/communities/${id}/actions`, {
      action: "hide_post",
      targetId: postId,
      reason: "Utan efnis",
    });
    await run(recorder());
    const told = (await inbox(asker)).notifications;
    expect(told.map((n) => [n.kind, n.action])).toEqual([
      ["moderated", "hide_post"],
      ["join_approved", null],
    ]);
    expect((await inbox(none)).notifications).toEqual([]);
  });

  it("end a failing job failed after its retries, with its reason kept in the row", async () => {
    const { reader, postId } = await scene();
    const { commentId } = await ok<{ commentId: string }>(
      await reader.call("POST", `/v1/posts/${postId}/comments`, { body: "Flott" }),
    );
    const down = { send: async () => Promise.reject(new Error("fcm 503")) };
    let at = Date.now() + 1;
    const outcomes = [];
    for (let attempt = 1; attempt <= MAX_ATTEMPTS + 1; attempt += 1) {
      outcomes.push(await run(down, at));
      at += 16 * MINUTE;
    }
    expect(outcomes.map((o) => [o.retried, o.failed])).toEqual([
      ...Array.from({ length: MAX_ATTEMPTS - 1 }, () => [1, 0]),
      [0, 1],
      [0, 0],
    ]);
    expect(await jobOf(`comment:${commentId}`)).toEqual({
      state: "failed",
      attempts: MAX_ATTEMPTS,
      error: "fcm 503",
    });
  });

  it("wait their backoff between tries", async () => {
    const { reader, postId } = await scene();
    await reader.call("POST", `/v1/posts/${postId}/comments`, { body: "Flott" });
    const down = { send: async () => Promise.reject(new Error("down")) };
    const at = Date.now() + 1;
    expect(await run(down, at)).toEqual({ done: 0, retried: 1, failed: 0 });
    expect(await run(down, at + MINUTE - 1)).toEqual({ done: 0, retried: 0, failed: 0 });
    expect(await run(recorder(), at + MINUTE)).toEqual({ done: 1, retried: 0, failed: 0 });
  });

  it("push a social notification with the chat payload, which names nothing", async () => {
    const { author, reader, id, postId } = await scene();
    await env.DB.prepare(
      "UPDATE devices SET platform = 'android', push_token = ? WHERE device_id = ?",
    )
      .bind("fcm-social-1", author.deviceId)
      .run();
    const { account } = await fcm();
    const { fetch, seen } = provider(oauth(), json({ name: "m/1" }));
    const { commentId } = await ok<{ commentId: string }>(
      await reader.call("POST", `/v1/posts/${postId}/comments`, { body: "Leyndarmál" }),
    );
    await run(sender({ fcm: account, fetch }, env.DB));
    const pushed = seen.at(-1)!.body;
    expect(JSON.parse(pushed)).toEqual(fcmMessage("fcm-social-1"));
    for (const named of [id, postId, commentId, reader.accountId, "Leyndarmál", "Lesandi"]) {
      expect(pushed).not.toContain(named);
    }

    // And on iOS, the fallback alert with no custom keys.
    await env.DB.prepare(
      "UPDATE devices SET platform = 'ios', push_token = ?, push_sandbox = 1 WHERE device_id = ?",
    )
      .bind("a1b2c3", author.deviceId)
      .run();
    const { key } = await apns();
    const apple = provider(new Response(null, { status: 200 }));
    await reader.call("PUT", `/v1/posts/${postId}/reaction`, { kind: "like" });
    await run(sender({ apns: key, fetch: apple.fetch }, env.DB));
    expect(JSON.parse(apple.seen[0]!.body)).toEqual(apnsPayload());
  });
});
