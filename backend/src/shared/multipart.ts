// The arithmetic and the part upload of an R2 multipart upload, shared by every
// route that takes a large body in parts (history transfers, import files).

/** Every part but the last; R2 wants them equal, and a Worker takes a body this size. */
export const PART_SIZE = 64 * 1024 * 1024;

/** How many parts an object of `size` bytes takes. */
export const partsOf = (size: number) => Math.ceil(size / PART_SIZE);

/** The length of part `part` (from 1) of an object of `size` bytes, or 0 for no such part. */
export function partLength(size: number, part: number): number {
  const parts = partsOf(size);
  if (part > parts) return 0;
  return part < parts ? PART_SIZE : size - PART_SIZE * (parts - 1);
}

/**
 * Stores `body`, which must carry exactly `length` bytes, as part `part` of an
 * upload and returns its etag. Throws when the body ends short or runs past.
 */
export async function uploadPart(
  bucket: R2Bucket,
  key: string,
  uploadId: string,
  part: number,
  length: number,
  body: ReadableStream<Uint8Array>,
): Promise<string> {
  const upload = bucket.resumeMultipartUpload(key, uploadId);
  const { readable, writable } = new FixedLengthStream(length);
  const [, uploaded] = await Promise.all([
    body.pipeTo(writable),
    upload.uploadPart(part, readable),
  ]);
  return uploaded.etag;
}

/** Aborts an upload R2 may no longer know: it has nothing left to abort then. */
export async function abortUpload(bucket: R2Bucket, key: string, uploadId: string): Promise<void> {
  try {
    await bucket.resumeMultipartUpload(key, uploadId).abort();
  } catch {
    // An upload R2 no longer knows has nothing left to abort.
  }
}

/** The body and Content-Length of a part request, or null when either is missing or unusable. */
export function partRequest(
  request: Request,
): { body: ReadableStream<Uint8Array>; length: number } | null {
  const length = Number(request.headers.get("content-length") ?? Number.NaN);
  const body = request.body;
  return Number.isSafeInteger(length) && length >= 1 && body ? { body, length } : null;
}
