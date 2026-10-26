import type { Context } from "hono";
import type { AppEnv } from "../http.ts";
import { base64url } from "./bytes.ts";
import { images, profilesBucket, withinLimit } from "../env/index.ts";
import {
  CENTRE,
  FRAME_SPECS,
  framesFor,
  LEGACY_FRAME,
  type FrameKind,
  type Framing,
  type PixelRect,
} from "../api/image-frames.ts";
import { log } from "./log.ts";

// One path for every picture the Worker keeps in spjall-profiles: an account's
// photo (decision 0039) and a community's picture and cover (decision 0080).
// Every upload is re-encoded through Cloudflare Images to a master WebP
// without metadata (long edge at most 2400 px) and cut into the frames of its
// kind (decision 0086); only those are kept, under a key the caller names. The
// version token it returns changes with every upload and every re-framing, so
// a changed picture is a new URL. A log line carries a code, never the image or its version (0008).

/** The longest edge of the master an upload is re-encoded to (decision 0086). */
export const MASTER_EDGE = 2400;

/** The R2 key of a community's picture (decision 0080). */
export const communityPictureKey = (communityId: string) => `community/${communityId}/photo`;
/** The R2 key of a community's cover (decision 0080). */
export const communityCoverKey = (communityId: string) => `community/${communityId}/cover`;

/** The R2 key of the master kept beside the image at `key` (decision 0086). */
const masterKey = (key: string) => `${key}/master`;

/**
 * The R2 key of one frame of the image at `key`: the frame an app from before
 * decision 0086 knows stays at `key` itself, the others sit under it.
 */
function frameKey(key: string, kind: FrameKind, frame: string): string {
  return frame === LEGACY_FRAME[kind] ? key : `${key}/${frame}`;
}

/** Every key an image of `kind` at `key` occupies: the master and each frame. */
function keysOf(key: string, kind: FrameKind): string[] {
  const frames = Object.keys(FRAME_SPECS[kind]).map((frame) => frameKey(key, kind, frame));
  return [masterKey(key), ...frames];
}

/** The upload formats taken; anything else, SVG above all, is refused. */
const TAKEN = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);

const WEBP = { httpMetadata: { contentType: "image/webp" } };

/** A fresh version token: a changed picture is a new URL. */
const newVersion = () => `ph_${base64url(crypto.getRandomValues(new Uint8Array(16)))}`;

/** Logs a refusal as a code, never the image (0008). */
function refused(error: unknown): "invalid_image" {
  const code = (error as { code?: unknown } | null)?.code;
  log("photo.refused", { code: typeof code === "number" ? `images_${code}` : "images" });
  return "invalid_image";
}

/**
 * Re-encodes an upload of `size` bytes to the master: a WebP without metadata,
 * its long edge at most MASTER_EDGE. Throws when the body is not `size` bytes
 * long; "invalid_image" when it is not a raster format Images decodes (an SVG
 * is refused, not rasterised) or cannot be.
 */
async function reencode(
  env: Env,
  body: ReadableStream<Uint8Array>,
  size: number,
): Promise<ArrayBuffer | "invalid_image"> {
  const { readable, writable } = new FixedLengthStream(size);
  const [piped, read] = await Promise.allSettled([
    body.pipeTo(writable),
    new Response(readable).arrayBuffer(),
  ]);
  if (piped.status === "rejected") throw piped.reason;
  if (read.status === "rejected") throw read.reason;
  const bytes = read.value;
  try {
    const info = await images(env).info(new Blob([bytes]).stream());
    if (!TAKEN.has(info.format)) throw new Error("format");
    const encoded = await images(env)
      .input(new Blob([bytes]).stream())
      .transform({ width: MASTER_EDGE, height: MASTER_EDGE, fit: "scale-down" })
      .output({ format: "image/webp" });
    return await encoded.response().arrayBuffer();
  } catch (error) {
    return refused(error);
  }
}

/**
 * Cuts each frame of `kind` out of `master` by the rectangles `framing` gives
 * and resizes it to the frame's size (decision 0086): Images `trim`, then a
 * resize. Returns the WebP of each frame by name.
 */
async function cutFrames(
  env: Env,
  master: ArrayBuffer,
  kind: FrameKind,
  framing: Framing,
): Promise<Record<string, ArrayBuffer> | "invalid_image"> {
  try {
    const info = await images(env).info(new Blob([master]).stream());
    if (!("width" in info)) throw new Error("format");
    const rects = framesFor(kind, info.width, info.height, framing) as Record<string, PixelRect>;
    const out: Record<string, ArrayBuffer> = {};
    for (const [name, rect] of Object.entries(rects)) {
      const { w, h } = (FRAME_SPECS[kind] as Record<string, { w: number; h: number }>)[name]!;
      const encoded = await images(env)
        .input(new Blob([master]).stream())
        .transform({
          trim: { left: rect.x, top: rect.y, width: rect.w, height: rect.h },
          width: w,
          height: h,
          fit: "cover",
        })
        .output({ format: "image/webp" });
      out[name] = await encoded.response().arrayBuffer();
    }
    return out;
  } catch (error) {
    return refused(error);
  }
}

/** Puts every frame at its key; returns the bytes written to the legacy frame. */
async function putFrames(
  env: Env,
  key: string,
  kind: FrameKind,
  frames: Record<string, ArrayBuffer>,
): Promise<number> {
  await Promise.all(
    Object.entries(frames).map(([name, bytes]) =>
      profilesBucket(env).put(frameKey(key, kind, name), bytes, WEBP),
    ),
  );
  return frames[LEGACY_FRAME[kind]]!.byteLength;
}

/**
 * Re-encodes the upload to a master, cuts the frames from its centre, puts the
 * master at `<key>/master` and the frames at their keys, replacing any image
 * there, and gives the image a new version. The objects come first: the caller
 * writes the version after, so no version names an image that is not there
 * yet. `size` is the legacy frame's size in bytes.
 */
export async function storeImage(
  env: Env,
  key: string,
  kind: FrameKind,
  body: ReadableStream<Uint8Array>,
  size: number,
): Promise<{ version: string; size: number; framing: Framing } | "invalid_image"> {
  const master = await reencode(env, body, size);
  if (master === "invalid_image") return master;
  const frames = await cutFrames(env, master, kind, CENTRE);
  if (frames === "invalid_image") return frames;
  await profilesBucket(env).put(masterKey(key), master, WEBP);
  const stored = await putFrames(env, key, kind, frames);
  return { version: newVersion(), size: stored, framing: CENTRE };
}

/**
 * Cuts the frames of the image at `key` again from its master by `framing`
 * (decision 0086), with a new version. "no_master" when the image was stored
 * before the master was kept, or is not there; "invalid_image" when Images
 * cannot cut it.
 */
export async function renderFrames(
  env: Env,
  key: string,
  kind: FrameKind,
  framing: Framing,
): Promise<{ version: string; size: number } | "no_master" | "invalid_image"> {
  const master = await profilesBucket(env).get(masterKey(key));
  if (!master) return "no_master";
  const frames = await cutFrames(env, await master.arrayBuffer(), kind, framing);
  if (frames === "invalid_image") return frames;
  const size = await putFrames(env, key, kind, frames);
  return { version: newVersion(), size };
}

/** The master of the image at `key`, if it has one. */
export async function getMaster(env: Env, key: string): Promise<R2ObjectBody | null> {
  return profilesBucket(env).get(masterKey(key));
}

/**
 * The frame of the image at `key` that `frame` names; an image stored before
 * decision 0086 has only the object at `key`, which serves every frame.
 */
export async function getFrame(
  env: Env,
  key: string,
  kind: FrameKind,
  frame: string | undefined,
): Promise<R2ObjectBody | null> {
  const wanted = frame ?? LEGACY_FRAME[kind];
  const found = await profilesBucket(env).get(frameKey(key, kind, wanted));
  return found ?? (wanted === LEGACY_FRAME[kind] ? null : profilesBucket(env).get(key));
}

/** Deletes the image at `key` of `kind`: its master and every frame, if any. */
export async function deleteImage(env: Env, key: string, kind: FrameKind): Promise<void> {
  await profilesBucket(env).delete(keysOf(key, kind));
}

/** The headers every stored image is served with. */
export function imageHeaders(object: R2ObjectBody): Record<string, string> {
  return {
    "content-type": "image/webp",
    "content-length": String(object.size),
    "cache-control": "private, max-age=3600",
  };
}

/** Why an upload is refused before it is read: the status and the error code. */
export type UploadRefusal =
  | { status: 429; error: "rate_limited" }
  | { status: 400; error: "invalid_request" }
  | { status: 413; error: "too_large" };

/**
 * The checks every image upload passes before a byte is decoded: the photo
 * rate limit, a Content-Length, and the size. A refusal cancels the body, so
 * the client stops sending it.
 */
export async function takeUpload(
  c: Context<AppEnv>,
  accountId: string,
  max: number,
): Promise<{ body: ReadableStream<Uint8Array>; length: number } | UploadRefusal> {
  const body = c.req.raw.body;
  const refuse = async (refusal: UploadRefusal) => (await body?.cancel(), refusal);
  if (!(await withinLimit(c.env, "photos", accountId))) {
    log("request.rate_limited", { code: "photos", requestId: c.var.requestId });
    return refuse({ status: 429, error: "rate_limited" });
  }
  const length = Number(c.req.header("content-length") ?? Number.NaN);
  if (!Number.isSafeInteger(length) || length < 1 || !body) {
    return refuse({ status: 400, error: "invalid_request" });
  }
  if (length > max) return refuse({ status: 413, error: "too_large" });
  return { body, length };
}
