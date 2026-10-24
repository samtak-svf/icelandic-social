import type { D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { person } from "./people.ts";

// The schema after every migration. Migrations are append-only, so a table a
// decision retires is dropped by a later one (0026, decision 0084).

describe("the schema after the migrations", () => {
  it("has no table or index of the retired tester assistant", async () => {
    const { results } = await env.DB.prepare(
      `SELECT name FROM sqlite_master
        WHERE name IN ('tester_requests', 'tester_requests_pending', 'assistant_usage', 'assistant_answers')`,
    ).all<{ name: string }>();
    expect(results).toEqual([]);
  });

  it("has no account of the retired assistant, and 0027 takes only its rows", async () => {
    const reader = await person("Lesandi");
    const now = Date.now();
    const communityId = `cm_0027_${reader.accountId}`;
    const assistantId = `a_0027_${reader.accountId}`;
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO accounts (account_id, display_name, verified, created_at, kind)
         VALUES (?, 'Aðstoð', 0, ?, 'assistant')`,
      ).bind(assistantId, now),
      env.DB.prepare(
        `INSERT INTO communities (community_id, name, name_key, description, audience, created_at)
         VALUES (?, 'Prófun', 'profun', '', 'open', ?)`,
      ).bind(communityId, now),
      ...[reader.accountId, assistantId].map((accountId) =>
        env.DB.prepare(
          `INSERT INTO community_members (community_id, account_id, role, joined_at)
           VALUES (?, ?, 'member', ?)`,
        ).bind(communityId, accountId, now),
      ),
      env.DB.prepare(`INSERT INTO space_authors (community_id, account_id) VALUES (?, ?)`).bind(
        communityId,
        assistantId,
      ),
      env.DB.prepare(
        `INSERT INTO notifications (notification_id, account_id, kind, actor_id, community_id, created_at)
         VALUES (?, ?, 'comment', ?, ?, ?)`,
      ).bind(`n_0027_${reader.accountId}`, reader.accountId, assistantId, communityId, now),
    ]);

    const { TEST_MIGRATIONS } = env as unknown as { TEST_MIGRATIONS: D1Migration[] };
    const migration = TEST_MIGRATIONS.find((m) => m.name.startsWith("0027_"))!;
    const statements = migration.queries
      .map((q) => q.replace(/^\s*--.*$/gm, "").trim())
      .filter((q) => q.length > 0);
    expect(statements).toEqual(["DELETE FROM accounts WHERE kind = 'assistant'"]);
    await env.DB.batch(statements.map((q) => env.DB.prepare(q)));

    const count = async (sql: string, ...binds: string[]) =>
      (await env.DB.prepare(sql)
        .bind(...binds)
        .first<{ n: number }>())!.n;
    expect(await count("SELECT count(*) n FROM accounts WHERE kind != 'person'")).toBe(0);
    expect(
      await count("SELECT count(*) n FROM accounts WHERE account_id = ?", reader.accountId),
    ).toBe(1);
    expect(
      await count("SELECT count(*) n FROM community_members WHERE community_id = ?", communityId),
    ).toBe(1);
    expect(
      await count("SELECT count(*) n FROM space_authors WHERE community_id = ?", communityId),
    ).toBe(0);
    const notification = await env.DB.prepare(
      "SELECT actor_id AS actorId FROM notifications WHERE account_id = ?",
    )
      .bind(reader.accountId)
      .first<{ actorId: string | null }>();
    expect(notification).toEqual({ actorId: null });
  });
});
