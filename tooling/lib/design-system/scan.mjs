// @ts-check
// What the apps' source says about the design scales, measured from text. The CLI reads the
// files and passes the text in, so every function here is pure and a test feeds it fixtures.

/**
 * @typedef {{ android: boolean, ios: boolean, web: boolean | null }} Wired
 * @typedef {{ value: string, count: number }} SizeCount
 * @typedef {{
 *   wired: { radius: Record<string, Wired>, type: Record<string, Wired>, spacing: Record<string, Wired> },
 *   inventory: Record<string, string[]>,
 *   adHoc: { android: SizeCount[], ios: SizeCount[], web: SizeCount[], semibold: number },
 * }} Scan
 * @typedef {{ android: string, ios: string, web: string }} Sources
 */

/** @param {string} name */
const constName = (name) => name.toUpperCase().replaceAll("-", "_");
/** @param {string} name */
const camel = (name) => name.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
/** @param {string} text */
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * @param {string} text
 * @param {string} needle a literal that must not continue into a longer identifier
 */
function mentions(text, needle) {
  return new RegExp(`${escape(needle)}(?![\\w-])`).test(text);
}

/** `rounded-card` and its directional forms (`rounded-t-card`, `md:rounded-tl-card`). */
const DIRECTIONS = "(?:-(?:t|b|l|r|s|e|tl|tr|bl|br|ss|se|es|ee))?";

/**
 * Whether each token is read by each platform's source, by the exact reader name the
 * generators emit: `BrandTokens.Radius.<CONST>_DP` on Android, `BrandTokens.Radius.<camel>` on
 * iOS, a `rounded-<name>` class on the web, and the type and spacing equivalents. The web does
 * not read spacing from a generated variable (Tailwind's scale covers it), so it is `null`.
 *
 * @param {{ radius: string[], type: string[], spacing: string[] }} names token names as tokens.json has them
 * @param {Sources} src
 * @returns {Scan["wired"]}
 */
export function wiredStatus(names, src) {
  /** @param {string} name */
  const radius = (name) => ({
    android: mentions(src.android, `BrandTokens.Radius.${constName(name)}_DP`),
    ios: mentions(src.ios, `BrandTokens.Radius.${camel(name)}`),
    web: new RegExp(`(?<![\\w-])rounded${DIRECTIONS}-${escape(name)}(?![\\w-])`).test(src.web),
  });
  /** @param {string} name */
  const type = (name) => ({
    android: mentions(src.android, `BrandTokens.Type.${constName(name)}`),
    ios: mentions(src.ios, `BrandTokens.Typography.${camel(name)}`),
    web: new RegExp(`(?<![\\w-])text-${escape(name)}(?![\\w-])`).test(src.web),
  });
  /** @param {string} name */
  const space = (name) => ({
    android: mentions(src.android, `BrandTokens.Spacing.${constName(name)}_DP`),
    ios: mentions(src.ios, `BrandTokens.Spacing.${camel(name)}`),
    web: null,
  });
  return {
    radius: Object.fromEntries(names.radius.map((n) => [n, radius(n)])),
    type: Object.fromEntries(names.type.map((n) => [n, type(n)])),
    spacing: Object.fromEntries(names.spacing.map((n) => [n, space(n)])),
  };
}

/**
 * Counts of each distinct match, in order of first appearance, then most frequent first.
 *
 * @param {string} text
 * @param {RegExp} pattern global; group 1 (or the whole match) is the key
 * @param {(m: RegExpMatchArray) => string} [key]
 * @returns {SizeCount[]}
 */
function tally(text, pattern, key = (m) => m[1] ?? m[0]) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const m of text.matchAll(pattern)) counts.set(key(m), (counts.get(key(m)) ?? 0) + 1);
  return [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
}

/**
 * Literal sizes the apps type by hand instead of naming a token: `<n>.sp` on Android,
 * `Font.sans(<n>` and `.headline(<n>` on iOS, `text-[<n>px]` and Tailwind's `text-xs`..`text-9xl`
 * on the web, and the `font-semibold` count (no 600 face is bundled).
 *
 * @param {Sources} src
 * @returns {Scan["adHoc"]}
 */
export function adHocSizes(src) {
  return {
    android: tally(src.android, /(?<![\w.])(\d+(?:\.\d+)?)\.sp\b/g),
    ios: tally(src.ios, /(?:Font\.sans|\.headline)\((\d+(?:\.\d+)?)/g),
    web: tally(
      src.web,
      /(?<![\w-])(text-\[\d+(?:\.\d+)?px\]|text-(?:xs|sm|base|lg|[2-9]?xl))(?![\w-])/g,
    ),
    semibold: [...src.web.matchAll(/(?<![\w-])font-semibold(?![\w-])/g)].length,
  };
}
