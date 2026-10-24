import { describe, expect, it } from "vitest";
import vectors from "../../api/frames.vectors.json" with { type: "json" };
import {
  FRAME_SPECS,
  Framing,
  framesFor,
  LEGACY_FRAME,
  overrideRect,
  placeFrame,
  SIZE_CLASSES,
  type SizeClass,
  sizeClassOf,
} from "../src/api/image-frames.ts";

// The vectors are shared with the Rust core (decision 0086): the clients and
// the server place a frame by one rule, and this file is that rule's proof.

describe("size classes", () => {
  it("begin medium and expanded at the contract's widths, and the cover frames follow them", () => {
    const at: [number, SizeClass][] = [
      [0, "compact"],
      [SIZE_CLASSES.medium - 1, "compact"],
      [SIZE_CLASSES.medium, "medium"],
      [SIZE_CLASSES.expanded - 1, "medium"],
      [SIZE_CLASSES.expanded, "expanded"],
      [2560, "expanded"],
    ];
    for (const [width, sizeClass] of at) expect(sizeClassOf(width), `${width}`).toBe(sizeClass);
    expect(Object.keys(FRAME_SPECS.cover).sort()).toEqual(["compact", "expanded", "medium"]);
  });
});

describe("frame specifications", () => {
  it("are the sizes of decision 0086", () => {
    expect(FRAME_SPECS).toEqual({
      cover: {
        compact: { w: 1200, h: 400 },
        medium: { w: 1600, h: 400 },
        expanded: { w: 1600, h: 600 },
      },
      photo: { square: { w: 512, h: 512 } },
    });
    expect(LEGACY_FRAME).toEqual({ cover: "expanded", photo: "square" });
  });
});

describe("placeFrame vectors", () => {
  it("has the cases the Rust core also runs", () => {
    expect(vectors.place.length).toBeGreaterThanOrEqual(12);
    expect(vectors.override.length).toBeGreaterThanOrEqual(3);
  });
  for (const v of vectors.place) {
    it(v.name, () => {
      expect(placeFrame(v.imageW, v.imageH, v.aspectW, v.aspectH, v.focus)).toEqual(v.expected);
    });
  }
  for (const v of vectors.override) {
    it(v.name, () => {
      expect(overrideRect(v.imageW, v.imageH, v.rect)).toEqual(v.expected);
    });
  }
});

describe("framesFor", () => {
  it("places every frame of a cover from the focus", () => {
    const frames = framesFor("cover", 2400, 1600, { focus: { x: 0.5, y: 0.5 } });
    expect(Object.keys(frames)).toEqual(["compact", "medium", "expanded"]);
    expect(frames.expanded).toEqual({ x: 0, y: 350, w: 2400, h: 900 });
    expect(frames.medium).toEqual({ x: 0, y: 500, w: 2400, h: 600 });
  });

  it("lets an override win for its frame only", () => {
    const framing = {
      focus: { x: 0.5, y: 0.5 },
      overrides: { compact: { x: 0.1, y: 0.2, w: 0.5, h: 0.25 } },
    };
    const frames = framesFor("cover", 2400, 1600, framing);
    expect(frames.compact).toEqual({ x: 240, y: 320, w: 1200, h: 400 });
    expect(frames.medium).toEqual({ x: 0, y: 500, w: 2400, h: 600 });
  });

  it("ignores an override naming a frame the kind lacks", () => {
    const frames = framesFor("photo", 1000, 500, {
      focus: { x: 0, y: 0 },
      overrides: { compact: { x: 0, y: 0, w: 0.1, h: 0.1 } } as never,
    });
    expect(frames).toEqual({ square: { x: 0, y: 0, w: 500, h: 500 } });
  });
});

describe("Framing", () => {
  it("accepts a focus inside the image", () => {
    expect(Framing.safeParse({ focus: { x: 0, y: 1 } }).success).toBe(true);
  });
  it.each([
    ["a focus outside [0, 1]", { focus: { x: 1.1, y: 0 } }],
    [
      "a rect crossing the right edge",
      { focus: { x: 0, y: 0 }, overrides: { compact: { x: 0.6, y: 0, w: 0.5, h: 0.5 } } },
    ],
    [
      "a rect crossing the bottom edge",
      { focus: { x: 0, y: 0 }, overrides: { compact: { x: 0, y: 0.6, w: 0.5, h: 0.5 } } },
    ],
    [
      "an empty rect",
      { focus: { x: 0, y: 0 }, overrides: { compact: { x: 0, y: 0, w: 0, h: 0.5 } } },
    ],
    [
      "an unknown frame",
      { focus: { x: 0, y: 0 }, overrides: { huge: { x: 0, y: 0, w: 0.5, h: 0.5 } } },
    ],
  ])("refuses %s", (_name, body) => {
    expect(Framing.safeParse(body).success).toBe(false);
  });
});
