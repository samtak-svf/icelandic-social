import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { type Framing, framesFor } from "../../src/api/image-frames.ts";
import { MASTER_EDGE, renderFrames, storeImage } from "../../src/shared/images.ts";
import { png } from "../images.ts";

// Where each frame is cut from (decision 0086). LOCAL LIMITATION, measured
// 2026-10-24: workerd's Images binding under miniflare IGNORES both `trim` and
// `gravity` (no error, the image comes back uncropped), so a test through the
// real binding cannot tell one focus from another. Do not "simplify" this file
// into one that does: it would pass whatever the Worker asks of Images. The
// binding below records every trim it is asked for, and answers it with bytes
// that name the rectangle, so the rectangle (the main assertion) and the bytes
// that follow from it are both meaningful. Real-Cloudflare trim is verified
// after deploy. Everything else is tested through the real binding in
// image-frames-routes.test.ts.

type Cut = { left: number; top: number; width: number; height: number; w: number; h: number };

/** An Images binding that records each trim and answers it with bytes naming the cut. */
function trimRecorder(real: ImagesBinding) {
  const cuts: Cut[] = [];
  const binding = {
    info: (stream: ReadableStream<Uint8Array>) => real.info(stream),
    input(stream: ReadableStream<Uint8Array>) {
      let asked: ImageTransform = {};
      const chain = {
        transform(next: ImageTransform) {
          asked = { ...asked, ...next };
          return chain;
        },
        async output(options: ImageOutputOptions) {
          const { trim } = asked;
          if (!trim || typeof trim === "string")
            return real.input(stream).transform(asked).output(options);
          const cut = {
            left: trim.left!,
            top: trim.top!,
            width: trim.width!,
            height: trim.height!,
            w: asked.width!,
            h: asked.height!,
          };
          cuts.push(cut);
          const text = `CUT ${JSON.stringify(cut)}`;
          return { response: () => new Response(text), image: () => new Blob([text]).stream() };
        },
      };
      return chain;
    },
  };
  return { cuts, env: { ...env, IMAGES: binding as unknown as ImagesBinding } as Env };
}

const upload = async (width: number, height: number) => {
  const bytes = await png(width, height);
  return { body: new Blob([bytes]).stream(), size: bytes.length };
};

const text = async (key: string) => await (await env.PROFILES.get(key))!.text();
const rect = (cut: Cut) => ({ x: cut.left, y: cut.top, w: cut.width, h: cut.height });

describe("frames are cut from the master by trim", () => {
  it("cuts each frame of an upload from the centre", async () => {
    const { cuts, env: recording } = trimRecorder(env.IMAGES);
    const { body, size } = await upload(800, 600);
    const stored = await storeImage(recording, "frames-cut/centre", "cover", body, size);
    expect(stored).not.toBe("invalid_image");
    const expected = framesFor("cover", 800, 600, { focus: { x: 0.5, y: 0.5 } });
    expect(cuts.map(rect)).toEqual([expected.compact, expected.medium, expected.expanded]);
    // Each is resized to its frame.
    expect(cuts.map((c) => [c.w, c.h])).toEqual([
      [1200, 400],
      [1600, 400],
      [1600, 600],
    ]);
    // The master was not cut: it is the real binding's re-encode.
    expect((await env.PROFILES.head("frames-cut/centre/master"))!.size).toBeGreaterThan(0);
  });

  it("cuts again from the master at another focus, and the frames differ", async () => {
    const { cuts, env: recording } = trimRecorder(env.IMAGES);
    const { body, size } = await upload(800, 600);
    await storeImage(recording, "frames-cut/focus", "cover", body, size);
    const centred = await text("frames-cut/focus/compact");
    cuts.length = 0;

    const top: Framing = { focus: { x: 0.5, y: 0 } };
    const bottom: Framing = { focus: { x: 0.5, y: 1 } };
    for (const [framing, label] of [
      [top, "top"],
      [bottom, "bottom"],
    ] as const) {
      cuts.length = 0;
      const rendered = await renderFrames(recording, "frames-cut/focus", "cover", framing);
      expect(rendered).toMatchObject({ version: expect.stringMatching(/^ph_/) });
      const expected = framesFor("cover", 800, 600, framing);
      expect(cuts.map(rect), label).toEqual([expected.compact, expected.medium, expected.expanded]);
    }
    const atTop = await renderFrames(recording, "frames-cut/focus", "cover", top);
    const topCompact = await text("frames-cut/focus/compact");
    await renderFrames(recording, "frames-cut/focus", "cover", bottom);
    const bottomCompact = await text("frames-cut/focus/compact");
    expect(atTop).not.toBe("no_master");
    expect(topCompact).not.toBe(bottomCompact);
    expect(topCompact).not.toBe(centred);
    // The legacy frame is stored at the key itself.
    expect(await text("frames-cut/focus")).toContain("CUT");
  });

  it("lets an override win for its frame and leaves the others on the focus", async () => {
    const { cuts, env: recording } = trimRecorder(env.IMAGES);
    const { body, size } = await upload(800, 600);
    await storeImage(recording, "frames-cut/override", "cover", body, size);
    cuts.length = 0;
    const framing: Framing = {
      focus: { x: 0, y: 0 },
      overrides: { medium: { x: 0.25, y: 0.5, w: 0.5, h: 0.125 } },
    };
    await renderFrames(recording, "frames-cut/override", "cover", framing);
    const placed = framesFor("cover", 800, 600, { focus: framing.focus });
    expect(cuts.map(rect)).toEqual([
      placed.compact,
      { x: 200, y: 300, w: 400, h: 75 },
      placed.expanded,
    ]);
    expect(rect(cuts[1]!)).toEqual({ x: 200, y: 300, w: 400, h: 75 });
  });

  it("cuts a square for a photo, and caps the master it cuts from", async () => {
    const { cuts, env: recording } = trimRecorder(env.IMAGES);
    const { body, size } = await upload(3000, 1000);
    await storeImage(recording, "frames-cut/photo", "photo", body, size);
    const info = await env.IMAGES.info((await env.PROFILES.get("frames-cut/photo/master"))!.body);
    expect(info).toMatchObject({ width: MASTER_EDGE, height: 800 });
    // The rectangle is in the master's pixels, not the upload's.
    expect(cuts.map(rect)).toEqual([{ x: 800, y: 0, w: 800, h: 800 }]);
  });

  it("answers no_master when there is none to cut from", async () => {
    const { cuts, env: recording } = trimRecorder(env.IMAGES);
    expect(
      await renderFrames(recording, "frames-cut/none", "cover", { focus: { x: 0, y: 0 } }),
    ).toBe("no_master");
    expect(cuts).toEqual([]);
  });
});

describe("the recorder is honest", () => {
  it("is what the real binding is not: it tells two trims apart", async () => {
    // The measurement behind the note at the top of the file.
    const bytes = await png(400, 200);
    const cut = async (left: number) =>
      new Uint8Array(
        await (
          await env.IMAGES.input(new Blob([bytes]).stream())
            .transform({ trim: { left, top: 0, width: 100, height: 100 } })
            .output({ format: "image/webp" })
        )
          .response()
          .arrayBuffer(),
      ).join(",");
    expect(await cut(0)).toBe(await cut(300));
  });
});
