// @web-omit-start
import { z } from "@hono/zod-openapi";
// @web-omit-end

// Per-screen image framing (decision 0086). Pure: no Worker imports, so the
// same module runs in tests, tooling and the contract. The placing rule below
// is also implemented by the Rust core, and both run api/frames.vectors.json.

/**
 * The window size classes (decisions 0086, 0087): a window is compact below
 * `medium`, medium from `medium` to below `expanded`, and expanded from
 * `expanded`, in dp, pt or CSS px. They pick a cover's frame and a screen's
 * layout on every client, and this is their one definition: the contract
 * carries it as `x-size-classes`, and `tooling/frames-check.mjs` holds the
 * clients to it.
 */
export const SIZE_CLASSES = { medium: 600, expanded: 840 } as const;

export type SizeClass = "compact" | "medium" | "expanded";

/** The size class of a window `width` wide (dp, pt or CSS px). */
export function sizeClassOf(width: number): SizeClass {
  if (width < SIZE_CLASSES.medium) return "compact";
  if (width < SIZE_CLASSES.expanded) return "medium";
  return "expanded";
}

/** A frame's stored size in pixels. */
export type FrameSize = { w: number; h: number };

/**
 * The frames of each image kind and the size each is stored at. `photo` is an
 * account's photo and a community's picture, `cover` a community's cover. The
 * frames of a cover follow the window size classes (`SIZE_CLASSES`).
 */
export const FRAME_SPECS = {
  cover: {
    compact: { w: 1200, h: 400 },
    medium: { w: 1600, h: 400 },
    expanded: { w: 1600, h: 600 },
  },
  photo: { square: { w: 512, h: 512 } },
} as const satisfies Record<string, Record<string, FrameSize>>;

export type FrameKind = keyof typeof FRAME_SPECS;
export type FrameName<K extends FrameKind = FrameKind> = keyof (typeof FRAME_SPECS)[K] & string;

/** The frame an app from before decision 0086 knows: served from the key it was always served from. */
export const LEGACY_FRAME = { cover: "expanded", photo: "square" } as const satisfies {
  [K in FrameKind]: FrameName<K>;
};

/** The names of every frame of every kind, for the schema of an override. */
const ALL_FRAMES = ["compact", "medium", "expanded", "square"] as const;
export type AnyFrame = (typeof ALL_FRAMES)[number];

/** The frame names of one kind, for a query parameter's enum. */
export const FRAME_NAMES = {
  cover: ["compact", "medium", "expanded"],
  photo: ["square"],
} as const satisfies Record<FrameKind, readonly AnyFrame[]>;

// @web-omit-start
/** The point of the image the person wants kept in view, as fractions of its width and height. */
const Focus = z
  .object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })
  .openapi("Focus");

/** The smallest side of an override, as a fraction of the image (an exclusive bound would not reach the web client generator). */
const MIN_SIDE = 0.001;

/** A rectangle of the image as fractions of its width and height, inside it. */
const Rect = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    w: z.number().min(MIN_SIDE).max(1),
    h: z.number().min(MIN_SIDE).max(1),
  })
  .refine((r) => r.x + r.w <= 1 && r.y + r.h <= 1, "the rectangle leaves the image")
  .openapi("FrameRect");

/** The framing of an image: a focus every frame is placed from, and a rectangle for any frame the person adjusted. */
export const Framing = z
  .object({
    focus: Focus,
    overrides: z
      .partialRecord(z.enum(ALL_FRAMES), Rect)
      .optional()
      .openapi({ description: "A rectangle for each frame set by hand; it wins over the focus" }),
  })
  .openapi("Framing");
export type Framing = z.infer<typeof Framing>;
// @web-omit-end

/** A pixel rectangle of an image. */
export type PixelRect = { x: number; y: number; w: number; h: number };

/** The centred framing every upload starts with. */
export const CENTRE: Framing = { focus: { x: 0.5, y: 0.5 } };

/** Round half up, which for the non-negative values here is also `f64::round`. */
const round = (value: number) => Math.floor(value + 0.5);

/**
 * The largest rectangle of aspect `aspectW`:`aspectH` that fits the image,
 * centred on `focus` and moved inside the image where it would cross an edge.
 * Rounding: w and h are rounded, x and y floored, then x is clamped to
 * `imageW - w` and y to `imageH - h`.
 */
export function placeFrame(
  imageW: number,
  imageH: number,
  aspectW: number,
  aspectH: number,
  focus: { x: number; y: number },
): PixelRect {
  const wide = imageW * aspectH >= imageH * aspectW;
  const exactW = wide ? (imageH * aspectW) / aspectH : imageW;
  const exactH = wide ? imageH : (imageW * aspectH) / aspectW;
  const w = Math.min(imageW, Math.max(1, round(exactW)));
  const h = Math.min(imageH, Math.max(1, round(exactH)));
  const x = Math.min(imageW - w, Math.max(0, Math.floor(focus.x * imageW - exactW / 2)));
  const y = Math.min(imageH - h, Math.max(0, Math.floor(focus.y * imageH - exactH / 2)));
  return { x, y, w, h };
}

/**
 * A rectangle of fractions as pixels: x and y floored, w and h rounded (at
 * least 1), then moved inside the image as `placeFrame` does.
 */
export function overrideRect(imageW: number, imageH: number, rect: PixelRect): PixelRect {
  const w = Math.min(imageW, Math.max(1, round(rect.w * imageW)));
  const h = Math.min(imageH, Math.max(1, round(rect.h * imageH)));
  const x = Math.min(imageW - w, Math.max(0, Math.floor(rect.x * imageW)));
  const y = Math.min(imageH - h, Math.max(0, Math.floor(rect.y * imageH)));
  return { x, y, w, h };
}

/** The pixel rectangle of each frame of `kind`; a frame with an override takes it, the others are placed from the focus. */
export function framesFor<K extends FrameKind>(
  kind: K,
  imageW: number,
  imageH: number,
  framing: Framing,
): Record<FrameName<K>, PixelRect> {
  const out: Record<string, PixelRect> = {};
  for (const [name, size] of Object.entries(FRAME_SPECS[kind] as Record<string, FrameSize>)) {
    const override = framing.overrides?.[name as AnyFrame];
    out[name] = override
      ? overrideRect(imageW, imageH, override)
      : placeFrame(imageW, imageH, size.w, size.h, framing.focus);
  }
  return out as Record<FrameName<K>, PixelRect>;
}

// @web-omit-start
/** The framing stored as JSON beside an image's version, or null when there is none or it does not parse. */
export function parseFraming(stored: string | null): Framing | null {
  if (stored === null) return null;
  try {
    const parsed = Framing.safeParse(JSON.parse(stored));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// @web-omit-end

/** Whether every override of `framing` names a frame `kind` has. */
export function framingFits(kind: FrameKind, framing: Framing): boolean {
  return Object.keys(framing.overrides ?? {}).every((name) => name in FRAME_SPECS[kind]);
}
