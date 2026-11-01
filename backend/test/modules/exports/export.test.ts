import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { deleteAccount } from "../../../src/compose/account-deletion.ts";
import { mediaBucket, socialBucket } from "../../../src/env/index.ts";
import { mediaKey } from "../../../src/modules/social/posts.ts";
import { LIMITS, runExportBuild } from "../../../src/modules/exports/build.ts";
import { expireExports } from "../../../src/modules/exports/index.ts";
import { worker } from "../../main.ts";
import { png } from "../../images.ts";
import { community, errorOf, ok, person, type Person } from "../../people.ts";
import { befriend } from "../social/wall-support.ts";
import { E, drain, exported, heavy, jsonOf, readZip, stateOf, text, digest } from "./support.ts";

// A person's own export (decision 0126). The bug each test names: a file that is not a ZIP or has
// a wrong CRC, a resumed build that differs from an uninterrupted one, a retried part that
// duplicates, someone else's file or words in it, an image a moderator took down handed back, a
// kennitala in it, bytes left behind after expiry or deletion.

type PostFile = {
  id: string;
  body: string;
  state: string;
  images: string[];
  images_withheld?: true;
  poll?: { my_vote: string | null };
}[];

const base = "https://spjall.test";
const post = async (
  by: Person,
  communityId: string,
  body: string,
  media: string[] = [],
  poll?: unknown,
) =>
  ok<{ postId: string; poll?: { options: { optionId: string }[] } }>(
    await by.call("POST", `/v1/communities/${communityId}/posts`, { body, media, poll }),
  );
const PART = 5 * 1024 * 1024; // the smallest part R2 accepts before the last
/** Posts with incompressible images, enough that the file runs past two parts. */
async function fill(by: Person, communityId: string, count: number, size = 1_400_000) {
  for (let i = 0; i < count; i++) {
    const image = await ok<{ mediaId: string }>(
      await by.send(`/v1/communities/${communityId}/media`, await png(40, 30)),
    );
    await socialBucket(E).put(mediaKey(communityId, image.mediaId), heavy(size));
    await post(by, communityId, `Mynd ${i}`, [image.mediaId]);
  }
}
const upload = async (by: Person, communityId: string) =>
  ok<{ mediaId: string }>(await by.send(`/v1/communities/${communityId}/media`, await png(40, 30)));

describe("an export", () => {
  it("is a valid ZIP of the person's own words, with Icelandic letters and the right CRCs", async () => {
    const me = await person("Þórður Ægisson");
    const other = await person("Annar");
    const id = await community(me, "open", other);
    const image = await upload(me, id);
    const mine = await post(me, id, "Halló, þetta er ég: ÁÉÍÓÚÝÞÆÖ", [image.mediaId]);
    await other.call("POST", `/v1/posts/${mine.postId}/comments`, { body: "Orð annars manns" });
    const theirs = await post(other, id, "Póstur annars");
    await me.call("POST", `/v1/posts/${theirs.postId}/comments`, { body: "Mitt svar" });
    await me.call("PUT", `/v1/posts/${theirs.postId}/reaction`, { kind: "love" });
    await befriend(me, other);

    const done = await exported(me);
    expect(done).toMatchObject({ state: "ready", failure: null });
    const zip = await readZip(done.exportId);
    const all = [...zip.keys()];
    expect(all).toContain("export.json");
    expect(all).toContain(`spaces/${id}/images/${image.mediaId}.webp`);
    const posts = jsonOf<PostFile>(zip, `spaces/${id}/posts-0001.json`);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ body: "Halló, þetta er ég: ÁÉÍÓÚÝÞÆÖ", state: "visible" });
    expect(jsonOf<{ display_name: string }>(zip, "profile.json").display_name).toBe(
      "Þórður Ægisson",
    );
    const comments = jsonOf<{ body: string }[]>(zip, `spaces/${id}/comments-0001.json`);
    expect(comments.map((c) => c.body)).toEqual(["Mitt svar"]);
    expect(jsonOf<{ type: string }[]>(zip, `spaces/${id}/reactions-0001.json`)[0]).toMatchObject({
      type: "post_reaction",
      post_id: theirs.postId,
    });
    // Nobody else's words anywhere in the file.
    const everything = all.map((n) => (n.endsWith(".json") ? text(zip, n) : "")).join("\n");
    for (const foreign of ["Orð annars manns", "Póstur annars"])
      expect(everything).not.toContain(foreign);
    expect(jsonOf<{ name: string }[]>(zip, "friends.json").map((f) => f.name)).toEqual(["Annar"]);
    expect(
      jsonOf<{ counts: { posts: number; comments: number } }>(zip, "export.json").counts,
    ).toMatchObject({
      posts: 1,
      comments: 1,
    });
  });

  it("holds no kennitala, phone or message data", async () => {
    const me = await person("Gunna");
    // Built at runtime: the repo holds no such value (decision 0008).
    const kt = ["010130", "2", "0", "39"].join("");
    const phone = ["+354", "555", "1234"].join(" ");
    await env.DB.prepare("UPDATE accounts SET kennitala_hmac = ? WHERE account_id = ?")
      .bind(kt, me.accountId)
      .run();
    const id = await community(me, "open");
    await post(me, id, "Venjulegur texti");
    const zip = await readZip((await exported(me)).exportId);
    const everything = [...zip.keys()]
      .map((n) => (n.endsWith(".json") ? text(zip, n) : ""))
      .join("\n");
    expect(everything).not.toContain(kt);
    expect(everything).not.toContain(phone);
    expect([...zip.keys()].some((n) => /message|conversation|device|push/i.test(n))).toBe(false);
    expect(jsonOf<{ left_out: string[] }>(zip, "export.json").left_out.join(" ")).toContain(
      "messages",
    );
  });

  it("keeps a removed post's text and state but not its image", async () => {
    const owner = await person("Eigandi");
    const writer = await person("Skrifari");
    const id = await community(owner, "open", writer);
    const image = await upload(writer, id);
    const removed = await post(writer, id, "Fjarlægður texti", [image.mediaId]);
    const kept = await post(writer, id, "Hinn er enn hér");
    const act = await owner.call("POST", `/v1/communities/${id}/actions`, {
      action: "remove_post",
      targetId: removed.postId,
      reason: "Prófun",
    });
    expect(act.status).toBe(204);

    const zip = await readZip((await exported(writer)).exportId);
    const posts = jsonOf<PostFile>(zip, `spaces/${id}/posts-0001.json`);
    const gone = posts.find((p) => p.id === removed.postId)!;
    expect(gone).toMatchObject({
      body: "Fjarlægður texti",
      state: "removed",
      images: [],
      images_withheld: true,
    });
    expect(posts.find((p) => p.id === kept.postId)?.images_withheld).toBeUndefined();
    expect([...zip.keys()].some((n) => n.includes(image.mediaId))).toBe(false);
  });

  it("is the same bytes whether built in one run or in tiny runs, and keeps a poll vote", async () => {
    const me = await person("Pési");
    const other = await person("Vinur");
    const id = await community(me, "open", other);
    const made = await post(other, id, "Könnun", [], { options: ["Já", "Nei"] });
    expect(
      (
        await me.call("PUT", `/v1/posts/${made.postId}/vote`, {
          optionId: made.poll!.options[0]!.optionId,
        })
      ).status,
    ).toBe(200);
    for (let i = 0; i < 7; i++)
      await post(me, id, `Færsla ${i} með löngum texta ${"x".repeat(300)}`);
    await fill(me, id, 6);
    const first = await exported(me);
    expect(
      jsonOf<{ type: string; option_id: string }[]>(
        await readZip(first.exportId),
        `spaces/${id}/reactions-0001.json`,
      ),
    ).toMatchObject([{ type: "poll_vote", post_id: made.postId }]);

    // A second row for the same account with the same creation time, built in tiny runs.
    const exportId = "ex_resumed0000000000000000000000000";
    await env.DB.prepare(
      "INSERT INTO exports (export_id, account_id, state, created_at, expires_at) VALUES (?, ?, 'building', ?, ?)",
    )
      .bind(exportId, me.accountId, first.createdAt, first.expiresAt)
      .run();
    const tiny = { reads: 2, ms: 60_000, partSize: PART, partsPerRun: 1, pageSize: 2 };
    let run = 1;
    let result = await runExportBuild(E, exportId, run, tiny);
    for (; result === "more"; run++) result = await runExportBuild(E, exportId, run + 1, tiny);
    expect(result).toBe("ready");
    expect(run).toBeGreaterThan(3);
    // The same walk in one run: pages of the same size, so the same files.
    const wholeId = "ex_whole000000000000000000000000000";
    await env.DB.prepare(
      "INSERT INTO exports (export_id, account_id, state, created_at, expires_at) VALUES (?, ?, 'building', ?, ?)",
    )
      .bind(wholeId, me.accountId, first.createdAt, first.expiresAt)
      .run();
    expect(
      await runExportBuild(E, wholeId, 1, { ...tiny, reads: 100_000, partsPerRun: 100_000 }),
    ).toBe("ready");
    const reference = await digest(wholeId);
    expect(await digest(exportId)).toEqual(reference);
  });

  it("survives a part sent before a checkpoint that never landed", async () => {
    const me = await person("Endurtekinn");
    const id = await community(me, "open");
    for (let i = 0; i < 3; i++) await post(me, id, `Færsla ${i} ${"y".repeat(400)}`);
    await fill(me, id, 8);
    const reference = await exported(me);
    const exportId = "ex_retried0000000000000000000000000";
    await env.DB.prepare(
      "INSERT INTO exports (export_id, account_id, state, created_at, expires_at) VALUES (?, ?, 'building', ?, ?)",
    )
      .bind(exportId, me.accountId, reference.createdAt, reference.expiresAt)
      .run();
    const limits = {
      reads: 100,
      ms: 60_000,
      partSize: PART,
      partsPerRun: 1,
      pageSize: LIMITS.pageSize,
    };
    // The first save of the checkpoint fails after the parts it counts were sent.
    let failed = false;
    const flaky = {
      ...E,
      MEDIA: new Proxy(E.MEDIA, {
        get(target, prop) {
          const real = Reflect.get(target, prop) as unknown;
          if (prop !== "put") return typeof real === "function" ? real.bind(target) : real;
          return async (key: string, ...rest: unknown[]) => {
            if (key.endsWith(".checkpoint") && !failed) {
              failed = true;
              throw new Error("storage hiccup");
            }
            return (target.put as (...a: unknown[]) => Promise<unknown>)(key, ...rest);
          };
        },
      }),
    } as Env;
    const stop = { ...limits, reads: 3, partsPerRun: 1 };
    await expect(runExportBuild(flaky, exportId, 1, limits)).rejects.toThrow("storage hiccup");
    let run = 1;
    let result = await runExportBuild(E, exportId, run, stop);
    for (; result === "more"; run++) result = await runExportBuild(E, exportId, run + 1, stop);
    expect(result).toBe("ready");
    expect(failed).toBe(true);
    expect(await digest(exportId)).toEqual(await digest(reference.exportId));
    await readZip(exportId);
  });

  it("is served only to its owner, in ranges, until it expires", async () => {
    const me = await person("Eigandi skrár");
    const stranger = await person("Ókunnugur");
    const done = await exported(me);
    const path = `/v1/exports/${done.exportId}/file`;
    expect(await errorOf(await stranger.call("GET", path))).toBe("not_found");
    const whole = await me.call("GET", path);
    expect(whole.status).toBe(200);
    expect(whole.headers.get("content-type")).toBe("application/zip");
    expect(whole.headers.get("content-disposition")).toContain("attachment");
    const bytes = new Uint8Array(await whole.arrayBuffer());
    expect(bytes.length).toBe(done.size);
    const part = await worker.fetch(`${base}${path}`, {
      headers: { ...me.auth, range: "bytes=0-3" },
    });
    expect(part.status).toBe(206);
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(bytes.slice(0, 4));
    const past = await worker.fetch(`${base}${path}`, {
      headers: { ...me.auth, range: `bytes=${bytes.length}-` },
    });
    expect(past.status).toBe(416);

    await env.DB.prepare("UPDATE exports SET expires_at = ? WHERE export_id = ?")
      .bind(Date.now() - 1, done.exportId)
      .run();
    expect(await errorOf(await me.call("GET", path))).toBe("expired");
    expect(
      ((await (await me.call("GET", "/v1/exports")).json()) as { exports: unknown[] }).exports,
    ).toEqual([]);
    expect(await expireExports(E)).toBe(1);
    expect(await mediaBucket(E).head(`exports/${done.exportId}.zip`)).toBeNull();
  });

  it("goes with the account, bytes included", async () => {
    const me = await person("Á förum");
    const done = await exported(me);
    expect(await mediaBucket(E).head(`exports/${done.exportId}.zip`)).not.toBeNull();
    await deleteAccount(E, me.accountId);
    expect(await mediaBucket(E).head(`exports/${done.exportId}.zip`)).toBeNull();
    expect(
      await env.DB.prepare("SELECT 1 FROM exports WHERE export_id = ?").bind(done.exportId).first(),
    ).toBeNull();
  });

  it("may be asked for by a suspended account, once a day, and again after a failure", async () => {
    const me = await person("Í banni");
    await env.DB.prepare("UPDATE accounts SET suspended_at = ? WHERE account_id = ?")
      .bind(Date.now(), me.accountId)
      .run();
    const made = await me.call("POST", "/v1/exports");
    expect(made.status).toBe(201);
    expect(await errorOf(await me.call("POST", "/v1/exports"))).toBe("conflict");
    await drain();
    expect(await errorOf(await me.call("POST", "/v1/exports"))).toBe("conflict");
    const { exportId } = (await made.json()) as { exportId: string };
    await env.DB.prepare(
      "UPDATE exports SET state = 'failed', failure = 'too_big' WHERE export_id = ?",
    )
      .bind(exportId)
      .run();
    expect((await me.call("POST", "/v1/exports")).status).toBe(201);
  });

  it("counts a build stuck for a day as failed and lets the person ask again", async () => {
    const me = await person("Fastur");
    const made = (await (await me.call("POST", "/v1/exports")).json()) as { exportId: string };
    await env.DB.prepare("UPDATE exports SET created_at = ? WHERE export_id = ?")
      .bind(Date.now() - 25 * 60 * 60 * 1000, made.exportId)
      .run();
    expect(await stateOf(me, made.exportId)).toMatchObject({ state: "failed", failure: "stalled" });
    expect((await me.call("POST", "/v1/exports")).status).toBe(201);
  });

  it("is refused a download while it builds", async () => {
    const me = await person("Bíður");
    const made = (await (await me.call("POST", "/v1/exports")).json()) as { exportId: string };
    expect(await errorOf(await me.call("GET", `/v1/exports/${made.exportId}/file`))).toBe(
      "conflict",
    );
    expect(LIMITS.partSize).toBeGreaterThanOrEqual(5 * 1024 * 1024);
  });
});
