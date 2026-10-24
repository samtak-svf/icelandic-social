import type { FrameRect } from "../generated/api.ts";
import { placeFrame, type AnyFrame, type Framing } from "../generated/frames.ts";

// The crop editor's maths (decision 0086). A gesture moves a rectangle of the
// image, held as fractions of its width and height, never leaving the image and
// never changing its shape. The placing rule itself is the backend's, generated
// into ../generated/frames.ts; this file only moves what that rule placed.

export type { FrameRect };

/** The size of the master in pixels. */
export type ImageSize = { w: number; h: number };

/** A frame's shape; only the ratio matters. */
export type Aspect = { aspectW: number; aspectH: number };

/** A point of the viewport as fractions of its width and height. */
export type Anchor = { u: number; v: number };

/** How far past the whole frame a person may zoom in. */
export const MAX_ZOOM = 8;

/** What a key press zooms by, and how far an arrow moves, as a share of the rectangle. */
const KEY_ZOOM = 1.25;
const KEY_STEP = 0.05;

/** The largest rectangle of `aspect` the image holds, as fractions. */
function largest(image: ImageSize, aspect: Aspect): FrameRect {
  const px = placeFrame(image.w, image.h, aspect.aspectW, aspect.aspectH, { x: 0.5, y: 0.5 });
  return { x: px.x / image.w, y: px.y / image.h, w: px.w / image.w, h: px.h / image.h };
}

/** A rectangle moved inside the image; the sum of an edge never passes 1, which the contract refuses. */
function settle(x: number, y: number, w: number, h: number): FrameRect {
  let left = Math.min(Math.max(0, x), 1 - w);
  let top = Math.min(Math.max(0, y), 1 - h);
  while (left + w > 1) left -= Number.EPSILON;
  while (top + h > 1) top -= Number.EPSILON;
  return { x: Math.max(0, left), y: Math.max(0, top), w, h };
}

/** The rectangle to start from: the one stored for this frame, else the one the focus places. */
export function startRect(
  image: ImageSize,
  aspect: Aspect,
  focus: { x: number; y: number },
  stored: FrameRect | null,
): FrameRect {
  if (stored !== null) return stored;
  const px = placeFrame(image.w, image.h, aspect.aspectW, aspect.aspectH, focus);
  return { x: px.x / image.w, y: px.y / image.h, w: px.w / image.w, h: px.h / image.h };
}

/** How far in `rect` is, against the whole-frame rectangle `whole` (1 is the whole frame). */
export function zoomOf(rect: FrameRect, whole: FrameRect): number {
  return whole.w / rect.w;
}

/** The image moves with the finger: the window moves against it, by the share of the viewport dragged. */
export function dragRect(
  rect: FrameRect,
  dx: number,
  dy: number,
  viewport: { w: number; h: number },
): FrameRect {
  return settle(
    rect.x - (dx / viewport.w) * rect.w,
    rect.y - (dy / viewport.h) * rect.h,
    rect.w,
    rect.h,
  );
}

/** Zooms by `factor` (above 1 is in) keeping the image point under `anchor` where it is. */
export function zoomRect(
  rect: FrameRect,
  image: ImageSize,
  aspect: Aspect,
  factor: number,
  anchor: Anchor,
): FrameRect {
  const whole = largest(image, aspect);
  const w = Math.min(whole.w, Math.max(whole.w / MAX_ZOOM, rect.w / factor));
  const h = (w * image.w * aspect.aspectH) / (aspect.aspectW * image.h);
  const pointX = rect.x + anchor.u * rect.w;
  const pointY = rect.y + anchor.v * rect.h;
  // At the whole-frame width the height may differ from the rounded one by a pixel's share.
  return settle(pointX - anchor.u * w, pointY - anchor.v * h, w, Math.min(h, 1));
}

/** What a key does to the rectangle, or null for a key the editor does not use. */
export function keyRect(
  rect: FrameRect,
  image: ImageSize,
  aspect: Aspect,
  key: string,
): FrameRect | null {
  const centre = { u: 0.5, v: 0.5 };
  switch (key) {
    case "+":
    case "=":
      return zoomRect(rect, image, aspect, KEY_ZOOM, centre);
    case "-":
    case "_":
      return zoomRect(rect, image, aspect, 1 / KEY_ZOOM, centre);
    case "ArrowLeft":
      return settle(rect.x - KEY_STEP * rect.w, rect.y, rect.w, rect.h);
    case "ArrowRight":
      return settle(rect.x + KEY_STEP * rect.w, rect.y, rect.w, rect.h);
    case "ArrowUp":
      return settle(rect.x, rect.y - KEY_STEP * rect.h, rect.w, rect.h);
    case "ArrowDown":
      return settle(rect.x, rect.y + KEY_STEP * rect.h, rect.w, rect.h);
    default:
      return null;
  }
}

/** The point a rectangle is centred on, which every frame without an override is placed from. */
export function focusOf(rect: FrameRect): { x: number; y: number } {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/**
 * The framing to send: the stored one with the rectangles the person adjusted
 * as overrides, and the centre of the one adjusted last as the focus. `reset`
 * drops every override and keeps the focus.
 */
export function framingOf(
  base: Framing | null,
  edits: Partial<Record<AnyFrame, FrameRect>>,
  last: AnyFrame | null,
  reset = false,
): Framing {
  const lastRect = last === null ? undefined : edits[last];
  return {
    focus: lastRect === undefined ? (base?.focus ?? { x: 0.5, y: 0.5 }) : focusOf(lastRect),
    overrides: reset ? {} : { ...base?.overrides, ...edits },
  };
}
