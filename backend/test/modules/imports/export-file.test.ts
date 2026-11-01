import { describe, expect, it } from "vitest";
import { parseExportFile, repairText } from "../../../src/modules/imports/export-file.ts";

// The parser is pure. The bug each test names: Icelandic letters mangled by the
// export's byte escapes, correct text mangled by a repair that was not needed, one
// odd entry failing a whole file, and an id that changes between two reads.

/** How the export writes text: each UTF-8 byte as one Latin-1 code point. */
const escaped = (text: string) => String.fromCharCode(...new TextEncoder().encode(text));

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
    const { items, skipped } = await parseExportFile([
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
    ]);
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
    const { items, skipped } = await parseExportFile([
      { timestamp: at, attachments: [{ data: [{ media: { uri: "posts/media/a.avif" } }] }] },
    ]);
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
      { timestamp: at, data: [] },
      post(),
    ]);
    expect(items).toHaveLength(1);
    expect(skipped).toBe(6);
  });

  it("counts a file that is not a list as one skipped", async () => {
    expect(await parseExportFile({ posts: [] })).toEqual({ items: [], skipped: 1 });
  });
});
