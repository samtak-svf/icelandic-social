// What the assistant reads from a tester's own words without a model
// (decision 0076): the address they gave and which phone it is for. Only
// this decides what is queued; the model only writes the answer.

const ADDRESS = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const ANDROID = /\b(android|samsung|galaxy|pixel|xiaomi|huawei|oneplus|motorola)\b/i;
const IOS = /\b(iphone|ipad|ios|apple|testflight)\b/i;

/** The one address in `text`, lowercased; null for none or more than one. */
export function parseAddress(text: string): string | null {
  const found = new Set((text.match(ADDRESS) ?? []).map((a) => a.toLowerCase()));
  return found.size === 1 ? ([...found][0] ?? null) : null;
}

/**
 * The phone a tester's comments are about: Android only when they name it
 * and not an iPhone too, since an address is otherwise an Apple ID.
 */
export function platformOf(texts: string[]): "ios" | "android" {
  const all = texts.join("\n");
  return ANDROID.test(all) && !IOS.test(all) ? "android" : "ios";
}

/** `text` with every address in it replaced by `mask`, for the model. */
export function maskAddresses(text: string, mask: string): string {
  return text.replace(ADDRESS, mask);
}
