import type { D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { noticeHandler } from "../../../src/modules/notifications/notify.ts";
import { shownTo } from "../../../src/modules/notifications/list.ts";
import { CLIENT_HEADER } from "../../../src/shared/client-version.ts";
import { png } from "../../images.ts";
import { worker } from "../../main.ts";
import { community, ok, person, platformModerator, type Person } from "../../people.ts";
import { euEnv } from "../../support.ts";
import { recorder, run, scene, tick, type Page } from "./support.ts";

// The notice that reports wait in the platform's queue (decision 0115): one row
// per moderator, by nobody and about nothing, for as long as the queue holds a
// report, on the web only.

const BASE = "https://spjall.test";

/** The list as the web reads it, the only client that words this kind. */
const webPage = async (one: Person, client = `web/${env.MIN_CLIENT_VERSION_WEB}`) =>
  ok<Page>(
    await worker.fetch(`${BASE}/v1/notifications`, {
      headers: { ...one.auth, [CLIENT_HEADER]: client },
    }),
  );

const waiting = async (one: Person, client?: string) =>
  (await webPage(one, client)).notifications.filter((n) => n.kind === "reports_waiting");

/** `by` reports the account `target`, which always goes to the platform. */
const reportAccount = async (by: Person, target: Person) => {
  const response = await by.call("POST", "/v1/reports", {
    target: { kind: "account", id: target.accountId },
    reason: "spam",
    note: "",
  });
  expect(response.status).toBe(204);
};

const settle = async (push = recorder()) => {
  await run(push);
  await tick();
  return push;
};

const openReports = async () =>
  (
    await env.DB.prepare(
      "SELECT report_id AS id FROM reports WHERE to_platform = 1 AND state = 'open'",
    ).all<{ id: string }>()
  ).results.map((r) => r.id);

const close = async (by: Person, reportId: string) => {
  const response = await by.call("POST", `/v1/reports/${reportId}/close`, { resolution: "Lokið" });
  expect(response.status).toBe(204);
};

const markRead = async (one: Person, notificationId: string) => {
  const response = await one.call("POST", "/v1/notifications/read", {
    notificationId,
    read: true,
  });
  expect(response.status).toBeLessThan(300);
};

// The tests of a file share one D1, and the queue and its moderators are global.
beforeEach(async () => {
  await env.DB.batch(
    ["jobs", "reports", "platform_moderators", "notifications"].map((table) =>
      env.DB.prepare(`DELETE FROM ${table}`),
    ),
  );
});

describe("the row", () => {
  it("is one per moderator, moved to now and unread by each new report", async () => {
    const moderator = await platformModerator("Samtak");
    const [one, two, target] = await Promise.all(["A", "B", "C"].map((name) => person(name)));
    await reportAccount(one!, target!);
    await settle();
    const [first] = await waiting(moderator);
    expect(first?.read).toBe(false);
    expect(first?.communityId).toBeNull();
    expect(first?.postId).toBeNull();

    await reportAccount(two!, target!);
    await settle();
    const rows = await waiting(moderator);
    expect(rows.length).toBe(1);
    expect(rows[0]!.createdAt).toBeGreaterThan(first!.createdAt);
    expect(rows[0]!.read).toBe(false);
  });

  it("is unread again when a report arrives after it was read", async () => {
    const moderator = await platformModerator("Samtak");
    const [one, two, target] = await Promise.all(["A", "B", "C"].map((name) => person(name)));
    await reportAccount(one!, target!);
    await settle();
    const [row] = await waiting(moderator);
    await markRead(moderator, row!.notificationId);
    expect((await waiting(moderator))[0]!.read).toBe(true);

    await reportAccount(two!, target!);
    await settle();
    expect((await waiting(moderator))[0]!.read).toBe(false);
  });

  it("is each moderator's own", async () => {
    const [a, b] = [await platformModerator("Fyrri"), await platformModerator("Seinni")];
    await reportAccount(await person("Tilkynnandi"), await person("Tilkynntur"));
    await settle();
    const [ofA] = await waiting(a);
    const [ofB] = await waiting(b);
    expect(ofA).toBeDefined();
    expect(ofB).toBeDefined();
    expect(ofA!.notificationId).not.toBe(ofB!.notificationId);
  });

  it("carries no reporter or target, in the list or in the tables", async () => {
    const moderator = await platformModerator("Samtak");
    const [reporter, target] = [await person("Tilkynnandi"), await person("Tilkynntur")];
    // The moderator has blocked the reporter: a moderator's duty outranks that.
    const block = await moderator.call("PUT", `/v1/blocks/${reporter.accountId}`);
    expect(block.status).toBeLessThan(300);
    await reportAccount(reporter, target);
    await settle();

    const [row] = await waiting(moderator);
    expect(row).toMatchObject({ actor: null, actors: [], actorCount: 0, snippet: null });
    const said = JSON.stringify(await webPage(moderator));
    expect(said).not.toContain(reporter.accountId);
    expect(said).not.toContain(target.accountId);
    for (const [table, where] of [
      ["notifications", "kind = 'reports_waiting'"],
      ["notification_actors", "notification_id LIKE 'reports_waiting:%'"],
    ]) {
      const { results } = await env.DB.prepare(`SELECT * FROM ${table} WHERE ${where}`).all<{
        actor_id: string | null;
      }>();
      expect(results.length).toBe(1);
      expect(results[0]!.actor_id).toBeNull();
    }
  });
});

describe("who is told", () => {
  it("is not the moderator who made the report, but is another", async () => {
    const [reporter, other] = [await platformModerator("Sá"), await platformModerator("Hinn")];
    await reportAccount(reporter, await person("Tilkynntur"));
    await settle();
    expect(await waiting(reporter)).toEqual([]);
    expect((await waiting(other)).length).toBe(1);
  });

  it("is nobody who is not a moderator, the reporter and the reported included", async () => {
    await platformModerator("Samtak");
    const [reporter, target] = [await person("Tilkynnandi"), await person("Tilkynntur")];
    const bystander = await person("Annar");
    await reportAccount(reporter, target);
    await settle();
    for (const one of [reporter, target, bystander]) expect(await waiting(one)).toEqual([]);
  });

  it("follows the queue: a community's report does not tell, one sent up does", async () => {
    const moderator = await platformModerator("Samtak");
    const { readers, postId } = await scene("Fyrri", "Seinni");
    const report = (by: Person, toPlatform: boolean) =>
      by.call("POST", "/v1/reports", {
        target: { kind: "post", id: postId },
        reason: "spam",
        note: "",
        toPlatform,
      });
    expect((await report(readers[0]!, false)).status).toBe(204);
    await settle();
    expect(await waiting(moderator)).toEqual([]);
    expect((await report(readers[1]!, true)).status).toBe(204);
    await settle();
    expect((await waiting(moderator)).length).toBe(1);
  });

  it("is not moved by a community's report while the platform's queue holds one", async () => {
    const moderator = await platformModerator("Samtak");
    const { readers, postId } = await scene("Lesandi");
    await reportAccount(await person("Tilkynnandi"), await person("Tilkynntur"));
    await settle();
    const [row] = await waiting(moderator);
    await markRead(moderator, row!.notificationId);

    const inCommunity = await readers[0]!.call("POST", "/v1/reports", {
      target: { kind: "post", id: postId },
      reason: "spam",
      note: "",
    });
    expect(inCommunity.status).toBe(204);
    await settle();
    expect((await waiting(moderator))[0]!.read).toBe(true);
  });

  it("is nobody when a report already open is sent again", async () => {
    const moderator = await platformModerator("Samtak");
    const [reporter, target] = [await person("Tilkynnandi"), await person("Tilkynntur")];
    await reportAccount(reporter, target);
    await settle();
    const [row] = await waiting(moderator);
    await markRead(moderator, row!.notificationId);

    await reportAccount(reporter, target);
    await settle();
    expect((await waiting(moderator))[0]!.read).toBe(true);
  });

  it("is nobody once the queue has emptied or the account has left the list", async () => {
    const [stays, leaves] = [await platformModerator("Fyrri"), await platformModerator("Seinni")];
    await reportAccount(await person("Tilkynnandi"), await person("Tilkynntur"));
    await env.DB.prepare("DELETE FROM platform_moderators WHERE account_id = ?")
      .bind(leaves.accountId)
      .run();
    await settle();
    expect(await waiting(leaves)).toEqual([]);
    expect((await waiting(stays)).length).toBe(1);

    await close(stays, (await openReports())[0]!);
    await reportAccount(await person("Annar"), await person("Þriðji"));
    await close(stays, (await openReports())[0]!);
    await settle();
    expect(await waiting(stays)).toEqual([]);
  });

  it("has one effect when the job runs twice", async () => {
    const moderator = await platformModerator("Samtak");
    await reportAccount(await person("Tilkynnandi"), await person("Tilkynntur"));
    await settle();
    const [row] = await waiting(moderator);
    await markRead(moderator, row!.notificationId);

    const push = recorder();
    const job = noticeHandler(push);
    const key = "reports_waiting:twice";
    const payload = {
      kind: "reports_waiting",
      accountId: moderator.accountId,
      actorId: null,
      communityId: null,
    };
    await job(euEnv(env), key, payload);
    const once = (await waiting(moderator))[0]!;
    expect(once.read).toBe(false);
    await markRead(moderator, once.notificationId);
    await tick();
    await job(euEnv(env), key, payload);

    const rows = await waiting(moderator);
    expect(rows.length).toBe(1);
    expect(rows[0]!.createdAt).toBe(once.createdAt);
    expect(rows[0]!.read).toBe(true);
    const { results } = await env.DB.prepare(
      "SELECT event_id FROM notification_actors WHERE event_id = ?",
    )
      .bind(key)
      .all();
    expect(results.length).toBe(1);
    expect(push.sent).toEqual([]);
  });
});

describe("when it stops being true", () => {
  it("goes with the last open report, and stays while one is open", async () => {
    const moderator = await platformModerator("Samtak");
    const [one, two, target] = await Promise.all(["A", "B", "C"].map((name) => person(name)));
    await reportAccount(one!, target!);
    await reportAccount(two!, target!);
    await settle();
    const [first, second] = await openReports();

    await close(moderator, first!);
    expect((await waiting(moderator)).length).toBe(1);
    await close(moderator, second!);
    expect(await waiting(moderator)).toEqual([]);
    expect(
      (
        await env.DB.prepare(
          "SELECT COUNT(*) AS n FROM notification_actors WHERE notification_id LIKE 'reports_waiting:%'",
        ).first<{ n: number }>()
      )?.n,
    ).toBe(0);
  });

  it("goes when a moderator's action closes the last report", async () => {
    const moderator = await platformModerator("Samtak");
    const target = await person("Tilkynntur");
    const photo = await worker.fetch(`${BASE}/v1/me/photo`, {
      method: "PUT",
      headers: { ...target.auth, "content-type": "application/octet-stream" },
      body: await png(40, 30),
    });
    expect(photo.status).toBe(200);
    await reportAccount(await person("Tilkynnandi"), target);
    await settle();
    expect((await waiting(moderator)).length).toBe(1);

    const acted = await moderator.call("POST", "/v1/moderation/actions", {
      action: "clear_account_photo",
      targetId: target.accountId,
      reason: "Prófun",
      reportId: (await openReports())[0],
    });
    expect(acted.status).toBeLessThan(300);
    expect(await openReports()).toEqual([]);
    expect(await waiting(moderator)).toEqual([]);
  });

  it("goes when deleting a community closes the last report", async () => {
    const moderator = await platformModerator("Samtak");
    const owner = await person("Eigandi");
    const id = await community(owner, "open");
    const reported = await owner.call("POST", "/v1/reports", {
      target: { kind: "community", id },
      reason: "spam",
      note: "",
    });
    expect(reported.status).toBe(204);
    await settle();
    expect((await waiting(moderator)).length).toBe(1);

    expect((await owner.call("DELETE", `/v1/communities/${id}`)).status).toBe(204);
    expect(await openReports()).toEqual([]);
    expect(await waiting(moderator)).toEqual([]);
  });

  it("goes when an action in a community closes the last report", async () => {
    const moderator = await platformModerator("Samtak");
    const { id, readers, postId } = await scene("Lesandi");
    const reported = await readers[0]!.call("POST", "/v1/reports", {
      target: { kind: "post", id: postId },
      reason: "unlawful",
      note: "",
    });
    expect(reported.status).toBe(204);
    await settle();
    expect((await waiting(moderator)).length).toBe(1);

    const acted = await moderator.call("POST", `/v1/communities/${id}/actions`, {
      action: "hide_post",
      targetId: postId,
      reason: "Prófun",
      reportId: (await openReports())[0],
    });
    expect(acted.status).toBe(204);
    expect(await openReports()).toEqual([]);
    expect(await waiting(moderator)).toEqual([]);
  });

  it("goes with the platform's last report, though a community's is still open", async () => {
    const moderator = await platformModerator("Samtak");
    const { readers, postId } = await scene("Lesandi");
    const inCommunity = await readers[0]!.call("POST", "/v1/reports", {
      target: { kind: "post", id: postId },
      reason: "spam",
      note: "",
    });
    expect(inCommunity.status).toBe(204);
    await reportAccount(await person("Tilkynnandi"), await person("Tilkynntur"));
    await settle();
    expect((await waiting(moderator)).length).toBe(1);

    await close(moderator, (await openReports())[0]!);
    expect(await waiting(moderator)).toEqual([]);
  });

  it("does not go when a report closes in a community's queue", async () => {
    const moderator = await platformModerator("Samtak");
    const { author, readers, postId } = await scene("Lesandi");
    const inCommunity = await readers[0]!.call("POST", "/v1/reports", {
      target: { kind: "post", id: postId },
      reason: "spam",
      note: "",
    });
    expect(inCommunity.status).toBe(204);
    await reportAccount(await person("Tilkynnandi"), await person("Tilkynntur"));
    await settle();
    const { results } = await env.DB.prepare(
      "SELECT report_id AS id FROM reports WHERE to_platform = 0",
    ).all<{ id: string }>();
    await close(author, results[0]!.id);
    expect((await waiting(moderator)).length).toBe(1);
  });
});

describe("what it is not", () => {
  it("is never a push, and no setting turns it off", async () => {
    const moderator = await platformModerator("Samtak");
    // The kind is no key of the settings, so asking for it stores nothing.
    const asked = await moderator.call("PUT", "/v1/notification-settings", {
      kinds: { reports_waiting: "off", comment: "off" },
    });
    expect(asked.status).toBeLessThan(300);
    const stored = await ok<{ kinds: Record<string, string> }>(
      await moderator.call("GET", "/v1/notification-settings"),
    );
    expect(Object.keys(stored.kinds)).not.toContain("reports_waiting");

    await reportAccount(await person("Tilkynnandi"), await person("Tilkynntur"));
    const push = await settle();
    expect(push.sent).toEqual([]);
    const [row] = await waiting(moderator);
    expect(row).toBeDefined();
    expect(row!.announce).toBe(false);
  });

  it("cannot have a settings row", async () => {
    const one = await person("Einn");
    await expect(
      env.DB.prepare(
        `INSERT INTO notification_settings (account_id, kind, level)
         VALUES (?, 'reports_waiting', 'off')`,
      )
        .bind(one.accountId)
        .run(),
    ).rejects.toThrow();
  });
});

describe("a client that cannot word it", () => {
  it("is not shown the row or counted it, and its list decodes", async () => {
    const moderator = await platformModerator("Samtak");
    await reportAccount(await person("Tilkynnandi"), await person("Tilkynntur"));
    await settle();
    expect((await waiting(moderator)).length).toBe(1);
    const shown = await webPage(moderator);
    expect(shown.unread).toBe(1);
    expect(shown.unseen).toBe(1);

    for (const client of [
      "android/0.17.7",
      `android/${env.NOTICE_CLIENT_VERSION}`,
      `android/${env.SUSPENSION_NOTICE_CLIENT_VERSION}`,
      `android/${env.FRIEND_NOTICE_CLIENT_VERSION}`,
      `ios/${env.FRIEND_NOTICE_CLIENT_VERSION}`,
    ]) {
      const page = await webPage(moderator, client);
      expect(page.notifications).toEqual([]);
      expect(page.unread).toBe(0);
      expect(page.unseen).toBe(0);
    }
    expect((await waiting(moderator, `android/${env.REPORTS_NOTICE_CLIENT_VERSION}`)).length).toBe(
      1,
    );
  });

  it("is told by a filter that names the kind at every rung below all", async () => {
    const passes = async (reach: Parameters<typeof shownTo>[0]) =>
      (await env.DB.prepare(
        `SELECT 1 AS yes FROM (SELECT 'reports_waiting' AS kind, NULL AS community_id, NULL AS action) n
          WHERE ${shownTo(reach)}`,
      ).first()) !== null;
    for (const reach of ["frozen", "decoding", "suspension", "friends"] as const) {
      expect(await passes(reach)).toBe(false);
    }
    expect(await passes("all")).toBe(true);
  });
});

describe("migration 0042", () => {
  const rebuild = () => {
    const { TEST_MIGRATIONS } = env as unknown as { TEST_MIGRATIONS: D1Migration[] };
    const migration = TEST_MIGRATIONS.find((m) => m.name.startsWith("0042_"))!;
    const statements = migration.queries
      .map((q) => q.replace(/^\s*--.*$/gm, "").trim())
      .filter(Boolean);
    expect(statements[0]).toMatch(/^CREATE TABLE notification_actors_kept/);
    return statements;
  };
  const all = async (table: string, order: string) =>
    (await env.DB.prepare(`SELECT * FROM ${table} ORDER BY ${order}`).all()).results;

  it("keeps every row and actor, and widens only the kind and the event's actor", async () => {
    const moderator = await platformModerator("Samtak");
    const { author, readers, postId } = await scene("Lesandi", "Annar");
    for (const reader of readers) {
      await reader.call("PUT", `/v1/posts/${postId}/reaction`, { kind: "like" });
    }
    await reportAccount(readers[0]!, author);
    await settle();
    await env.DB.prepare("UPDATE notifications SET read_at = 77 WHERE kind = 'reaction'").run();
    const before = {
      rows: await all("notifications", "notification_id"),
      actors: await all("notification_actors", "event_id"),
    };
    expect(before.rows.length).toBe(2);
    expect(before.actors.length).toBe(3);

    await env.DB.batch(rebuild().map((q) => env.DB.prepare(q)));

    expect(await all("notifications", "notification_id")).toEqual(before.rows);
    expect(await all("notification_actors", "event_id")).toEqual(before.actors);
    const { results: left } = await env.DB.prepare(
      "SELECT name, sql FROM sqlite_master WHERE name LIKE 'notification%' ORDER BY name",
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

    // The foreign keys still hold, and a row an old version writes still fits.
    await env.DB.prepare("DELETE FROM notifications WHERE kind = 'reports_waiting'").run();
    expect((await all("notification_actors", "event_id")).length).toBe(2);
    await env.DB.prepare(
      `INSERT INTO notifications (notification_id, account_id, kind, created_at)
       VALUES ('old-writer', ?, 'comment', 1)`,
    )
      .bind(moderator.accountId)
      .run();
  });
});
