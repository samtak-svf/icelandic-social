import type { D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { expireFriendRequests } from "../../../src/compose/friends.ts";
import { CLIENT_HEADER } from "../../../src/shared/client-version.ts";
import { worker } from "../../main.ts";
import { person } from "../../people.ts";
import { euEnv } from "../../support.ts";
import { recorder, run, scene, tick } from "../notifications/support.ts";
import { accept, age, ask, cancel, decline, noticesAs, unfriend } from "./support.ts";

// The two notices of a friend (decision 0114), who is told, and that a client
// from before them reads its list and counts as if neither existed.

const BASE = "https://spjall.test";

const settle = async (push = recorder()) => {
  await run(push);
  await tick();
  return push;
};

describe("who is told", () => {
  it("tells the recipient of a request, and pushes without a name", async () => {
    const [a, b] = [await person("Anna"), await person("Bjarni")];
    await ask(a, b);
    const push = await settle();
    expect(push.sent.length).toBeGreaterThan(0);
    const page = await noticesAs(b);
    expect(page.notifications.map((n) => [n.kind, n.actor?.accountId, n.communityId])).toEqual([
      ["friend_request", a.accountId, null],
    ]);
    expect((await noticesAs(a)).notifications).toEqual([]);
  });

  it("tells the sender of an accept and withdraws the recipient's notice", async () => {
    const [a, b] = [await person("Anna"), await person("Bjarni")];
    await ask(a, b);
    await settle();
    await accept(b, a);
    await settle();
    expect((await noticesAs(a)).notifications.map((n) => [n.kind, n.actor?.accountId])).toEqual([
      ["friend_accepted", b.accountId],
    ]);
    expect((await noticesAs(b)).notifications).toEqual([]);
  });

  it("tells the earlier sender when two ask each other", async () => {
    const [a, b] = [await person("Anna"), await person("Bjarni")];
    await ask(a, b);
    await settle();
    await ask(b, a);
    await settle();
    expect((await noticesAs(a)).notifications.map((n) => n.kind)).toEqual(["friend_accepted"]);
    expect((await noticesAs(b)).notifications).toEqual([]);
  });

  it("withdraws the notice on a decline, and tells the sender nothing", async () => {
    const [a, b] = [await person("Anna"), await person("Bjarni")];
    await ask(a, b);
    await settle();
    await decline(b, a);
    await settle();
    expect((await noticesAs(b)).notifications).toEqual([]);
    expect((await noticesAs(a)).notifications).toEqual([]);
  });

  it("withdraws the notice on a cancel and on expiry", async () => {
    const [a, b, c] = [await person("Anna"), await person("Bjarni"), await person("Dóra")];
    await ask(a, b);
    await ask(c, b);
    await settle();
    expect((await noticesAs(b)).notifications.length).toBe(2);
    await cancel(a, b);
    expect((await noticesAs(b)).notifications.map((n) => n.actor?.accountId)).toEqual([
      c.accountId,
    ]);
    await age(c, b, 31);
    await expireFriendRequests(euEnv(env));
    expect((await noticesAs(b)).notifications).toEqual([]);
  });

  it("writes nothing when the request was taken back before its job ran", async () => {
    const [a, b] = [await person("Anna"), await person("Bjarni")];
    await ask(a, b);
    await cancel(a, b);
    await settle();
    expect((await noticesAs(b)).notifications).toEqual([]);
  });

  it("tells nobody that a friendship ended", async () => {
    const [a, b] = [await person("Anna"), await person("Bjarni")];
    await ask(a, b);
    await accept(b, a);
    await settle();
    const before = (await noticesAs(a)).notifications.length;
    await unfriend(b, a);
    await settle();
    expect((await noticesAs(a)).notifications.length).toBe(before);
    expect((await noticesAs(b)).notifications).toEqual([]);
  });

  it("answers its level from the kind, off and unpushed alike", async () => {
    const [a, b, c] = [await person("Anna"), await person("Bjarni"), await person("Dóra")];
    const quiet = { kinds: { friend_request: "in_app" } };
    expect((await b.call("PUT", "/v1/notification-settings", quiet)).status).toBeLessThan(300);
    await ask(a, b);
    const push = await settle();
    expect(push.sent).toEqual([]);
    expect((await noticesAs(b)).notifications.length).toBe(1);
    const off = { kinds: { friend_request: "off" } };
    expect((await c.call("PUT", "/v1/notification-settings", off)).status).toBeLessThan(300);
    await ask(a, c);
    await settle();
    expect((await noticesAs(c)).notifications).toEqual([]);
    // The request itself stands whatever the recipient chose to hear of it.
    expect((await c.call("GET", "/v1/friend-requests")).status).toBe(200);
  });
});

describe("a client from before friends", () => {
  for (const version of ["0.17.7", "0.19.0", "0.20.0"]) {
    for (const platform of ["android", "ios"]) {
      it(`${platform}/${version} reads its list and counts as if there were none`, async () => {
        const { author, readers, postId } = await scene("Lesandi", "Vinur");
        const [reader, friend] = readers;
        await reader!.call("PUT", `/v1/posts/${postId}/reaction`, { kind: "like" });
        await settle();
        const client = `${platform}/${version}`;
        const before = await noticesAs(author, client);
        expect(before.notifications.map((n) => n.kind)).toEqual(["reaction"]);

        // One of each kind reaches this account, on top of the row it already has.
        await ask(friend!, author);
        await ask(author, reader!);
        await accept(reader!, author);
        await settle();

        const after = await noticesAs(author, client);
        expect(after.notifications.map((n) => n.notificationId)).toEqual(
          before.notifications.map((n) => n.notificationId),
        );
        expect([after.unread, after.unseen]).toEqual([before.unread, before.unseen]);

        const current = await noticesAs(author);
        expect(current.notifications.map((n) => n.kind).sort()).toEqual([
          "friend_accepted",
          "friend_request",
          "reaction",
        ]);
        expect(current.unread).toBe(3);
      });
    }
  }

  it("does not mark as read what it was never shown", async () => {
    const [a, b] = [await person("Anna"), await person("Bjarni")];
    await ask(a, b);
    await settle();
    const read = await worker.fetch(`${BASE}/v1/notifications/read`, {
      method: "POST",
      headers: { ...b.auth, [CLIENT_HEADER]: "android/0.19.0", "content-type": "application/json" },
      body: JSON.stringify({ upTo: Date.now() + 1000 }),
    });
    expect(read.status).toBe(204);
    expect((await noticesAs(b)).unread).toBe(1);
  });

  it("reaches the web build the Worker serves", async () => {
    const [a, b] = [await person("Anna"), await person("Bjarni")];
    await ask(a, b);
    await settle();
    const page = await noticesAs(b, `web/${env.MIN_CLIENT_VERSION_WEB}`);
    expect(page.notifications.map((n) => n.kind)).toEqual(["friend_request"]);
  });
});

describe("migration 0041", () => {
  // The first statements create tables that exist already; the rebuild is what
  // can lose a row, and it can be run again as it is.
  const rebuild = () => {
    const { TEST_MIGRATIONS } = env as unknown as { TEST_MIGRATIONS: D1Migration[] };
    const migration = TEST_MIGRATIONS.find((m) => m.name.startsWith("0041_"))!;
    const statements = migration.queries
      .map((q) => q.replace(/^\s*--.*$/gm, "").trim())
      .filter(Boolean);
    const from = statements.findIndex((q) => q.startsWith("CREATE TABLE notification_actors_kept"));
    expect(from).toBeGreaterThan(0);
    return statements.slice(from);
  };
  const all = async (table: string, order: string) =>
    (await env.DB.prepare(`SELECT * FROM ${table} ORDER BY ${order}`).all()).results;

  it("keeps every row, actor and setting, and widens only the kinds", async () => {
    for (const table of ["notifications", "notification_settings"]) {
      await env.DB.prepare(`DELETE FROM ${table}`).run();
    }
    const { author, readers, postId } = await scene("Lesandi", "Annar");
    for (const reader of readers) {
      await reader.call("PUT", `/v1/posts/${postId}/reaction`, { kind: "like" });
    }
    await ask(readers[0]!, author);
    await settle();
    await env.DB.prepare("UPDATE notifications SET read_at = 77 WHERE kind = 'reaction'").run();
    await author.call("PUT", "/v1/notification-settings", { kinds: { comment: "in_app" } });
    const before = {
      rows: await all("notifications", "notification_id"),
      actors: await all("notification_actors", "event_id"),
      kinds: await all("notification_settings", "account_id, kind"),
    };
    expect(before.rows.length).toBe(2);
    expect(before.actors.length).toBeGreaterThan(1);
    expect(before.kinds.length).toBe(1);

    await env.DB.batch(rebuild().map((q) => env.DB.prepare(q)));

    expect(await all("notifications", "notification_id")).toEqual(before.rows);
    expect(await all("notification_actors", "event_id")).toEqual(before.actors);
    expect(await all("notification_settings", "account_id, kind")).toEqual(before.kinds);

    const { results: left } = await env.DB.prepare(
      `SELECT name, sql FROM sqlite_master WHERE name LIKE 'notification%' ORDER BY name`,
    ).all<{ name: string; sql: string }>();
    expect(left.map((t) => t.name)).toEqual([
      "notification_actors",
      "notification_actors_by_actor",
      "notification_actors_by_group",
      "notification_seen",
      "notification_settings",
      "notifications",
      "notifications_by_account",
      "notifications_by_actor",
      "notifications_by_age",
    ]);
    expect(left.find((t) => t.name === "notification_actors")!.sql).toContain(
      "REFERENCES notifications (notification_id)",
    );

    // The foreign keys still hold, and a row an old version writes still fits.
    await env.DB.prepare("DELETE FROM notifications WHERE kind = 'friend_request'").run();
    expect((await all("notification_actors", "event_id")).length).toBe(before.actors.length - 1);
    await env.DB.prepare(
      `INSERT INTO notifications (notification_id, account_id, kind, created_at)
       VALUES ('old-writer', ?, 'comment', 1)`,
    )
      .bind(author.accountId)
      .run();
  });

  it("refuses a kind nobody declared", async () => {
    const one = await person("Einn");
    await expect(
      env.DB.prepare(
        `INSERT INTO notifications (notification_id, account_id, kind, created_at)
         VALUES ('bad', ?, 'friend_poked', 1)`,
      )
        .bind(one.accountId)
        .run(),
    ).rejects.toThrow();
  });
});
