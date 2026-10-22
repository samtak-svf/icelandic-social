import type { Context } from "hono";
import type { AppEnv } from "./app.ts";
import { base64url } from "./bytes.ts";
import { images, profilesBucket, withinLimit } from "./env/index.ts";
import { log } from "./log.ts";

// One path for every picture the Worker keeps in spjall-profiles: an account's
// photo (decision 0039) and a community's picture and cover (decision 0080).
// Every upload is re-encoded through Cloudflare Images to one size of WebP
// without metadata, and only that is kept, under a key the caller names. The
// version token it returns changes with every upload, so a changed picture is
// a new URL. A log line carries a code, never the image or its version (0008).

/** The size an image is stored at; `fit: cover` crops what does not fit. */
export type ImageShape = { width: number; height: number };

/** An account's photo and a community's picture: a square this many pixels a side. */
export const SQUARE: ImageShape = { width: 512, height: 512 };
/** A community's cover (decision 0080). */
export const COVER: ImageShape = { width: 1600, height: 600 };

/** The R2 key of a community's picture (decision 0080). */
export const communityPictureKey = (communityId: string) => `community/${communityId}/photo`;
/** The R2 key of a community's cover (decision 0080). */
export const communityCoverKey = (communityId: string) => `community/${communityId}/cover`;

/** The upload formats taken; anything else, SVG above all, is refused. */
const TAKEN = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);

/**
 * Re-encodes an upload of `size` bytes to the stored WebP. Throws when the
 * body is not `size` bytes long; "invalid_image" when it is not a raster
 * format Images decodes (an SVG is refused, not rasterised) or cannot be.
 */
async function reencode(
  env: Env,
  body: ReadableStream<Uint8Array>,
  size: number,
  shape: ImageShape,
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
      .transform({ width: shape.width, height: shape.height, fit: "cover" })
      .output({ format: "image/webp" });
    return await encoded.response().arrayBuffer();
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    log("photo.refused", { code: typeof code === "number" ? `images_${code}` : "images" });
    return "invalid_image";
  }
}

/**
 * Re-encodes the upload and puts it at `key`, replacing any image there, and
 * gives it a new version. The object comes first: the caller writes the
 * version after, so no version names an image that is not there yet.
 */
export async function storeImage(
  env: Env,
  key: string,
  shape: ImageShape,
  body: ReadableStream<Uint8Array>,
  size: number,
): Promise<{ version: string; size: number } | "invalid_image"> {
  const webp = await reencode(env, body, size, shape);
  if (webp === "invalid_image") return webp;
  await profilesBucket(env).put(key, webp, { httpMetadata: { contentType: "image/webp" } });
  return {
    version: `ph_${base64url(crypto.getRandomValues(new Uint8Array(16)))}`,
    size: webp.byteLength,
  };
}

/** Deletes the image at `key`, if any. */
export async function deleteImage(env: Env, key: string): Promise<void> {
  await profilesBucket(env).delete(key);
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
