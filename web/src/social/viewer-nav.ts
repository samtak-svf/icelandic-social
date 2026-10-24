/** The index after `key` in a viewer of `count` images, or null when the key does not page. */
export function stepBy(index: number, count: number, key: string): number | null {
  if (key === "ArrowRight") return Math.min(index + 1, count - 1);
  if (key === "ArrowLeft") return Math.max(index - 1, 0);
  return null;
}
