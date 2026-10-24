import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.ts";
import { API_PATHS } from "../src/paths.ts";
import { jobHealth } from "../src/modules/jobs/index.ts";
import { commentModeration } from "../src/modules/moderation/index.ts";
import { reconcileSpace } from "../src/modules/social/index.ts";
import { worker } from "./main.ts";
import { community, ok, person, type Person } from "./people.ts";
import { euEnv } from "./support.ts";

// The maintainer's routes (decision 0068): not there without OPS_TOKEN, the
// jobs' overview, retry and drain, and the restore of one community's space,
// which reconciles the space with D1 afterwards. Local workerd has no
// point-in-time recovery, so the restore itself is rehearsed on Cloudflare
// (docs/operations.md); here it reaches the object and answers 501.

const BASE = "https://spjall.test";
const TOKEN = (env as Env & { OPS_TOKEN: string }).OPS_TOKEN;
const MINUTE = 60_000;

const ops = (method: string, path: string, body?: unknown, token: string | null = TOKEN) =>
  worker.fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const ROUTES: [string, string, unknown?][] = [
  ["GET", "/ops/jobs"],
  ["POST", "/ops/jobs/retry", { allFailed: true }],
  ["POST", "/ops/jobs/drain"],
  ["POST", "/ops/restore", { kind: "space", communityId: "c_x", bookmark: "b" }],
];

describe("the deployed entry", () => {
  it("sends /ops to the API, not to the web app", () => {
    for (const [, path] of ROUTES) expect(API_PATHS.test(path)).toBe(true);
  });
});

async function failedJob(kind: string, finishedAt = Date.now()) {
  const key = `test:${crypto.randomUUID()}`;
  await env.DB.prepare(
    `INSERT INTO jobs (key, kind, payload, state, attempts, run_after, error, created_at, finished_at)
     VALUES (?, ?, '{}', 'failed', 5, ?, 'boom', ?, ?)`,
  )
    .bind(key, kind, finishedAt, finishedAt, finishedAt)
    .run();
  return (await env.DB.prepare("SELECT job_id FROM jobs WHERE key = ?")
    .bind(key)
    .first<{ job_id: number }>())!.job_id;
}

const jobRow = (jobId: number) =>
  env.DB.prepare("SELECT state, attempts, error FROM jobs WHERE job_id = ?")
    .bind(jobId)
    .first<{ state: string; attempts: number; error: string | null }>();

describe("the /ops routes", () => {
  it("are not found without the token, with another one, or while OPS_TOKEN is unset", async () => {
    const unknown = await (await worker.fetch(`${BASE}/no-such-route`)).json<{ error: string }>();
    for (const [method, path, body] of ROUTES) {
      for (const token of [null, "x".repeat(40), `${TOKEN}x`, TOKEN.slice(0, -1)]) {
        const response = await ops(method, path, body, token);
        expect(response.status, `${method} ${path}`).toBe(404);
        expect((await response.json<{ error: string }>()).error).toBe(unknown.error);
      }
      const unset = await createApp().fetch(
        new Request(`${BASE}${path}`, {
          method,
          headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
        { ...euEnv(env), OPS_TOKEN: undefined } as Env,
      );
      expect(unset.status, `${method} ${path} unset`).toBe(404);
    }
  });

  it("refuse a token shorter than 32 characters even when it is the secret", async () => {
    const short = "short-token";
    const response = await createApp().fetch(
      new Request(`${BASE}/ops/jobs`, { headers: { authorization: `Bearer ${short}` } }),
      { ...euEnv(env), OPS_TOKEN: short } as Env,
    );
    expect(response.status).toBe(404);
  });
});

describe("jobs for the maintainer", () => {
  it("shows the failed ones, makes them pending again and drains what is due", async () => {
    const jobId = await failedJob("no_such_kind");
    const overview = await ok<{
      counts: { state: string; kind: string; count: number }[];
      failed: { jobId: number; kind: string; error: string | null }[];
    }>(await ops("GET", "/ops/jobs"));
    expect(overview.counts).toContainEqual({ state: "failed", kind: "no_such_kind", count: 1 });
    expect(overview.failed).toContainEqual(
      expect.objectContaining({ jobId, kind: "no_such_kind", error: "boom" }),
    );

    expect(await ok(await ops("POST", "/ops/jobs/retry", { jobIds: [jobId] }))).toEqual({
      retried: 1,
    });
    expect(await jobRow(jobId)).toEqual({ state: "pending", attempts: 0, error: null });
    // A job not failed is not retried.
    expect(await ok(await ops("POST", "/ops/jobs/retry", { jobIds: [jobId] }))).toEqual({
      retried: 0,
    });

    // It has no handler, so the drain takes it once and leaves it to its backoff.
    const drained = await ok<{ done: number; retried: number; runs: number }>(
      await ops("POST", "/ops/jobs/drain"),
    );
    expect(drained).toMatchObject({ done: 0, retried: 1, runs: 2 });
    expect(await jobRow(jobId)).toMatchObject({ state: "pending", attempts: 1 });
  });

  it("retries every failed job at once, and refuses a body that names neither", async () => {
    const [a, b] = [await failedJob("all_a"), await failedJob("all_b")];
    const { retried } = await ok<{ retried: number }>(
      await ops("POST", "/ops/jobs/retry", { allFailed: true }),
    );
    expect(retried).toBeGreaterThanOrEqual(2);
    expect((await jobRow(a))?.state).toBe("pending");
    expect((await jobRow(b))?.state).toBe("pending");
    for (const body of [{}, { jobIds: [] }, { allFailed: false }, { jobIds: [1], extra: 1 }]) {
      expect((await ops("POST", "/ops/jobs/retry", body)).status).toBe(400);
    }
  });

  it("counts by kind the jobs failed in the last day and the ones stuck", async () => {
    const now = Date.now() + 365 * 24 * 60 * MINUTE;
    await failedJob("health_failed", now - 60 * MINUTE);
    await failedJob("health_failed", now - 2 * 24 * 60 * MINUTE);
    await env.DB.prepare(
      `INSERT INTO jobs (key, kind, payload, run_after, created_at)
       VALUES (?, 'health_stuck', '{}', ?, ?)`,
    )
      .bind(`stuck:${crypto.randomUUID()}`, now - 2 * 60 * MINUTE, now - 2 * 60 * MINUTE)
      .run();
    const health = await jobHealth(env, now);
    expect(health.failed.health_failed).toBe(1);
    expect(health.stuck.health_stuck).toBe(1);
  });
});

describe("restoring a space", () => {
  afterEach(() => vi.restoreAllMocks());

  it("refuses a body without one target, a time outside 30 days, and an unknown community", async () => {
    const owner = await person("Eigandi");
    const id = await community(owner, "open");
    const now = Date.now();
    for (const body of [
      { kind: "space", communityId: id },
      { kind: "space", communityId: id, at: new Date(now - MINUTE).toISOString(), bookmark: "b" },
      { kind: "conversation", communityId: id, bookmark: "b" },
      { kind: "space", communityId: id, at: new Date(now + MINUTE).toISOString() },
      { kind: "space", communityId: id, at: new Date(now - 31 * 24 * 60 * MINUTE).toISOString() },
    ]) {
      expect((await ops("POST", "/ops/restore", body)).status, JSON.stringify(body)).toBe(400);
    }
    const unknown = await ops("POST", "/ops/restore", {
      kind: "space",
      communityId: "c_does_not_exist",
      at: new Date(now - MINUTE).toISOString(),
    });
    expect(unknown.status).toBe(404);
  });

  it("reaches the space's point-in-time recovery, and logs only the kind", async () => {
    const owner = await person("Eigandi");
    const id = await community(owner, "open");
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const response = await ops("POST", "/ops/restore", {
      kind: "space",
      communityId: id,
      at: new Date(Date.now() - MINUTE).toISOString(),
    });
    // workerd: "This Durable Object's storage back-end does not implement point-in-time recovery."
    expect(response.status).toBe(501);
    const lines = spy.mock.calls
      .map(([line]) => JSON.parse(String(line)) as Record<string, unknown>)
      .filter((l) => String(l.event).startsWith("ops."));
    expect(lines).toHaveLength(1);
    expect(Object.keys(lines[0]!).sort()).toEqual(["code", "event", "requestId"]);
    expect(JSON.stringify(lines)).not.toContain(id);
  });
});

describe("a restored space, reconciled with D1", () => {
  type Post = { postId: string };
  type Comment = { commentId: string };
  const posted = async (by: Person, id: string, body: string) =>
    ok<Post>(await by.call("POST", `/v1/communities/${id}/posts`, { body }));

  it("deletes again what was deleted since, and keeps the moderation log's states", async () => {
    const [owner, member, leaver] = [
      await person("Eigandi"),
      await person("Meðlimur"),
      await person("Farinn"),
    ];
    const id = await community(owner, "open", member, leaver);
    const kept = await posted(member, id, "Stendur");
    const written = await posted(member, id, "Skrifað eftir tímann");
    const hidden = await ok<Comment>(
      await member.call("POST", `/v1/posts/${kept.postId}/comments`, { body: "Falið" }),
    );
    await owner.call("POST", `/v1/communities/${id}/actions`, {
      action: "hide_comment",
      targetId: hidden.commentId,
      reason: "Prófun",
    });
    const now = Date.now();

    // The space as a restore to an earlier time would leave it: a post its
    // author has deleted since, the comment before it was hidden, content of
    // an account deleted since, and none of the post written after the time.
    await runInDurableObject(env.SPACE.getByName(id), (_instance, state) => {
      const sql = state.storage.sql;
      sql.exec(
        "INSERT INTO posts (post_id, author, body, media, created_at) VALUES ('p_deleted_since', ?, 'Eytt', '[]', ?)",
        member.accountId,
        now - MINUTE,
      );
      sql.exec("UPDATE comments SET state = 'visible', moderated_at = NULL");
      sql.exec("DELETE FROM posts WHERE post_id = ?", written.postId);
      sql.exec(
        "INSERT INTO posts (post_id, author, body, media, created_at) VALUES ('p_of_leaver', 'acct_deleted_since', 'Farinn', '[]', ?)",
        now - MINUTE,
      );
      sql.exec(
        "INSERT INTO reactions VALUES (?, 'acct_deleted_since', 'like', ?)",
        kept.postId,
        now - MINUTE,
      );
    });

    const reconciled = await reconcileSpace(
      euEnv(env),
      id,
      await commentModeration(euEnv(env), id),
    );
    expect(reconciled).toEqual({
      postsDeleted: 2,
      postsUnindexed: 1,
      accountsForgotten: 1,
      commentsModerated: 1,
    });

    await runInDurableObject(env.SPACE.getByName(id), (_instance, state) => {
      const sql = state.storage.sql;
      expect(
        sql
          .exec<{ post_id: string }>("SELECT post_id FROM posts")
          .toArray()
          .map((r) => r.post_id),
      ).toEqual([kept.postId]);
      expect(sql.exec("SELECT state FROM comments").one()).toEqual({ state: "hidden" });
      expect(sql.exec("SELECT COUNT(*) AS n FROM reactions").one()).toEqual({ n: 0 });
    });
    const index = await env.DB.prepare("SELECT post_id FROM post_index WHERE community_id = ?")
      .bind(id)
      .all<{ post_id: string }>();
    expect(index.results.map((r) => r.post_id)).toEqual([kept.postId]);
    // The feed still shows what stands.
    const feed = await ok<{ posts: Post[] }>(await leaver.call("GET", "/v1/feed"));
    expect(feed.posts.map((p) => p.postId)).toEqual([kept.postId]);
  });
});
