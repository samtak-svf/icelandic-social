import { describe, expect, it } from "vitest";
import {
  dragRect,
  focusOf,
  framingOf,
  keyRect,
  startRect,
  zoomOf,
  zoomRect,
  type FrameRect,
} from "./frame-math.ts";

// The editor's maths (decision 0086): a gesture moves a rectangle of the image,
// in fractions, and the rectangle never leaves the image or changes its shape.

const WIDE = { w: 4000, h: 3000 };
const SQUARE = { aspectW: 1, aspectH: 1 };
const COVER = { aspectW: 8, aspectH: 3 };

/** The pixel aspect of a rectangle of fractions. */
const shape = (r: FrameRect, image: { w: number; h: number }) => (r.w * image.w) / (r.h * image.h);
const inside = (r: FrameRect) =>
  r.x >= 0 && r.y >= 0 && r.x + r.w <= 1 && r.y + r.h <= 1 && r.w > 0 && r.h > 0;

describe("startRect", () => {
  it("places a square at the centre of a landscape image when nothing is stored", () => {
    const r = startRect(WIDE, SQUARE, { x: 0.5, y: 0.5 }, null);
    expect(r.h).toBeCloseTo(1, 3);
    expect(r.w).toBeCloseTo(0.75, 3);
    expect(r.x).toBeCloseTo(0.125, 3);
  });

  it("is placed from the focus, moved inside at an edge", () => {
    const r = startRect(WIDE, SQUARE, { x: 0, y: 0.5 }, null);
    expect(r.x).toBe(0);
  });

  it("starts from a stored override instead of the focus", () => {
    const stored = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 };
    expect(startRect(WIDE, COVER, { x: 0.5, y: 0.5 }, stored)).toEqual(stored);
  });
});

describe("dragRect", () => {
  const start = startRect(WIDE, COVER, { x: 0.5, y: 0.5 }, null);

  it("moves the window against the finger by the share of the viewport dragged", () => {
    const zoomed = zoomRect(start, WIDE, COVER, 2, { u: 0.5, v: 0.5 });
    const moved = dragRect(zoomed, 100, 0, { w: 400, h: 150 });
    expect(moved.x).toBeCloseTo(zoomed.x - 0.25 * zoomed.w, 6);
    expect(moved.y).toBeCloseTo(zoomed.y, 6);
  });

  it("stops at the edge of the image", () => {
    const moved = dragRect(start, -100000, 100000, { w: 400, h: 150 });
    expect(inside(moved)).toBe(true);
    expect(moved.x + moved.w).toBeCloseTo(1, 9);
    expect(moved.y).toBe(0);
  });
});

describe("zoomRect", () => {
  const start = startRect(WIDE, COVER, { x: 0.5, y: 0.5 }, null);

  it("keeps the shape and the point under the pointer", () => {
    const anchor = { u: 0.25, v: 0.75 };
    const before = { x: start.x + anchor.u * start.w, y: start.y + anchor.v * start.h };
    const zoomed = zoomRect(start, WIDE, COVER, 2, anchor);
    expect(shape(zoomed, WIDE)).toBeCloseTo(8 / 3, 6);
    expect(zoomed.w).toBeCloseTo(start.w / 2, 6);
    expect(zoomed.x + anchor.u * zoomed.w).toBeCloseTo(before.x, 6);
    expect(zoomed.y + anchor.v * zoomed.h).toBeCloseTo(before.y, 6);
  });

  it("never zooms out past the whole image or in past the limit", () => {
    const out = zoomRect(start, WIDE, COVER, 0.01, { u: 0.5, v: 0.5 });
    expect(out.w).toBeCloseTo(start.w, 9);
    const far = zoomRect(start, WIDE, COVER, 1000, { u: 0.5, v: 0.5 });
    expect(zoomOf(far, start)).toBeCloseTo(8, 6);
    expect(inside(far)).toBe(true);
  });

  it("stays inside the image when zooming out at an edge", () => {
    const corner = { x: 0.7, y: 0.5, w: start.w / 4, h: start.h / 4 };
    const out = zoomRect(corner, WIDE, COVER, 0.1, { u: 1, v: 0 });
    expect(inside(out)).toBe(true);
  });
});

describe("keyRect", () => {
  const start = startRect(WIDE, SQUARE, { x: 0.5, y: 0.5 }, null);

  it("moves with the arrows and zooms with plus and minus", () => {
    const zoomed = keyRect(start, WIDE, SQUARE, "+")!;
    expect(zoomed.w).toBeLessThan(start.w);
    const right = keyRect(zoomed, WIDE, SQUARE, "ArrowRight")!;
    expect(right.x).toBeGreaterThan(zoomed.x);
    const down = keyRect(zoomed, WIDE, SQUARE, "ArrowDown")!;
    expect(down.y).toBeGreaterThan(zoomed.y);
    expect(keyRect(zoomed, WIDE, SQUARE, "-")!.w).toBeGreaterThan(zoomed.w);
  });

  it("ignores other keys", () => {
    expect(keyRect(start, WIDE, SQUARE, "a")).toBeNull();
  });
});

describe("focus and framing", () => {
  it("the focus is the centre of the rectangle", () => {
    expect(focusOf({ x: 0.2, y: 0.1, w: 0.4, h: 0.2 })).toEqual({ x: 0.4, y: 0.2 });
  });

  it("the chosen rectangle becomes its frame's override and its centre the focus", () => {
    const rect = { x: 0.2, y: 0.1, w: 0.4, h: 0.2 };
    expect(framingOf(null, { compact: rect }, "compact")).toEqual({
      focus: { x: 0.4, y: 0.2 },
      overrides: { compact: rect },
    });
  });

  it("keeps the stored overrides of frames not touched, and a reset clears them", () => {
    const stored = {
      focus: { x: 0.5, y: 0.5 },
      overrides: { medium: { x: 0, y: 0, w: 1, h: 0.25 } },
    };
    const rect = { x: 0.2, y: 0.1, w: 0.4, h: 0.2 };
    expect(framingOf(stored, { expanded: rect }, "expanded").overrides).toEqual({
      medium: stored.overrides.medium,
      expanded: rect,
    });
    expect(framingOf(stored, {}, null, true)).toEqual({ focus: stored.focus, overrides: {} });
  });

  it("keeps the focus when nothing was touched", () => {
    expect(framingOf({ focus: { x: 0.3, y: 0.6 } }, {}, null).focus).toEqual({ x: 0.3, y: 0.6 });
  });

  it("a rectangle at the far edge still satisfies the contract's sum", () => {
    const r = zoomRect(startRect(WIDE, COVER, { x: 1, y: 1 }, null), WIDE, COVER, 3, {
      u: 0.9,
      v: 0.9,
    });
    expect(r.x + r.w).toBeLessThanOrEqual(1);
    expect(r.y + r.h).toBeLessThanOrEqual(1);
  });
});
