import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expireLog } from "../../../src/modules/moderation/log.ts";
import { CLOSED_KEPT_MS } from "../../../src/modules/moderation/reports.ts";
import { png } from "../../images.ts";
import { worker } from "../../main.ts";
import { community, errorOf, ok, person, platformModerator, type Person } from "../../people.ts";

// What a platform moderator does with no community (decision 0115): an action
// on an account, the report it closes, and the log entry that goes with both,
// which nothing deletes until its year has passed.

const DAY = 24 * 60 * 60 * 1000;

async function withPhoto(name: string): Promise<Person> {
  const one = await person(name);
  const set = await worker.fetch("https://spjall.test/v1/me/photo", {
    method: "PUT",
    headers: { ...one.auth, "content-type": "application/octet-stream" },
    body: await png(40, 30),
  });
  expect(set.status).toBe(200);
  return one;
}

const clear = (by: Person, targetId: string, more: Record<string, unknown> = {}) =>
  by.call("POST", "/v1/moderation/actions", {
    action: "clear_account_photo",
    targetId,
    reason: "Prófun",
    ...more,
  });

const photoOf = async (by: Person, owner: Person) =>
  (await ok<{ photo: string | null }>(await by.call("GET", `/v1/accounts/${owner.accountId}`)))
    .photo;

/** Reports `target` as a new account, and the report's id from Samtak's queue. */
async function reported(target: Person, platform: Person): Promise<string> {
  const reporter = await person("Tilkynnandi");
  const filed = await reporter.call("POST", "/v1/reports", {
    target: { kind: "account", id: target.accountId },
    reason: "other",
  });
  expect(filed.status).toBe(204);
  const { reports } = await ok<{
    reports: { reportId: string; target: { id: string } }[];
  }>(await platform.call("GET", "/v1/moderation/reports"));
  const found = reports.find((r) => r.target.id === target.accountId);
  if (!found) throw new Error("the report is not in the queue");
  return found.reportId;
}

const closedReports = async (platform: Person) =>
  (
    await ok<{
      reports: { reportId: string; decision: string | null; resolution: string | null }[];
    }>(await platform.call("GET", "/v1/moderation/reports?state=closed"))
  ).reports;

type Entry = {
  communityId: string | null;
  action: string;
  actor: { accountId: string } | null;
  asPlatform: boolean;
  target: { kind: string; id: string };
  targetAccount: { accountId: string } | null;
  reason: string;
};

const platformLog = async (by: Person) =>
  (await ok<{ entries: Entry[] }>(await by.call("GET", "/v1/moderation/log"))).entries;

const entriesOn = async (accountId: string) =>
  (
    await env.DB.prepare("SELECT COUNT(*) AS n FROM moderation_log WHERE target_id = ?")
      .bind(accountId)
      .first<{ n: number }>()
  )?.n;

/** Writes a log entry with no community `age` ago, as nothing but a test can date one. */
const aged = async (age: number): Promise<number> =>
  (
    await env.DB.prepare(
      `INSERT INTO moderation_log
         (community_id, as_platform, action, target_kind, target_id, reason, created_at)
       VALUES (NULL, 1, 'close_report', 'report', 'rep_aged', '', ?) RETURNING entry_id`,
    )
      .bind(Date.now() - age)
      .first<{ entry_id: number }>()
  )?.entry_id ?? 0;

const remaining = async (entryId: number) =>
  (await env.DB.prepare("SELECT 1 FROM moderation_log WHERE entry_id = ?")
    .bind(entryId)
    .first()) !== null;

const deleting = (entryId: number) =>
  env.DB.prepare("DELETE FROM moderation_log WHERE entry_id = ?").bind(entryId).run();

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a platform moderator's action on an account (decision 0115)", () => {
  it("clears the photo, closes the report and leaves one entry with no community", async () => {
    const platform = await platformModerator("Samtak");
    const target = await withPhoto("Tilkynntur");
    const reportId = await reported(target, platform);
    expect(await photoOf(platform, target)).not.toBeNull();
    const lines = vi.spyOn(console, "log");

    expect((await clear(platform, target.accountId, { reportId, reason: "Ósæmileg" })).status).toBe(
      204,
    );

    expect(await photoOf(platform, target)).toBeNull();
    expect(
      (
        await worker.fetch(`https://spjall.test/v1/accounts/${target.accountId}/photo`, {
          headers: platform.auth,
        })
      ).status,
    ).toBe(404);
    expect(await env.PROFILES.list({ prefix: target.accountId })).toMatchObject({ objects: [] });
    const closed = (await closedReports(platform)).find((r) => r.reportId === reportId);
    expect(closed?.decision).toBe("clear_account_photo");
    expect(closed?.resolution).toBe("Ósæmileg");
    const open = await ok<{ reports: { reportId: string }[] }>(
      await platform.call("GET", "/v1/moderation/reports"),
    );
    expect(open.reports.map((r) => r.reportId)).not.toContain(reportId);

    const entries = (await platformLog(platform)).filter((e) => e.target.id === target.accountId);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      communityId: null,
      action: "clear_account_photo",
      actor: { accountId: platform.accountId },
      asPlatform: true,
      target: { kind: "account", id: target.accountId },
      targetAccount: { accountId: target.accountId },
      reason: "Ósæmileg",
    });

    const written = lines.mock.calls.map((call) => String(call[0])).join("\n");
    expect(written).toContain("moderation.acted");
    expect(written).not.toContain("Ósæmileg");
    expect(written).not.toContain("Tilkynntur");
  });

  it("acts with no report, and closes none", async () => {
    const platform = await platformModerator("Samtak");
    const target = await withPhoto("Tilkynntur");
    const reportId = await reported(target, platform);
    expect((await clear(platform, target.accountId)).status).toBe(204);
    expect(await photoOf(platform, target)).toBeNull();
    expect((await closedReports(platform)).map((r) => r.reportId)).not.toContain(reportId);
  });

  it("refuses anyone else as the platform's queue does, an ordinary moderator too", async () => {
    const platform = await platformModerator("Samtak");
    const target = await withPhoto("Tilkynntur");
    const reportId = await reported(target, platform);
    const member = await person("Meðlimur");
    const owner = await person("Eigandi");
    const moderator = await person("Stjórnandi");
    const id = await community(owner, "open", moderator, target, member);
    await owner.call("PUT", `/v1/communities/${id}/members/${moderator.accountId}/role`, {
      role: "moderator",
    });

    for (const [name, one] of [
      ["a member", member],
      ["a community's moderator", moderator],
      ["a community's owner", owner],
      ["the target", target],
    ] as const) {
      const refused = await clear(one, target.accountId, { reportId });
      expect(refused.status, name).toBe(403);
      expect(await errorOf(refused), name).toBe("not_permitted");
      // The same words for a target that does not exist, so it tells nobody who does.
      const nobody = await clear(one, "acct_none");
      expect(nobody.status, name).toBe(403);
    }
    expect(await photoOf(platform, target)).not.toBeNull();
    expect(await entriesOn(target.accountId)).toBe(0);
    expect((await closedReports(platform)).map((r) => r.reportId)).not.toContain(reportId);
  });

  it("reaches no platform moderator, and needs a target to act on", async () => {
    const platform = await platformModerator("Samtak");
    const colleague = await platformModerator("Annar");
    const set = await worker.fetch("https://spjall.test/v1/me/photo", {
      method: "PUT",
      headers: { ...colleague.auth, "content-type": "application/octet-stream" },
      body: await png(40, 30),
    });
    expect(set.status).toBe(200);
    const refused = await clear(platform, colleague.accountId);
    expect(refused.status).toBe(403);
    expect(await errorOf(refused)).toBe("not_permitted");
    expect((await clear(platform, platform.accountId)).status).toBe(403);
    expect(await photoOf(platform, colleague)).not.toBeNull();

    expect((await clear(platform, "acct_none")).status).toBe(404);
    const noPhoto = await person("Myndlaus");
    expect((await clear(platform, noPhoto.accountId)).status).toBe(404);
    expect(await entriesOn(noPhoto.accountId)).toBe(0);
  });

  it("closes only an open report on that account", async () => {
    const platform = await platformModerator("Samtak");
    const target = await withPhoto("Tilkynntur");
    const another = await withPhoto("Annar");
    const onAnother = await reported(another, platform);
    expect((await clear(platform, target.accountId, { reportId: onAnother })).status).toBe(404);
    expect((await clear(platform, target.accountId, { reportId: "rep_none" })).status).toBe(404);

    const owner = await person("Eigandi");
    const id = await community(owner, "open", target);
    const { postId } = await ok<{ postId: string }>(
      await target.call("POST", `/v1/communities/${id}/posts`, { body: "Póstur" }),
    );
    const reader = await person("Lesandi");
    await reader.call("POST", `/v1/communities/${id}/join`);
    await reader.call("POST", "/v1/reports", {
      target: { kind: "post", id: postId },
      reason: "unlawful",
    });
    const queue = await ok<{ reports: { reportId: string; target: { id: string } }[] }>(
      await platform.call("GET", "/v1/moderation/reports"),
    );
    const onPost = queue.reports.find((r) => r.target.id === postId)?.reportId;
    expect(onPost).toBeDefined();
    // A report in a community closes through that community's route.
    expect((await clear(platform, target.accountId, { reportId: onPost })).status).toBe(404);

    expect(await photoOf(platform, target)).not.toBeNull();
    expect(await entriesOn(target.accountId)).toBe(0);
  });

  it("writes the clearing, the entry and the closing as one", async () => {
    const platform = await platformModerator("Samtak");
    const target = await withPhoto("Tilkynntur");
    const reportId = await reported(target, platform);
    await env.DB.exec(
      "CREATE TRIGGER refuse_entry BEFORE INSERT ON moderation_log BEGIN SELECT RAISE(ABORT, 'no'); END;",
    );
    try {
      expect((await clear(platform, target.accountId, { reportId })).status).toBe(500);
    } finally {
      await env.DB.exec("DROP TRIGGER refuse_entry;");
    }
    expect(await photoOf(platform, target)).not.toBeNull();
    expect((await closedReports(platform)).map((r) => r.reportId)).not.toContain(reportId);
    expect(
      (
        await worker.fetch(`https://spjall.test/v1/accounts/${target.accountId}/photo`, {
          headers: platform.auth,
        })
      ).status,
    ).toBe(200);
  });
});

describe("a log entry with no community (decision 0115)", () => {
  it("refuses deletion for a year, in the database itself", async () => {
    const young = await aged(364 * DAY);
    await expect(deleting(young)).rejects.toThrow(/append-only/);
    expect(await remaining(young)).toBe(true);
  });

  it("is purged by the daily job after its year, and not before", async () => {
    const old = await aged(CLOSED_KEPT_MS + DAY);
    const young = await aged(CLOSED_KEPT_MS - DAY);
    expect(await expireLog(env)).toBe(1);
    expect(await remaining(old)).toBe(false);
    expect(await remaining(young)).toBe(true);
    expect(await expireLog(env)).toBe(0);
  });

  it("stays when a community is purged, whose own entries go with it", async () => {
    const owner = await person("Eigandi");
    const id = await community(owner, "open");
    const kept = await aged(DAY);
    await env.DB.prepare(
      `INSERT INTO moderation_log
         (community_id, as_platform, action, target_kind, target_id, reason, created_at)
       VALUES (?, 0, 'close_report', 'report', 'rep_there', '', ?)`,
    )
      .bind(id, Date.now())
      .run();
    await env.DB.prepare("DELETE FROM communities WHERE community_id = ?").bind(id).run();
    const there = await env.DB.prepare("SELECT 1 FROM moderation_log WHERE target_id = 'rep_there'")
      .bind()
      .first();
    expect(there).toBeNull();
    expect(await remaining(kept)).toBe(true);
  });
});
