import { MAX_IMAGE_BYTES } from "./social/images.ts";

// The picture as the web uploads it (decision 0086): the whole image, scaled
// down to the long edge the server keeps, never cut. The person frames it in
// the crop sheet afterwards and the framing goes in its own request. The
// server re-encodes whatever arrives, which is what strips the metadata; this
// only saves the bytes.

/** The longest edge the server keeps of a master, in pixels. */
export const MASTER_EDGE = 2400;

/** The qualities tried, best first, until the file fits the upload limit. */
const QUALITIES = [0.9, 0.8, 0.7, 0.6];

/** The size an image of `w` by `h` is sent at: its long edge at most 2400, and never larger than it is. */
export function masterSize(w: number, h: number): { w: number; h: number } {
  const scale = Math.min(1, MASTER_EDGE / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

/**
 * The image as a JPEG under the upload limit, or "too_large" when even the
 * lowest quality is over it. Throws when the browser cannot read the file.
 */
export async function masterOf(file: Blob): Promise<Blob | "too_large"> {
  const image = await createImageBitmap(file);
  try {
    const { w, h } = masterSize(image.width, image.height);
    const canvas = new OffscreenCanvas(w, h);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no 2d context");
    // JPEG has no alpha: a transparent PNG would turn black.
    context.fillStyle = "#fff";
    context.fillRect(0, 0, w, h);
    context.drawImage(image, 0, 0, w, h);
    for (const quality of QUALITIES) {
      const blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
      if (blob.size <= MAX_IMAGE_BYTES) return blob;
    }
    return "too_large";
  } finally {
    image.close();
  }
}
