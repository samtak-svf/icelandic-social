import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { mediaBucket } from "../../../src/env/index.ts";
import { MAX_FILE, FILE_MS } from "../../../src/modules/imports/file.ts";
import { expireFiles, jobHandlers } from "../../../src/modules/imports/index.ts";
import { runJobs } from "../../../src/modules/jobs/index.ts";
import { deleteAccount } from "../../../src/compose/account-deletion.ts";
import { worker } from "../../main.ts";
import { png } from "../../images.ts";
import { errorOf, ok, person, type Person } from "../../people.ts";
import { euEnv } from "../../support.ts";
import { befriend, type WallPost } from "../social/wall-support.ts";
import { buildZip, type FixtureEntry } from "./zip-fixture.ts";

// An export file, from upload to the wall (decision 0119). The bug each test names:
// a repeat that duplicates, text mangled or a date lost, something public nobody
// chose, a bad entry or a bad archive that takes the whole import with it, someone
// else reaching an upload, and bytes or rows left behind.

const E = euEnv(env);
const BASE = "https://spjall.test";
const MAY_2019 = Date.UTC(2019, 4, 17, 12, 30, 45);

type Status = {
  state: string;
  failure: string | null;
  counts: { posts: number; images: number; videos: number; skipped: number };
};
type Item = { id: string; at: number; text: string; images: number; hasVideo: boolean };
type Read = WallPost & { createdAt: number; imported?: boolean; media: unknown[] };

/** How the export writes text: each UTF-8 byte as one Latin-1 code point. */
const escaped = (text: string) => String.fromCharCode(...new TextEncoder().encode(text));
const utf8 = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

const entry = (seconds: number, text: string, extra: object = {}) => ({
  timestamp: seconds,
  data: [{ post: escaped(text) }],
  ...extra,
});
const media = (...uris: string[]) => ({
  attachments: [{ data: uris.map((uri) => ({ media: { uri } })) }],
});

const postsFile = (entries: unknown[], name = "your_posts_1.json"): FixtureEntry => ({
  name: `posts/${name}`,
  data: utf8(entries),
  method: "deflate",
});

async function drain(): Promise<void> {
  for (let i = 0; i < 30; i++) {
    const { done } = await runJobs(E, jobHandlers(), Date.now() + 1);
    if (done === 0) return;
  }
  throw new Error("the jobs did not finish");
}

const get = async <T>(owner: Person, path: string) => ok<T>(await owner.call("GET", path));

/** Uploads `zip` as `owner` in one part, completes it, and runs the parse. */
async function upload(owner: Person, zip: Uint8Array): Promise<string> {
  const started = await owner.call("POST", "/v1/imports/file", { size: zip.length });
  expect(started.status).toBe(201);
  const { importId } = (await started.json()) as { importId: string };
  const put = await worker.fetch(`${BASE}/v1/imports/${importId}/parts/1`, {
    method: "PUT",
    headers: { ...owner.auth, "content-type": "application/octet-stream" },
    body: zip,
  });
  expect(put.status).toBe(204);
  expect((await owner.call("POST", `/v1/imports/${importId}/complete`)).status).toBe(204);
  await drain();
  return importId;
}

const status = (owner: Person, importId: string) => get<Status>(owner, `/v1/imports/${importId}`);
const items = async (owner: Person, importId: string) =>
  (await get<{ items: Item[] }>(owner, `/v1/imports/${importId}/items`)).items;

async function publish(owner: Person, importId: string, choice: object = {}) {
  const response = await owner.call("POST", `/v1/imports/${importId}/publish`, choice);
  expect(response.status).toBe(204);
  await drain();
}

/** One page of 50, which holds every post these tests bring in. */
const wall = async (reader: Person, owner: Person) =>
  (await get<{ posts: Read[] }>(reader, `/v1/accounts/${owner.accountId}/wall/posts?limit=50`))
    .posts;

const rows = async (importId: string) =>
  (
    await env.DB.prepare("SELECT COUNT(*) AS n FROM import_file_items WHERE import_id = ?")
      .bind(importId)
      .first<{ n: number }>()
  )?.n;
const stored = async (importId: string) =>
  (await mediaBucket(E).head(`imports/${importId}`)) !== null;

const SAMPLE = [
  entry(MAY_2019 / 1000, "Fyrsta færsla með þ, ð, æ, ö"),
  entry(MAY_2019 / 1000 + 60, "Með mynd 😀", media("posts/media/a.png", "posts/media/b.png")),
  entry(MAY_2019 / 1000 + 120, "Með myndbandi", media("posts/media/c.mp4")),
];

async function sampleZip(entries: unknown[] = SAMPLE) {
  const image = await png(8, 8);
  return buildZip([
    postsFile(entries),
    { name: "posts/media/a.png", data: image },
    { name: "posts/media/b.png", data: image, method: "deflate" },
    { name: "posts/media/c.mp4", data: new Uint8Array([1, 2, 3]) },
  ]);
}

describe("an export file from upload to the wall", () => {
  it("running one file through upload, parse and publish twice creates each post once", async () => {
    const owner = await person("eigandi");
    const zip = await sampleZip();
    for (let run = 0; run < 2; run++) {
      const importId = await upload(owner, zip);
      await publish(owner, importId);
    }
    expect(await wall(owner, owner)).toHaveLength(3);
  });

  it("keeps the date, repairs the Icelandic text, carries the images and marks the post imported", async () => {
    const owner = await person("eigandi");
    const importId = await upload(owner, await sampleZip());
    await publish(owner, importId);
    const posts = await wall(owner, owner);
    const first = posts.find((p) => p.body.startsWith("Fyrsta"));
    expect(first).toMatchObject({
      body: "Fyrsta færsla með þ, ð, æ, ö",
      createdAt: MAY_2019,
      imported: true,
    });
    expect(posts.find((p) => p.body === "Með mynd 😀")?.media).toHaveLength(2);
    expect(posts.find((p) => p.body === "Með myndbandi")?.media).toHaveLength(0);
  });

  it("previews the posts with their counts, and says a post has a video", async () => {
    const owner = await person("eigandi");
    const importId = await upload(owner, await sampleZip());
    expect(await status(owner, importId)).toMatchObject({
      state: "ready",
      counts: { posts: 3, images: 2, videos: 1, skipped: 0 },
    });
    const preview = await items(owner, importId);
    expect(preview.map((i) => i.text)).toEqual([
      "Fyrsta færsla með þ, ð, æ, ö",
      "Með mynd 😀",
      "Með myndbandi",
    ]);
    expect(preview[1]).toMatchObject({ images: 2, hasVideo: false, at: MAY_2019 + 60_000 });
    expect(preview[2]).toMatchObject({ images: 0, hasVideo: true });
  });

  it("leaves an image missing from the ZIP out and still imports the text", async () => {
    const owner = await person("eigandi");
    const zip = await buildZip([
      postsFile([entry(MAY_2019 / 1000, "Mynd vantar", media("posts/media/gone.png"))]),
    ]);
    await publish(owner, await upload(owner, zip));
    const [post] = await wall(owner, owner);
    expect(post).toMatchObject({ body: "Mynd vantar" });
    expect(post?.media).toHaveLength(0);
  });

  it("brings in more than one run's worth, chaining the runs", async () => {
    const owner = await person("eigandi");
    const many = Array.from({ length: 23 }, (_, i) => entry(MAY_2019 / 1000 + i, `færsla ${i}`));
    const importId = await upload(owner, await buildZip([postsFile(many)]));
    await publish(owner, importId);
    expect(await wall(owner, owner)).toHaveLength(23);
    expect((await status(owner, importId)).state).toBe("done");
  });

  it("makes nothing public unless chosen", async () => {
    const owner = await person("eigandi");
    const friend = await person("vinur");
    const stranger = await person("okunnugur");
    await befriend(owner, friend);
    await publish(owner, await upload(owner, await sampleZip()));
    expect(await wall(friend, owner)).toHaveLength(3);
    expect(await wall(stranger, owner)).toHaveLength(0);
  });

  it("makes the posts public when the person chose that", async () => {
    const owner = await person("eigandi");
    const stranger = await person("okunnugur");
    const importId = await upload(owner, await sampleZip());
    await publish(owner, importId, { audience: "everyone" });
    expect(await wall(stranger, owner)).toHaveLength(3);
  });

  it("publishes only the dates and posts chosen", async () => {
    const owner = await person("eigandi");
    const importId = await upload(owner, await sampleZip());
    const [first, second, third] = await items(owner, importId);
    await publish(owner, importId, {
      from: first!.at + 1,
      to: third!.at,
      excluded: [third!.id],
    });
    expect((await wall(owner, owner)).map((p) => p.body)).toEqual([second!.text]);
  });
});

describe("a file that cannot be read", () => {
  it("skips an entry in a shape it does not know, and the file still imports", async () => {
    const owner = await person("eigandi");
    const zip = await sampleZip([...SAMPLE, "x", { timestamp: "soon" }, { data: [] }]);
    expect(await status(owner, await upload(owner, zip))).toMatchObject({
      state: "ready",
      counts: { posts: 3, skipped: 3 },
    });
  });

  it("ends a truncated ZIP in failed, and drops the bytes", async () => {
    const owner = await person("eigandi");
    const whole = await sampleZip();
    const importId = await upload(owner, whole.subarray(0, whole.length - 30));
    expect(await status(owner, importId)).toMatchObject({ state: "failed", failure: "truncated" });
    expect(await stored(importId)).toBe(false);
  });

  it("ends a zip64 archive in failed", async () => {
    const owner = await person("eigandi");
    const zip = await buildZip([{ ...postsFile([]), zip64: true }]);
    expect(await status(owner, await upload(owner, zip))).toMatchObject({
      state: "failed",
      failure: "zip64",
    });
  });

  it("ends an encrypted entry in failed", async () => {
    const owner = await person("eigandi");
    const zip = await buildZip([{ ...postsFile([]), encrypted: true }]);
    expect(await status(owner, await upload(owner, zip))).toMatchObject({
      state: "failed",
      failure: "encrypted",
    });
  });

  it("ends an archive with no posts file in failed", async () => {
    const owner = await person("eigandi");
    const zip = await buildZip([{ name: "readme.txt", data: utf8("x") }]);
    expect(await status(owner, await upload(owner, zip))).toMatchObject({
      state: "failed",
      failure: "no_posts",
    });
  });

  it("fails a zip bomb whose header lies about its size, rather than inflating it", async () => {
    const owner = await person("eigandi");
    // Past what a Worker can hold as bytes, text and parsed objects at once.
    const bomb = new Uint8Array(33 * 1024 * 1024);
    const zip = await buildZip([
      { name: "posts/your_posts_1.json", data: bomb, method: "deflate", declaredSize: 10 },
    ]);
    expect(await status(owner, await upload(owner, zip))).toMatchObject({
      state: "failed",
      failure: "too_big",
    });
  });

  it("refuses an upload past the largest a file may be", async () => {
    const owner = await person("eigandi");
    const response = await owner.call("POST", "/v1/imports/file", { size: MAX_FILE + 1 });
    expect(response.status).toBe(413);
    expect(await errorOf(response)).toBe("too_large");
  });

  it("refuses to complete with a part missing", async () => {
    const owner = await person("eigandi");
    const started = await owner.call("POST", "/v1/imports/file", { size: 10 });
    const { importId } = (await started.json()) as { importId: string };
    const response = await owner.call("POST", `/v1/imports/${importId}/complete`);
    expect(response.status).toBe(409);
    expect(await errorOf(response)).toBe("incomplete");
  });
});

describe("whose import it is", () => {
  it("answers not_found to another person on every route", async () => {
    const owner = await person("eigandi");
    const other = await person("annar");
    const id = await upload(owner, await sampleZip());
    const part = await worker.fetch(`${BASE}/v1/imports/${id}/parts/1`, {
      method: "PUT",
      headers: { ...other.auth, "content-type": "application/octet-stream" },
      body: new Uint8Array(4),
    });
    const calls = [
      part,
      await other.call("POST", `/v1/imports/${id}/complete`),
      await other.call("GET", `/v1/imports/${id}`),
      await other.call("GET", `/v1/imports/${id}/items`),
      await other.call("POST", `/v1/imports/${id}/publish`, {}),
      await other.call("DELETE", `/v1/imports/${id}`),
    ];
    for (const response of calls) {
      expect(response.status).toBe(404);
      expect(await errorOf(response)).toBe("not_found");
    }
    expect((await status(owner, id)).state).toBe("ready");
  });
});

describe("what is left behind", () => {
  it("deletes the upload and the preview rows after the publish", async () => {
    const owner = await person("eigandi");
    const importId = await upload(owner, await sampleZip());
    expect(await stored(importId)).toBe(true);
    await publish(owner, importId);
    expect(await stored(importId)).toBe(false);
    expect(await rows(importId)).toBe(0);
    expect((await status(owner, importId)).state).toBe("done");
  });

  it("deletes the upload and the rows at once on DELETE, and the posts it brought go", async () => {
    const owner = await person("eigandi");
    const importId = await upload(owner, await sampleZip());
    expect((await owner.call("DELETE", `/v1/imports/${importId}`)).status).toBe(204);
    expect(await stored(importId)).toBe(false);
    expect(await rows(importId)).toBe(0);
    expect((await status(owner, importId)).state).toBe("removing");
    await drain();
    expect((await owner.call("GET", `/v1/imports/${importId}`)).status).toBe(404);
  });

  it("removes the posts a finished import brought in", async () => {
    const owner = await person("eigandi");
    const importId = await upload(owner, await sampleZip());
    await publish(owner, importId);
    await owner.call("DELETE", `/v1/imports/${importId}`);
    await drain();
    expect(await wall(owner, owner)).toHaveLength(0);
  });

  it("deletes an upload left unpublished past 7 days, the unfinished one too", async () => {
    const owner = await person("eigandi");
    const importId = await upload(owner, await sampleZip());
    const started = await owner.call("POST", "/v1/imports/file", { size: 10 });
    const half = ((await started.json()) as { importId: string }).importId;
    expect(await expireFiles(E, Date.now() + FILE_MS - 60_000)).toBe(0);
    expect(await expireFiles(E, Date.now() + FILE_MS + 60_000)).toBeGreaterThanOrEqual(2);
    for (const id of [importId, half]) {
      expect(await stored(id)).toBe(false);
      expect(await rows(id)).toBe(0);
      expect((await owner.call("GET", `/v1/imports/${id}`)).status).toBe(404);
    }
  });

  it("deletes an account's upload with the account", async () => {
    const owner = await person("eigandi");
    const importId = await upload(owner, await sampleZip());
    await deleteAccount(E, owner.accountId);
    expect(await stored(importId)).toBe(false);
  });
});
