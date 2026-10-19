// The images of a post (decision 0065): at most four, each at most 10 MB, as
// the server takes them. A choice past either is refused here, before any
// upload, with a sentence that says why.

/** The most images one post holds. */
const MAX_IMAGES = 4;

/** The largest upload the server takes, in bytes. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** The formats the server reads; anything else it refuses. */
export const IMAGE_TYPES = "image/jpeg,image/png,image/webp,image/gif,image/avif";

/** Why `picked` may not join the `have` images already chosen, or null when it may. */
export function refusal(
  have: number,
  picked: readonly { size: number }[],
): "too_many" | "too_large" | null {
  if (have + picked.length > MAX_IMAGES) return "too_many";
  if (picked.some((file) => file.size > MAX_IMAGE_BYTES)) return "too_large";
  return null;
}
