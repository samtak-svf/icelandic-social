import { describe, expect, it } from "vitest";
import { readContext } from "../../../src/modules/imports/export-context.ts";
import {
  type ExportContext,
  parseExportFile as parse,
  repairText,
} from "../../../src/modules/imports/export-file.ts";

// The parser is pure. The bug each test names: Icelandic letters mangled by the
// export's byte escapes, correct text mangled by a repair that was not needed, one
// odd entry failing a whole file, and an id that changes between two reads.

/** How the export writes text: each UTF-8 byte as one Latin-1 code point. */
const escaped = (text: string) => String.fromCharCode(...new TextEncoder().encode(text));

const context = (over: Partial<ExportContext> = {}): ExportContext => ({
  ownMedia: new Set(),
  otherTimelines: new Set(),
  archived: new Map(),
  ...over,
});
const parseExportFile = (json: unknown, over: Partial<ExportContext> = {}) =>
  parse(json, context(over));

describe("repairing the export's encoding", () => {
  it("repairs escaped Icelandic letters", () => {
    expect(repairText(escaped("Þetta er gömul færsla: ð, æ, ö, ý"))).toBe(
      "Þetta er gömul færsla: ð, æ, ö, ý",
    );
  });

  it("repairs an escaped emoji", () => {
    expect(repairText(escaped("Gaman 😀"))).toBe("Gaman 😀");
  });

  it("leaves correctly written Icelandic text alone, which is no valid UTF-8 read as bytes", () => {
    const text = "Gömul færsla með þ, ð, æ, ö";
    expect(repairText(text)).toBe(text);
  });

  it("leaves a string with a code point above 0xFF alone", () => {
    const text = `${escaped("Gömul")} og 😀`;
    expect(repairText(text)).toBe(text);
  });

  it("leaves plain ASCII alone", () => {
    expect(repairText("hello")).toBe("hello");
  });
});

describe("parsing a posts file", () => {
  const at = 1_558_096_245;
  const post = (over: object = {}) => ({
    timestamp: at,
    data: [{ post: escaped("Fyrsta færsla") }],
    ...over,
  });

  it("reads the date in seconds as milliseconds, the text, images and the video flag", async () => {
    const { items, skipped } = await parseExportFile(
      [
        post({
          attachments: [
            {
              data: [
                { media: { uri: "posts/media/a.JPG" } },
                { media: { uri: "./posts/media/b.mp4" } },
                { media: { uri: "posts/media/a.JPG" } },
              ],
            },
          ],
        }),
      ],
      { ownMedia: new Set(["posts/media/a.JPG", "posts/media/b.mp4"]) },
    );
    expect(skipped).toBe(0);
    expect(items).toMatchObject([
      { at: at * 1000, body: "Fyrsta færsla", images: ["posts/media/a.JPG"], hasVideo: true },
    ]);
  });

  it("keeps an external link on its own line unless the text has it", async () => {
    const link = "https://example.test/grein";
    const attach = { attachments: [{ data: [{ external_context: { url: link } }] }] };
    const [added] = (await parseExportFile([post(attach)])).items;
    expect(added?.body).toBe(`Fyrsta færsla\n${link}`);
    const [kept] = (await parseExportFile([post({ ...attach, data: [{ post: `sjá ${link}` }] })]))
      .items;
    expect(kept?.body).toBe(`sjá ${link}`);
  });

  it("reads an AVIF image, which a real export holds beside JPEG and PNG", async () => {
    const { items, skipped } = await parseExportFile(
      [{ timestamp: at, attachments: [{ data: [{ media: { uri: "posts/media/a.avif" } }] }] }],
      { ownMedia: new Set(["posts/media/a.avif"]) },
    );
    expect(skipped).toBe(0);
    expect(items[0]?.images).toEqual(["posts/media/a.avif"]);
  });

  it("repairs the escaped letters of a link, as it does a post's text", async () => {
    const link = "https://example.test/grein-um-ísland";
    const attach = { attachments: [{ data: [{ external_context: { url: escaped(link) } }] }] };
    const [item] = (await parseExportFile([post(attach)])).items;
    expect(item?.body).toBe(`Fyrsta færsla\n${link}`);
  });

  it("gives the same id to the same post and another to another", async () => {
    const [a, b, other] = (
      await parseExportFile([post(), post(), post({ data: [{ post: "önnur" }] })])
    ).items;
    expect(a?.id).toBe(b?.id);
    expect(a?.id).not.toBe(other?.id);
    expect(a?.id).toMatch(/^[0-9a-f]{64}$/);
  });

  it("skips an entry in a shape it does not know and counts it, never failing the file", async () => {
    const { items, skipped } = await parseExportFile([
      "text",
      null,
      { data: [{ post: "no date" }] },
      { timestamp: "soon", data: [] },
      { timestamp: at, data: "not a list" },
      post(),
    ]);
    expect(items).toHaveLength(1);
    expect(skipped).toBe(5);
  });

  it("counts a file that is not a list as one skipped", async () => {
    expect(await parseExportFile({ posts: [] })).toEqual({
      items: [],
      dropped: [],
      skipped: 1,
    });
  });
});

describe("what kind of post an entry is (decision 0127)", () => {
  const at = 1_558_096_245;
  const photo = { media: { uri: "posts/media/a.jpg" } };
  const clip = { media: { uri: "posts/media/b.mp4" } };
  const attached = (...items: object[]) => ({ attachments: [{ data: items }] });
  const link = "https://example.test/grein";
  const linked = attached({ external_context: { url: link } });
  const words = (text: string) => ({ data: [{ post: text }] });
  const own = { ownMedia: new Set([photo.media.uri, clip.media.uri]) };

  async function one(extra: object, over: Partial<ExportContext> = own) {
    const { items, dropped, skipped } = await parseExportFile([{ timestamp: at, ...extra }], over);
    expect(skipped).toBe(0);
    return { item: items[0], why: dropped[0]?.why };
  }

  it("calls the person's words, and their photo alone, their own", async () => {
    expect((await one(words("Mín orð"))).item?.class).toBe("own");
    expect((await one(attached(photo))).item).toMatchObject({
      class: "own",
      images: [photo.media.uri],
    });
    expect((await one({ ...words("Lesið þetta"), ...linked })).item?.class).toBe("own");
  });

  it("calls a link with nothing of the person's a link, even with the address as its text", async () => {
    expect((await one(linked)).item?.class).toBe("link");
    expect((await one({ ...words(link), ...linked })).item?.class).toBe("link");
    expect((await one(words(link))).item?.class).toBe("link");
    expect((await one({ ...linked, ...attached(photo) })).item?.class).toBe("own");
  });

  it("leaves another person's image out, and still brings the words written on it", async () => {
    const { item } = await one(
      { ...words("Mín orð"), ...attached(photo) },
      { ownMedia: new Set() },
    );
    expect(item).toMatchObject({ class: "own", images: [], foreignImages: 1 });
  });

  it("drops another person's image with no words of the person's on it", async () => {
    const { item, why } = await one(attached(photo), { ownMedia: new Set() });
    expect(item).toBeUndefined();
    expect(why).toBe("foreignOnly");
  });

  it("drops a video with no words, and tells it from a post with nothing at all", async () => {
    expect((await one(attached(clip))).why).toBe("videoOnly");
    expect((await one({ data: [] })).why).toBe("empty");
    expect((await one({ ...words("Orð"), ...attached(clip) })).item).toMatchObject({
      class: "own",
      hasVideo: true,
    });
  });

  it("calls what stands on someone else's timeline that, by its exact time", async () => {
    const over = { ...own, otherTimelines: new Set([at]) };
    expect((await one(words("Til hamingju"), over)).item?.class).toBe("other_timeline");
    const later = await parseExportFile([{ timestamp: at + 1, ...words("Annað") }], over);
    expect(later.items[0]?.class).toBe("own");
  });

  it("calls an archived text hidden when its date is near, and only then", async () => {
    const over = { ...own, archived: new Map([["Falið", [at + 3600]]]) };
    expect((await one(words("Falið"), over)).item?.class).toBe("hidden");
    const far = { ...own, archived: new Map([["Falið", [at + 3 * 24 * 3600]]]) };
    expect((await one(words("Falið"), far)).item?.class).toBe("own");
    expect((await one(words("Annað"), over)).item?.class).toBe("own");
  });

  it("brings the words written on the person's own image, once", async () => {
    const captioned = { media: { ...photo.media, description: escaped("Við vatnið") } };
    const { item } = await one(attached(captioned));
    expect(item).toMatchObject({ class: "own", body: "Við vatnið" });
    const both = await one({ ...words("Við vatnið í gær"), ...attached(captioned) });
    expect(both.item?.body).toBe("Við vatnið í gær");
    const added = await one({ ...words("Í gær"), ...attached(captioned) });
    expect(added.item?.body).toBe("Í gær\n\nVið vatnið");
  });

  it("keeps a post's whole text however long", async () => {
    const long = "a".repeat(49_143);
    expect((await one(words(long))).item?.body).toHaveLength(49_143);
  });
});

describe("what the rest of the export says", () => {
  const POSTS = "x/posts/your_posts_1.json";
  const files: Record<string, unknown> = {
    "x/posts/album/0.json": { photos: [{ uri: "x/posts/media/a.jpg" }] },
    "x/posts/your_uncategorized_photos.json": {
      other_photos_v2: [{ media: { uri: "./x/posts/media/b.jpg" } }],
    },
    "x/posts/your_videos.json": { videos_v2: [{ uri: "x/posts/media/c.mp4" }] },
    "x/posts/posts_on_other_pages_and_profiles.json": { wall: [{ timestamp: 11 }, { title: "x" }] },
    "x/posts/archive.json": {
      archive_v2: [{ timestamp: 22, label_values: [{ value: escaped("Falið") }, { value: " " }] }],
    },
    "elsewhere/album/1.json": { photos: [{ uri: "elsewhere/a.jpg" }] },
    "x/other/archive.json": [{ timestamp: 33, label_values: [{ value: "Annað" }] }],
  };
  const read = async (names = Object.keys(files)) =>
    readContext([...names, POSTS], [POSTS], (name) => Promise.resolve(files[name]));

  it("reads whose media, which timelines and what was archived, beside the posts file only", async () => {
    const found = await read();
    expect([...found.ownMedia].sort()).toEqual([
      "x/posts/media/a.jpg",
      "x/posts/media/b.jpg",
      "x/posts/media/c.mp4",
    ]);
    expect([...found.otherTimelines]).toEqual([11]);
    expect([...found.archived]).toEqual([["Falið", [22]]]);
  });

  it("holds nobody's media to be the person's when the lists are not there", async () => {
    const found = await read([]);
    expect(found.ownMedia.size).toBe(0);
  });

  it("leaves out a list that could not be parsed", async () => {
    const found = await readContext(["x/posts/album/0.json", POSTS], [POSTS], () =>
      Promise.resolve(undefined),
    );
    expect(found.ownMedia.size).toBe(0);
  });
});
