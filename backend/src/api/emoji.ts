import { z } from "@hono/zod-openapi";

// What "an emoji" is wherever the server accepts one (decision 0100): exactly
// one extended grapheme cluster that is an emoji. ZWJ sequences, skin tones,
// keycaps, flags and tag flags are one cluster each; two emoji, text, or an
// emoji with anything beside it is not. The chat's reaction travels inside the
// encrypted envelope, which the server cannot read, so this rule is the one
// the hosted surfaces share.

/** The longest an emoji is, in UTF-16 code units; the longest sequence there is is under 30. */
const MAX_UNITS = 32;

const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });

// One pictographic with its presentation made explicit (VS16, a skin tone) or
// emoji-by-default; joined by ZWJ into a sequence. A flag is two regional
// indicators, a keycap a base, an optional VS16 and U+20E3, a tag flag a black
// flag followed by tag characters.
const PICTOGRAPH =
  "(?:[\\p{Emoji_Presentation}&&\\p{Extended_Pictographic}]\\p{Emoji_Modifier}?|\\p{Extended_Pictographic}(?:\\uFE0F|\\p{Emoji_Modifier}))";
const ONE = new RegExp(
  `^(?:${PICTOGRAPH}(?:\\u200D${PICTOGRAPH})*[\\u{E0020}-\\u{E007F}]*|\\p{Regional_Indicator}{2}|[0-9#*]\\uFE0F?\\u20E3)$`,
  "v",
);

/** Whether `value` is exactly one emoji. */
export function isEmoji(value: string): boolean {
  if (value.length === 0 || value.length > MAX_UNITS) return false;
  const [first, second] = graphemes.segment(value)[Symbol.iterator]();
  return first !== undefined && second === undefined && ONE.test(first.segment);
}

/** An emoji as a string in a request or a response. */
export const Emoji = z.string().refine(isEmoji, { message: "not exactly one emoji" }).openapi({
  type: "string",
  maxLength: MAX_UNITS,
  description:
    "Exactly one emoji: one grapheme cluster, a ZWJ sequence, skin tone or flag included",
  example: "🙏",
});
