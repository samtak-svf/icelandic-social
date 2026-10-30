import type { D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { notice, type Notice } from "../../../src/modules/jobs/index.ts";
import { shownTo } from "../../../src/modules/notifications/list.ts";
import { CLIENT_HEADER, decodesEveryNotice } from "../../../src/shared/client-version.ts";
import { worker } from "../../main.ts";
import { community, ok, person, type Person } from "../../people.ts";
import { euEnv } from "../../support.ts";
import { recorder, run, scene, tick, type Page } from "./support.ts";

// A notification with no community (decision 0114): written, read by a client
// that decodes it, and withheld from one that cannot. An app below the first
// knowing version fails to decode a whole page on one null community, so these
// tests name the client in Spjall-Client as a real app does.

const BASE = "https://spjall.test";
const OLD = "android/0.17.7";
const knowing = () => `android/${env.NOTICE_CLIENT_VERSION}`;

const pageAs = async (one: Person, client: string) =>
  ok<Page>(
    await worker.fetch(`${BASE}/v1/notifications`, {
      headers: { ...one.auth, [CLIENT_HEADER]: client },
    }),
  );

/** Runs the notice `n` under the job key `key`, sending its push with `push`. */
const tell = async (key: string, n: Notice, push = recorder()) => {
  // Job keys are unique across a run, and the tests of a file share one D1.
  await notice(euEnv(env), `${key}:${n.accountId}`, n).run();
  await run(push);
  await tick();
};

/** A moderator's notice to `one` about nothing in any community. */
const aboutAccount = (one: Person, actor: Person): Notice => ({
  kind: "moderated",
  accountId: one.accountId,
  actorId: actor.accountId,
  communityId: null,
  action: "clear_photo",
});

describe("a notification with no community", () => {
  it("is written, pushed and read by a client that knows it", async () => {
    const [one, actor] = [await person("Einn"), await person("Annar")];
    const push = recorder();
    await tell("a", aboutAccount(one, actor), push);
    expect(push.sent.length).toBeGreaterThan(0);

    const page = await pageAs(one, knowing());
    expect(page.notifications.map((n) => [n.kind, n.communityId, n.action])).toEqual([
      ["moderated", null, "clear_photo"],
    ]);
    expect(page.notifications[0]!.announce).toBe(true);
    expect([page.unread, page.unseen]).toEqual([1, 1]);
  });

  it("is withheld from a client below the knowing version, in the list and the counts", async () => {
    const [one, actor] = [await person("Einn"), await person("Annar")];
    await tell("a", aboutAccount(one, actor));

    for (const client of [OLD, "ios/0.17.7"]) {
      const page = await pageAs(one, client);
      expect(page.notifications).toEqual([]);
      expect([page.unread, page.unseen]).toEqual([0, 0]);
    }
    // No header, or one that cannot be read, is a build that does not know.
    expect(decodesEveryNotice(env, undefined)).toBe(false);
    expect(decodesEveryNotice(env, "android/x")).toBe(false);
    expect(decodesEveryNotice(env, knowing())).toBe(true);
  });

  it("reaches the web build the Worker serves", async () => {
    const [one, actor] = [await person("Einn"), await person("Annar")];
    await tell("a", aboutAccount(one, actor));
    const page = await pageAs(one, `web/${env.MIN_CLIENT_VERSION_WEB}`);
    expect(page.notifications.map((n) => n.communityId)).toEqual([null]);
  });

  it("leaves a community row reaching an old client unchanged", async () => {
    const { author, readers, id, postId } = await scene("Lesandi");
    const [reader] = readers;
    await reader!.call("PUT", `/v1/posts/${postId}/reaction`, { kind: "like" });
    await run(recorder());
    await tick();
    await tell("a", aboutAccount(author, reader!));

    const old = await pageAs(author, OLD);
    expect(old.notifications.map((n) => [n.kind, n.communityId, n.postId])).toEqual([
      ["reaction", id, postId],
    ]);
    expect(old.unread).toBe(1);
    const current = await pageAs(author, knowing());
    expect(current.notifications.map((n) => n.communityId)).toEqual([null, id]);
    expect(current.unread).toBe(2);
  });

  it("does not page an old client onto an empty page", async () => {
    const { author, readers, postId } = await scene("Lesandi");
    await readers[0]!.call("PUT", `/v1/posts/${postId}/reaction`, { kind: "like" });
    await run(recorder());
    await tick();
    for (const key of ["a", "b", "c"]) await tell(key, aboutAccount(author, readers[0]!));
    const page = await ok<Page>(
      await worker.fetch(`${BASE}/v1/notifications?limit=1`, {
        headers: { ...author.auth, [CLIENT_HEADER]: OLD },
      }),
    );
    expect(page.notifications.map((n) => n.kind)).toEqual(["reaction"]);
    expect(page.next).toBeNull();
  });

  it("is not marked read by an old client's mark all, which never showed it", async () => {
    const [one, actor] = [await person("Einn"), await person("Annar")];
    await tell("a", aboutAccount(one, actor));
    const read = await worker.fetch(`${BASE}/v1/notifications/read`, {
      method: "POST",
      headers: { ...one.auth, [CLIENT_HEADER]: OLD, "content-type": "application/json" },
      body: JSON.stringify({ upTo: Date.now() + 1000 }),
    });
    expect(read.status).toBe(204);
    expect((await pageAs(one, knowing())).unread).toBe(1);
  });

  it("answers its level from the kind alone", async () => {
    const [one, actor] = [await person("Einn"), await person("Annar")];
    const quiet = { kinds: { moderated: "in_app" } };
    expect((await one.call("PUT", "/v1/notification-settings", quiet)).status).toBeLessThan(300);
    const push = recorder();
    await tell("a", aboutAccount(one, actor), push);
    expect(push.sent).toEqual([]);
    const page = await pageAs(one, knowing());
    expect(page.notifications.length).toBe(1);
    expect(page.notifications[0]!.announce).toBe(false);
  });

  it("writes nothing for a kind that needs a community it does not have", async () => {
    const [one, actor] = [await person("Einn"), await person("Annar")];
    await tell("a", { ...aboutAccount(one, actor), kind: "join_approved" });
    expect((await pageAs(one, knowing())).notifications).toEqual([]);
  });

  it("is never grouped with a community's row on the same post", async () => {
    const { author, readers, id, postId } = await scene("Lesandi", "Annar");
    const [a, b] = readers;
    const reaction = (actor: Person, communityId: string | null, key: string): [string, Notice] => [
      key,
      {
        kind: "reaction",
        accountId: author.accountId,
        actorId: actor.accountId,
        communityId,
        postId,
        emoji: "❤️",
      },
    ];
    await tell(...reaction(a!, id, "with"));
    await tell(...reaction(b!, null, "without"));
    const page = await pageAs(author, knowing());
    expect(page.notifications.map((n) => n.communityId).sort()).toEqual([id, null].sort());
    expect(page.notifications.map((n) => n.actorCount)).toEqual([1, 1]);
  });
});

describe("what an old client is shown", () => {
  /** Whether a row of this kind and community passes the filter, asked of D1 itself. */
  const passes = async (
    knows: boolean,
    kind: string,
    communityId: string | null,
    action: string | null = null,
  ) => {
    const row = await env.DB.prepare(
      `SELECT 1 AS yes FROM (SELECT ?1 AS kind, ?2 AS community_id, ?3 AS action) n
        WHERE ${shownTo(knows)}`,
    )
      .bind(kind, communityId, action)
      .first();
    return row !== null;
  };

  // The kind check is closed until a later feature widens it, so no row with a
  // new kind can exist yet: this asks the filter about one directly.
  it("leaves out a kind added after the release it knows", async () => {
    const owner = await person("Eigandi");
    const id = await community(owner, "open");
    expect(await passes(false, "comment", id)).toBe(true);
    expect(await passes(false, "friend_request", id)).toBe(false);
    expect(await passes(false, "comment", null)).toBe(false);
    expect(await passes(true, "friend_request", id)).toBe(true);
    expect(await passes(true, "friend_request", null)).toBe(true);
  });

  // An old app reads a new action as unknown and words it as a removal (0115).
  it("leaves out an action added after the release it knows", async () => {
    const owner = await person("Eigandi");
    const id = await community(owner, "open");
    expect(await passes(false, "moderated", id, "remove_post")).toBe(true);
    for (const action of ["review_upheld", "review_overturned", "clear_account_photo"]) {
      expect(await passes(false, "moderated", id, action)).toBe(false);
      expect(await passes(true, "moderated", id, action)).toBe(true);
    }
  });
});

describe("migration 0038", () => {
  const statements = () => {
    const { TEST_MIGRATIONS } = env as unknown as { TEST_MIGRATIONS: D1Migration[] };
    const migration = TEST_MIGRATIONS.find((m) => m.name.startsWith("0038_"))!;
    return migration.queries.map((q) => q.replace(/^\s*--.*$/gm, "").trim()).filter(Boolean);
  };
  const all = async (table: string, order: string) =>
    (await env.DB.prepare(`SELECT * FROM ${table} ORDER BY ${order}`).all()).results;

  it("keeps every row, actor and setting, and lets a row have no community", async () => {
    for (const table of ["notifications", "notification_settings"]) {
      await env.DB.prepare(`DELETE FROM ${table}`).run();
    }
    const { author, readers, id, postId } = await scene("Lesandi", "Annar");
    const [a, b] = readers;
    for (const reader of [a!, b!]) {
      await reader.call("PUT", `/v1/posts/${postId}/reaction`, { kind: "like" });
    }
    await run(recorder());
    await tell("a", {
      kind: "moderated",
      accountId: a!.accountId,
      actorId: author.accountId,
      communityId: id,
      postId,
      action: "hide_post",
    });
    await env.DB.prepare("UPDATE notifications SET read_at = 77 WHERE account_id = ?")
      .bind(a!.accountId)
      .run();
    await author.call("PUT", "/v1/notification-settings", { kinds: { comment: "in_app" } });
    await author.call("PUT", `/v1/communities/${id}/notification-level`, { level: "off" });

    const before = {
      rows: await all("notifications", "notification_id"),
      actors: await all("notification_actors", "event_id"),
      kinds: await all("notification_settings", "account_id, kind"),
      levels: await all("community_notification_settings", "account_id, community_id"),
    };
    expect(before.rows.length).toBe(2);
    expect(before.actors.length).toBe(3);
    expect(before.kinds.length).toBe(1);
    expect(before.levels.length).toBe(1);

    await env.DB.batch(statements().map((q) => env.DB.prepare(q)));

    expect(await all("notifications", "notification_id")).toEqual(before.rows);
    expect(await all("notification_actors", "event_id")).toEqual(before.actors);
    expect(await all("notification_settings", "account_id, kind")).toEqual(before.kinds);
    expect(await all("community_notification_settings", "account_id, community_id")).toEqual(
      before.levels,
    );

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

    // The foreign keys still hold after the rebuild.
    await env.DB.prepare("DELETE FROM notifications WHERE account_id = ?")
      .bind(author.accountId)
      .run();
    expect((await all("notification_actors", "event_id")).length).toBe(1);
    await tell("b", aboutAccount(b!, a!));
    await env.DB.prepare("DELETE FROM communities WHERE community_id = ?").bind(id).run();
    const kept = await all("notifications", "notification_id");
    expect(kept.map((r) => r.community_id)).toEqual([null]);
  });
});
