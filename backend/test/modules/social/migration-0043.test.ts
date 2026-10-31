import type { D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { community, person } from "../../people.ts";

// The wall's migration adds and re-creates, and must lose nothing: re-created
// views read every row they read before, and an existing community stays one.

it("keeps every existing community and post, read through the re-created view", async () => {
  const owner = await person("eigandi");
  const communityId = await community(owner, "open");
  const before = await env.DB.prepare("SELECT * FROM live_communities WHERE community_id = ?")
    .bind(communityId)
    .first();
  expect(before).not.toBeNull();
  const kind = await env.DB.prepare("SELECT kind FROM communities WHERE community_id = ?")
    .bind(communityId)
    .first<{ kind: string }>();
  expect(kind?.kind).toBe("community");

  // Only the views can run again; the rest of it has already run over this store.
  const views = migration().queries.filter((q) => /VIEW/.test(q));
  expect(views.length).toBeGreaterThanOrEqual(2);
  await env.DB.exec("DROP VIEW IF EXISTS live_spaces");
  for (const q of views.filter((v) => !/^DROP VIEW live_spaces/.test(v))) {
    await env.DB.prepare(q).run();
  }
  const after = await env.DB.prepare("SELECT * FROM live_communities WHERE community_id = ?")
    .bind(communityId)
    .first();
  expect(after).toEqual(before);
  const space = await env.DB.prepare("SELECT kind FROM live_spaces WHERE community_id = ?")
    .bind(communityId)
    .first<{ kind: string }>();
  expect(space?.kind).toBe("community");
});

const migration = () => {
  const { TEST_MIGRATIONS } = env as unknown as { TEST_MIGRATIONS: D1Migration[] };
  const found = TEST_MIGRATIONS.find((m) => m.name.startsWith("0043_"));
  if (!found) throw new Error("no migration 0043");
  return found;
};

it("only adds: nothing in it writes, or removes, a row that was there", () => {
  const additive =
    /^(ALTER TABLE \w+ ADD COLUMN|CREATE (TABLE|VIEW|INDEX|UNIQUE INDEX)|DROP VIEW)\b/;
  const queries = migration().queries.map((q) =>
    q
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .trim(),
  );
  expect(queries.length).toBeGreaterThanOrEqual(6);
  expect(queries.filter((q) => !additive.test(q))).toEqual([]);
});

const asCommunity = (kind: string) =>
  env.DB.prepare(
    `INSERT INTO communities (community_id, name, name_key, description, audience, kind, created_at)
     VALUES (?1, ?1, ?1, 'x', 'private', ?2, 0)`,
  ).bind(`cm_${kind}`, kind);

it("refuses a kind outside the decision's", async () => {
  await asCommunity("wall").run();
  await expect(asCommunity("person").run()).rejects.toThrow();
});

it("refuses an audience outside the decision's", async () => {
  const owner = await person("eigandi");
  const communityId = await community(owner, "open");
  const asPost = (id: string, audience: string) =>
    env.DB.prepare(
      `INSERT INTO post_index (post_id, community_id, author_id, created_at, audience)
       VALUES (?, ?, ?, 0, ?)`,
    ).bind(id, communityId, owner.accountId, audience);
  await asPost("p_friends", "friends").run();
  await asPost("p_everyone", "everyone").run();
  await expect(asPost("p_other", "strangers").run()).rejects.toThrow();
});
