import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { mediaBucket } from "../../../src/env/index.ts";
import { MAX_FILE, FILE_MS } from "../../../src/modules/imports/file.ts";
import { expireFiles } from "../../../src/modules/imports/index.ts";
import { deleteAccount } from "../../../src/compose/account-deletion.ts";
import { worker } from "../../main.ts";
import { png } from "../../images.ts";
import { errorOf, person, type Person } from "../../people.ts";
import {
  album,
  arrive,
  BASE,
  drain,
  E,
  entry,
  get,
  items,
  MAY_2019,
  media,
  OWN_MEDIA,
  postsFile,
  sampleZip,
  status,
  upload,
  utf8,
  wall,
  SAMPLE,
  type Status,
} from "./file-support.ts";
import { buildZip } from "./zip-fixture.ts";

// An export file, from upload to the wall (decision 0119). The bug each test names:
// a repeat that duplicates, text mangled or a date lost, a bad entry or a bad archive
// that takes the whole import with it, someone else reaching an upload, and bytes or rows
// left behind.

const rows = async (importId: string) =>
  (
    await env.DB.prepare("SELECT COUNT(*) AS n FROM import_file_items WHERE import_id = ?")
      .bind(importId)
      .first<{ n: number }>()
  )?.n;
const stored = async (importId: string) =>
  (await mediaBucket(E).head(`imports/${importId}`)) !== null;

describe("an export file from upload to the wall", () => {
  it("running one file through upload, parse and publish twice creates each post once", async () => {
    const owner = await person("eigandi");
    const zip = await sampleZip();
    for (let run = 0; run < 2; run++) {
      const importId = await upload(owner, zip);
      await arrive(owner, importId);
    }
    expect(await wall(owner, owner)).toHaveLength(3);
  });

  it("keeps the date, repairs the Icelandic text, carries the images and marks the post imported", async () => {
    const owner = await person("eigandi");
    const importId = await upload(owner, await sampleZip());
    await arrive(owner, importId);
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
      album("posts/media/gone.png"),
    ]);
    const importId = await upload(owner, zip);
    const { classes } = await status(owner, importId);
    expect(classes.find((c) => c.class === "own")).toMatchObject({
      posts: 1,
      images: 0,
      imagesLost: 1,
    });
    await arrive(owner, importId);
    const [post] = await wall(owner, owner);
    expect(post).toMatchObject({ body: "Mynd vantar" });
    expect(post?.media).toHaveLength(0);
  });

  it("brings a long text in whole, however long a post written here may be", async () => {
    const owner = await person("eigandi");
    const long = "ð".repeat(49_143);
    const importId = await upload(owner, await sampleZip([entry(MAY_2019 / 1000, long)]));
    await arrive(owner, importId);
    const [post] = await wall(owner, owner);
    expect(post?.body).toBe(long);
  });

  it("brings in more than one run's worth, chaining the runs", async () => {
    const owner = await person("eigandi");
    const many = Array.from({ length: 23 }, (_, i) => entry(MAY_2019 / 1000 + i, `færsla ${i}`));
    const importId = await upload(owner, await buildZip([postsFile(many)]));
    await arrive(owner, importId);
    expect(await wall(owner, owner)).toHaveLength(23);
    expect((await status(owner, importId)).state).toBe("done");
  });

  it("publishes only the dates and posts chosen", async () => {
    const owner = await person("eigandi");
    const importId = await upload(owner, await sampleZip());
    const [first, second, third] = await items(owner, importId);
    await arrive(owner, importId, {
      from: first!.at + 1,
      to: third!.at,
      excluded: [third!.id],
    });
    expect((await wall(owner, owner)).map((p) => p.body)).toEqual([second!.text]);
  });
});

describe("the kinds of post a file holds (decision 0127)", () => {
  const AT = MAY_2019 / 1000;
  const LINK = "https://example.test/grein";
  const linkOnly = { attachments: [{ data: [{ external_context: { url: LINK } }] }] };
  const KINDS = [
    entry(AT, "Mín orð", media("posts/media/a.png", "posts/media/b.png", "posts/media/c.mp4")),
    { timestamp: AT + 1, ...linkOnly },
    entry(AT + 2, "Á síðu annars"),
    entry(AT + 3, "Falið"),
    { timestamp: AT + 4, attachments: [{ data: [{ media: { uri: "posts/media/d.png" } }] }] },
    { timestamp: AT + 5, attachments: [{ data: [{ media: { uri: "posts/media/c.mp4" } }] }] },
    { timestamp: AT + 6, data: [] },
    entry(AT + 7, "Með mynd annars", media("posts/media/d.png")),
  ];

  async function kindsZip(entries: unknown[] = KINDS) {
    const image = await png(8, 8);
    return buildZip([
      postsFile(entries),
      OWN_MEDIA,
      {
        name: "posts/posts_on_other_pages_and_profiles.json",
        data: utf8({ wall: [{ timestamp: AT + 2 }] }),
      },
      {
        name: "posts/archive.json",
        data: utf8({ archive: [{ timestamp: AT + 3, label_values: [{ value: "Falið" }] }] }),
      },
      { name: "posts/media/a.png", data: image },
      { name: "posts/media/b.png", data: image },
      { name: "posts/media/c.mp4", data: new Uint8Array([1]) },
      { name: "posts/media/d.png", data: image },
    ]);
  }

  it("counts each kind, and says what will not come, and why", async () => {
    const owner = await person("eigandi");
    const read = await status(owner, await upload(owner, await kindsZip()));
    expect(read.classes).toEqual([
      { class: "own", posts: 2, images: 2, imagesLost: 0, videos: 1 },
      { class: "link", posts: 1, images: 0, imagesLost: 0, videos: 0 },
      { class: "other_timeline", posts: 1, images: 0, imagesLost: 0, videos: 0 },
      { class: "hidden", posts: 1, images: 0, imagesLost: 0, videos: 0 },
    ]);
    expect(read.lost).toEqual({ videoOnly: 1, foreignOnly: 1, foreignImages: 1, empty: 1 });
  });

  it("labels each preview row with its kind", async () => {
    const owner = await person("eigandi");
    const preview = await items(owner, await upload(owner, await kindsZip()));
    expect(preview.map((i) => i.class)).toEqual(["own", "link", "other_timeline", "hidden", "own"]);
  });

  it("publishes only the person's own posts when no kind is named", async () => {
    const owner = await person("eigandi");
    await arrive(owner, await upload(owner, await kindsZip()));
    const posts = await wall(owner, owner);
    expect(posts.map((p) => p.body).sort()).toEqual(["Með mynd annars", "Mín orð"]);
    expect(posts.find((p) => p.body === "Með mynd annars")?.media).toHaveLength(0);
  });

  it("publishes exactly the kinds chosen", async () => {
    const owner = await person("eigandi");
    const importId = await upload(owner, await kindsZip());
    await arrive(owner, importId, { classes: ["link", "hidden"] });
    expect((await wall(owner, owner)).map((p) => p.body).sort()).toEqual(["Falið", LINK]);
    expect((await status(owner, importId)).state).toBe("done");
  });

  it("refuses an empty choice of kinds and a kind there is not", async () => {
    const owner = await person("eigandi");
    const importId = await upload(owner, await kindsZip());
    for (const classes of [[], ["everything"]]) {
      const response = await owner.call("POST", `/v1/imports/${importId}/publish`, { classes });
      expect(response.status).toBe(400);
    }
  });

  it("the preview's counts are what arrives on the wall", async () => {
    const owner = await person("eigandi");
    const importId = await upload(owner, await kindsZip());
    const { classes } = await status(owner, importId);
    const own = classes.find((c) => c.class === "own");
    await arrive(owner, importId);
    const posts = await wall(owner, owner);
    expect(posts).toHaveLength(own!.posts);
    expect(posts.reduce((sum, p) => sum + p.media.length, 0)).toBe(own!.images);
  });

  it("brings no image when the export has no lists saying whose it is, and counts them", async () => {
    const owner = await person("eigandi");
    const zip = await buildZip([
      postsFile([entry(AT, "Orð", media("posts/media/a.png"))]),
      { name: "posts/media/a.png", data: await png(8, 8) },
    ]);
    const importId = await upload(owner, zip);
    expect((await status(owner, importId)).lost.foreignImages).toBe(1);
    await arrive(owner, importId);
    const [post] = await wall(owner, owner);
    expect(post?.media).toHaveLength(0);
  });

  it("counts an entry the export repeats once", async () => {
    const owner = await person("eigandi");
    const video = {
      timestamp: AT,
      attachments: [{ data: [{ media: { uri: "posts/media/c.mp4" } }] }],
    };
    const twice = [
      video,
      video,
      entry(AT + 1, "Annars", media("posts/media/d.png")),
      entry(AT + 1, "Annars", media("posts/media/d.png")),
    ];
    const read = await status(owner, await upload(owner, await kindsZip(twice)));
    expect(read.lost).toMatchObject({ videoOnly: 1, foreignImages: 1 });
    expect(read.classes.find((c) => c.class === "own")?.posts).toBe(1);
  });
});

describe("a file read before the kinds of post were counted", () => {
  it("failing as outdated is a state the screen can name", async () => {
    const owner = await person("eigandi");
    const importId = await upload(owner, await sampleZip());
    await env.DB.prepare(
      "UPDATE import_files SET state = 'failed', failure = 'outdated' WHERE import_id = ?",
    )
      .bind(importId)
      .run();
    expect(await status(owner, importId)).toMatchObject({ state: "failed", failure: "outdated" });
    expect((await owner.call("DELETE", `/v1/imports/${importId}`)).status).toBe(204);
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
      await other.call("GET", `/v1/imports/${id}/held`),
      await other.call("POST", `/v1/imports/${id}/open`, { audience: "everyone" }),
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
    await arrive(owner, importId);
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
    await arrive(owner, importId);
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

describe("the list of a person's file imports", () => {
  type Listed = Status & { importId: string; createdAt: number };
  const listed = async (owner: Person) =>
    (await get<{ imports: Listed[] }>(owner, "/v1/imports")).imports;

  it("finds a published import again, to remove it, and only the owner's", async () => {
    const owner = await person("eigandi");
    const other = await person("annar");
    const importId = await upload(owner, await sampleZip());
    await arrive(owner, importId);
    const [only, ...rest] = await listed(owner);
    expect(rest).toEqual([]);
    expect(only).toMatchObject({ importId, state: "done", counts: { posts: 3 } });
    expect(await listed(other)).toEqual([]);
  });

  it("leaves out an import being removed", async () => {
    const owner = await person("eigandi");
    const importId = await upload(owner, await sampleZip());
    expect((await owner.call("DELETE", `/v1/imports/${importId}`)).status).toBe(204);
    expect(await listed(owner)).toEqual([]);
  });

  it("puts the newest first", async () => {
    const owner = await person("eigandi");
    const first = await upload(owner, await sampleZip());
    const second = await upload(owner, await sampleZip());
    await env.DB.prepare("UPDATE import_sources SET created_at = 1000 WHERE import_id = ?")
      .bind(first)
      .run();
    expect((await listed(owner)).map((row) => row.importId)).toEqual([second, first]);
  });
});
