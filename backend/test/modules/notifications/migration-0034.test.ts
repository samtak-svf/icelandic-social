import type { D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { community, person } from "../../people.ts";

// Migration 0034 (decision 0103) re-keys the notifications written before it
// into groups. The migrations ran once on an empty table before this test, so
// it seeds rows in the old shape (one row per event) and runs the migration's
// own statements again over them, after dropping the actor table the first run
// made (a rename would otherwise rewrite its foreign key).

const statements = () => {
  const { TEST_MIGRATIONS } = env as unknown as { TEST_MIGRATIONS: D1Migration[] };
  const migration = TEST_MIGRATIONS.find((m) => m.name.startsWith("0034_"))!;
  return migration.queries.map((q) => q.replace(/^\s*--.*$/gm, "").trim()).filter(Boolean);
};

describe("migration 0034", () => {
  it("groups old reaction and comment rows per account and post, and keeps the rest", async () => {
    const [owner, a, b] = [await person("Eigandi"), await person("A"), await person("B")];
    const cid = await community(owner, "open", a, b);
    const O = owner.accountId;
    const rows: [string, string, string | null, string, number, number | null, number | null][] = [
      // [id, kind, actor, post, created, read, pushed]
      [`reaction:p1:${a.accountId}`, "reaction", a.accountId, "p1", 100, 150, 101],
      [`reaction:p1:${b.accountId}`, "reaction", b.accountId, "p1", 300, null, 301],
      [`comment:c1`, "comment", a.accountId, "p1", 200, 250, 201],
      [`comment:c2`, "comment", a.accountId, "p1", 400, 450, 401],
      [`comment:c3`, "comment", b.accountId, "p2", 500, 550, 501],
      [`comment:c4:parent`, "comment", a.accountId, "p1", 600, null, 601],
      [`join:x`, "join_approved", null, "", 700, 750, 701],
      [`mod:y`, "moderated", b.accountId, "p1", 800, null, 801],
    ];
    await env.DB.prepare("DROP TABLE IF EXISTS notification_actors").run();
    await env.DB.prepare("DELETE FROM notifications").run();
    for (const [id, kind, actor, post, at, read, pushed] of rows) {
      await env.DB.prepare(
        `INSERT INTO notifications (notification_id, account_id, kind, actor_id, community_id,
                                    post_id, comment_id, emoji, created_at, read_at, pushed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          id,
          O,
          kind,
          actor,
          cid,
          post || null,
          kind === "comment" ? id.split(":")[1]! : null,
          kind === "reaction" ? (actor === a.accountId ? "👍" : "🙏") : null,
          at,
          read,
          pushed,
        )
        .run();
    }
    await env.DB.batch(statements().map((q) => env.DB.prepare(q)));

    const { results } = await env.DB.prepare(
      `SELECT notification_id AS id, kind, actor_id AS actor, comment_id AS comment, emoji,
              created_at AS at, read_at AS read, pushed_at AS pushed
         FROM notifications ORDER BY created_at`,
    ).all();
    expect(results).toEqual([
      // reaction p1: newest is b's, one member unread, so unread
      {
        id: `reaction:p1:${O}`,
        kind: "reaction",
        actor: b.accountId,
        comment: null,
        emoji: "🙏",
        at: 300,
        read: null,
        pushed: 301,
      },
      // comments on p1: newest c2 by a, all read, so the newest read time
      {
        id: `comment:p1:${O}`,
        kind: "comment",
        actor: a.accountId,
        comment: "c2",
        emoji: null,
        at: 400,
        read: 450,
        pushed: 401,
      },
      {
        id: `comment:p2:${O}`,
        kind: "comment",
        actor: b.accountId,
        comment: "c3",
        emoji: null,
        at: 500,
        read: 550,
        pushed: 501,
      },
      // a reply keeps its own id and gets its own kind
      {
        id: "comment:c4:parent",
        kind: "reply",
        actor: a.accountId,
        comment: "c4",
        emoji: null,
        at: 600,
        read: null,
        pushed: 601,
      },
      {
        id: "join:x",
        kind: "join_approved",
        actor: null,
        comment: null,
        emoji: null,
        at: 700,
        read: 750,
        pushed: 701,
      },
      {
        id: "mod:y",
        kind: "moderated",
        actor: b.accountId,
        comment: null,
        emoji: null,
        at: 800,
        read: null,
        pushed: 801,
      },
    ]);
    const actors = await env.DB.prepare(
      `SELECT event_id AS event, notification_id AS n, actor_id AS actor, created_at AS at
         FROM notification_actors ORDER BY created_at`,
    ).all();
    expect(actors.results).toEqual([
      { event: `reaction:p1:${a.accountId}`, n: `reaction:p1:${O}`, actor: a.accountId, at: 100 },
      { event: "comment:c1", n: `comment:p1:${O}`, actor: a.accountId, at: 200 },
      { event: `reaction:p1:${b.accountId}`, n: `reaction:p1:${O}`, actor: b.accountId, at: 300 },
      { event: "comment:c2", n: `comment:p1:${O}`, actor: a.accountId, at: 400 },
      { event: "comment:c3", n: `comment:p2:${O}`, actor: b.accountId, at: 500 },
      { event: "comment:c4:parent", n: "comment:c4:parent", actor: a.accountId, at: 600 },
      { event: "mod:y", n: "mod:y", actor: b.accountId, at: 800 },
    ]);
  });
});
