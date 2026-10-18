// The photo as the web uploads it (decision 0039): cropped to the centre
// square and scaled down to the size the server keeps, so the upload is
// small. The server re-encodes it whatever arrives, which is what strips the
// metadata; this only saves the bytes.

/** The side the server stores, in pixels. */
const SIDE = 512;

export async function squarePhoto(file: Blob): Promise<Blob> {
  const image = await createImageBitmap(file);
  const crop = Math.min(image.width, image.height);
  const side = Math.min(crop, SIDE);
  const canvas = new OffscreenCanvas(side, side);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no 2d context");
  context.drawImage(
    image,
    (image.width - crop) / 2,
    (image.height - crop) / 2,
    crop,
    crop,
    0,
    0,
    side,
    side,
  );
  image.close();
  return canvas.convertToBlob({ type: "image/webp", quality: 0.9 });
}
