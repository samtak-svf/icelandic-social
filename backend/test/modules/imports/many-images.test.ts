import { describe, expect, it } from "vitest";
import { aRun } from "../../../src/modules/imports/file-jobs.ts";
import { png } from "../../images.ts";
import { person } from "../../people.ts";
import {
  album,
  arrive,
  entry,
  items,
  MAY_2019,
  media,
  postsFile,
  status,
  upload,
  wall,
} from "./file-support.ts";
import { buildZip } from "./zip-fixture.ts";

// A post with more images than the composer allows (decision 0127). The bug each test names: images
// cut at the composer's limit, a post that loses the ones past what a post holds, a second post
// whose id the choice of posts refuses, and a run that tries to carry them all at once.

const SECONDS = MAY_2019 / 1000;
const paths = (count: number, of = "a") =>
  Array.from({ length: count }, (_, n) => `posts/media/${of}${n}.png`);

async function zipOf(entries: unknown[], names: string[]) {
  const image = await png(8, 8);
  return buildZip([
    postsFile(entries),
    album(...names),
    ...names.map((name) => ({ name, data: image })),
  ]);
}

const ids = (post: { media: unknown[] }) =>
  post.media.map((item) => (item as { mediaId: string }).mediaId);

describe("a post of many images", () => {
  it("keeps every image up to what a post holds, in order", async () => {
    const owner = await person("eigandi");
    const names = paths(6);
    const importId = await upload(
      owner,
      await zipOf([entry(SECONDS, "Sex myndir", media(...names))], names),
    );
    const { classes } = await status(owner, importId);
    expect(classes.find((c) => c.class === "own")).toMatchObject({
      posts: 1,
      images: 6,
      imagesLost: 0,
    });
    await arrive(owner, importId);
    const [post] = await wall(owner, owner);
    expect(ids(post!)).toHaveLength(6);
  });

  it("goes on in a second post with the same date, the words staying on the first", async () => {
    const owner = await person("eigandi");
    const names = paths(23);
    const importId = await upload(
      owner,
      await zipOf([entry(SECONDS, "Margar myndir", media(...names))], names),
    );
    const { classes } = await status(owner, importId);
    expect(classes.find((c) => c.class === "own")).toMatchObject({
      posts: 2,
      images: 23,
      imagesLost: 0,
    });
    const preview = await items(owner, importId);
    expect(preview.map((item) => item.images).toSorted((a, b) => a - b)).toEqual([3, 20]);
    expect(new Set(preview.map((item) => item.at))).toEqual(new Set([MAY_2019]));
    for (const { id } of preview) expect(id.length).toBeLessThanOrEqual(64);

    await arrive(owner, importId);
    const posts = await wall(owner, owner);
    expect(posts.map((post) => post.media.length).toSorted((a, b) => a - b)).toEqual([3, 20]);
    expect(posts.find((post) => post.media.length === 20)).toMatchObject({ body: "Margar myndir" });
    expect(posts.find((post) => post.media.length === 3)).toMatchObject({ body: "" });
    expect(new Set(posts.map((post) => post.createdAt))).toEqual(new Set([MAY_2019]));
  });

  it("can leave the second post out on its own", async () => {
    const owner = await person("eigandi");
    const names = paths(23);
    const importId = await upload(
      owner,
      await zipOf([entry(SECONDS, "Margar myndir", media(...names))], names),
    );
    const preview = await items(owner, importId);
    const second = preview.find((item) => item.images === 3);
    await arrive(owner, importId, { excluded: [second!.id] });
    const posts = await wall(owner, owner);
    expect(posts.map((post) => post.media.length)).toEqual([20]);
  });

  it("brings in more images than one run carries", async () => {
    const owner = await person("eigandi");
    const names = Array.from({ length: 5 }, (_, n) => paths(20, `p${n}-`));
    const importId = await upload(
      owner,
      await zipOf(
        names.map((own, n) => entry(SECONDS + n * 60, `Færsla ${n + 1}`, media(...own))),
        names.flat(),
      ),
    );
    await arrive(owner, importId);
    expect((await status(owner, importId)).state).toBe("done");
    const posts = await wall(owner, owner);
    expect(posts.map((post) => post.media.length)).toEqual([20, 20, 20, 20, 20]);
  });
});

describe("what one publish run takes", () => {
  const row = (count: number) => ({ images: JSON.stringify(paths(count)) });

  it("stops at the images a run carries", () => {
    expect(aRun([row(20), row(20), row(20), row(20), row(20)])).toHaveLength(4);
    expect(aRun([row(40), row(40), row(1)])).toHaveLength(2);
  });

  it("always takes one, or a post would never come", () => {
    expect(aRun([row(100), row(1)])).toHaveLength(1);
    expect(aRun([])).toEqual([]);
  });

  it("takes them all when they fit", () => {
    expect(aRun([row(1), row(0), row(2)])).toHaveLength(3);
  });
});
