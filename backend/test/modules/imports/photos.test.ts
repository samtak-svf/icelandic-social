import { describe, expect, it } from "vitest";
import { png } from "../../images.ts";
import { person } from "../../people.ts";
import {
  arrive,
  entry,
  items,
  MAY_2019,
  media,
  namedAlbum,
  photo,
  postsFile,
  status,
  upload,
  utf8,
  wall,
} from "./file-support.ts";
import { buildZip, type FixtureEntry } from "./zip-fixture.ts";

// Photos outside the posts file (decision 0127). The bug each test names: a thousand photos becoming
// a thousand posts, one photo arriving twice, a profile picture landing on the wall unasked, and a
// post that is nothing but an album's name.

const SECONDS = MAY_2019 / 1000;
const DAY = 24 * 60 * 60;
const pathOf = (name: string) => `posts/media/${name}.png`;
const namesOf = (count: number) => Array.from({ length: count }, (_, n) => pathOf(`p${n}`));

async function zipOf(lists: FixtureEntry[], files: string[], posts: unknown[] = []) {
  const image = await png(8, 8);
  return buildZip([postsFile(posts), ...lists, ...files.map((name) => ({ name, data: image }))]);
}

const classOf = async (zip: Uint8Array, kind: string) => {
  const owner = await person("eigandi");
  const importId = await upload(owner, zip);
  const read = await status(owner, importId);
  return read.classes.find((c) => c.class === kind);
};

describe("photos in an album", () => {
  it("leaves out a photo a post already holds", async () => {
    const [held, free] = namesOf(2) as [string, string];
    const zip = await zipOf(
      [namedAlbum(0, "Ferðin", [photo(held, SECONDS), photo(free, SECONDS)])],
      [held, free],
      [entry(SECONDS, "Mynd úr ferðinni", media(held))],
    );
    expect(await classOf(zip, "album")).toMatchObject({ posts: 1, images: 1 });
  });

  it("gathers a day's photos under the album's name and its description", async () => {
    const names = namesOf(3);
    const zip = await zipOf(
      [
        namedAlbum(
          0,
          "Ferðin",
          names.map((name) => photo(name, SECONDS)),
          "Um sumarið",
        ),
      ],
      names,
    );
    const owner = await person("eigandi");
    const preview = await items(owner, await upload(owner, zip));
    expect(preview).toHaveLength(1);
    expect(preview[0]).toMatchObject({ class: "album", text: "Ferðin\n\nUm sumarið", images: 3 });
  });

  it("makes a post of each day", async () => {
    const [first, second] = namesOf(2) as [string, string];
    const zip = await zipOf(
      [namedAlbum(0, "Ferðin", [photo(first, SECONDS), photo(second, SECONDS + DAY)])],
      [first, second],
    );
    expect(await classOf(zip, "album")).toMatchObject({ posts: 2, images: 2 });
  });

  it("keeps two albums of one day apart", async () => {
    const [first, second] = namesOf(2) as [string, string];
    const zip = await zipOf(
      [
        namedAlbum(0, "Ferðin", [photo(first, SECONDS)]),
        namedAlbum(1, "Fjallið", [photo(second, SECONDS)]),
      ],
      [first, second],
    );
    expect(await classOf(zip, "album")).toMatchObject({ posts: 2, images: 2 });
  });

  it("gives a captioned photo its own post, under its caption", async () => {
    const [plain, captioned] = namesOf(2) as [string, string];
    const zip = await zipOf(
      [namedAlbum(0, "Ferðin", [photo(plain, SECONDS), photo(captioned, SECONDS, "Fjallið")])],
      [plain, captioned],
    );
    const owner = await person("eigandi");
    const preview = await items(owner, await upload(owner, zip));
    expect(preview.map((item) => item.text).sort()).toEqual(["Ferðin", "Fjallið"]);
  });

  it("makes one post of photos with one caption from one album and day", async () => {
    const names = namesOf(3);
    const zip = await zipOf(
      [
        namedAlbum(
          0,
          "Ferðin",
          names.map((name) => photo(name, SECONDS, "Sami textinn")),
        ),
      ],
      names,
    );
    expect(await classOf(zip, "album")).toMatchObject({ posts: 1, images: 3 });
  });

  it("goes on in another post past what a post holds", async () => {
    const names = namesOf(23);
    const zip = await zipOf(
      [
        namedAlbum(
          0,
          "Ferðin",
          names.map((name) => photo(name, SECONDS)),
        ),
      ],
      names,
    );
    expect(await classOf(zip, "album")).toMatchObject({ posts: 2, images: 23 });
  });

  it("does not make a post of an album's name when its photos are missing", async () => {
    const zip = await zipOf([namedAlbum(0, "Ferðin", [photo(pathOf("gone"), SECONDS)])], []);
    const owner = await person("eigandi");
    const read = await status(owner, await upload(owner, zip));
    expect(read.classes.find((c) => c.class === "album")?.posts).toBe(0);
    expect(read.lost.empty).toBe(1);
  });

  it("keeps a caption whose photo is missing, as a post of its words", async () => {
    const zip = await zipOf(
      [namedAlbum(0, "Ferðin", [photo(pathOf("gone"), SECONDS, "Fjallið")])],
      [],
    );
    expect(await classOf(zip, "album")).toMatchObject({ posts: 1, images: 0 });
  });

  it("does not read a video as a photo", async () => {
    const zip = await zipOf(
      [namedAlbum(0, "Ferðin", [photo("posts/media/clip.mp4", SECONDS, "Bútur")])],
      [],
    );
    expect(await classOf(zip, "album")).toMatchObject({ posts: 0, images: 0 });
  });
});

describe("photos that were never posts", () => {
  const profile = "posts/media/Profilepictures_abc/me.png";
  const cover = "posts/media/Coverphotos_abc/cover.png";
  const loose = pathOf("loose");
  const free = pathOf("free");
  const lists = [
    namedAlbum(0, "Prófíll", [photo(profile, SECONDS), photo(cover, SECONDS)]),
    namedAlbum(1, "Ferðin", [photo(free, SECONDS)]),
    {
      name: "posts/your_uncategorized_photos.json",
      data: utf8({ other_photos_v2: [{ uri: loose, creation_timestamp: SECONDS }] }),
    },
  ];
  const zip = () => zipOf(lists, [profile, cover, loose, free]);

  it("sorts them by where the export keeps them", async () => {
    const owner = await person("eigandi");
    const read = await status(owner, await upload(owner, await zip()));
    const of = (kind: string) => read.classes.find((c) => c.class === kind);
    expect(of("album")).toMatchObject({ posts: 1, images: 1 });
    expect(of("profile")).toMatchObject({ posts: 1, images: 2 });
    expect(of("uncategorized")).toMatchObject({ posts: 1, images: 1 });
  });

  it("brings in the albums and leaves the rest out unless they are chosen", async () => {
    const owner = await person("eigandi");
    await arrive(owner, await upload(owner, await zip()));
    const posts = await wall(owner, owner);
    expect(posts.map((post) => post.media.length)).toEqual([1]);
  });

  it("brings in exactly the kinds chosen, as many as the preview counted", async () => {
    const owner = await person("eigandi");
    const importId = await upload(owner, await zip());
    const read = await status(owner, importId);
    const counted = read.classes.find((c) => c.class === "profile");
    await arrive(owner, importId, { classes: ["profile"] });
    const posts = await wall(owner, owner);
    expect(posts).toHaveLength(counted?.posts ?? -1);
    expect(posts[0]?.media).toHaveLength(counted?.images ?? -1);
  });
});

describe("the videos an export holds", () => {
  it("counts their files and bytes, though none comes in", async () => {
    const clip = { name: "posts/media/clip.mp4", data: new Uint8Array(2048) };
    const owner = await person("eigandi");
    const read = await status(owner, await upload(owner, await zipOf([clip], [])));
    expect(read.lost).toMatchObject({ videoFiles: 1, videoBytes: 2048 });
  });
});
