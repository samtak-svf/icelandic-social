// @ts-check
// WCAG contrast between two colours, with alpha compositing done explicitly.
// Ported from samtak-vefur scripts/lib/contrast.mjs (#388), where the lesson
// was that a ratio read off a token pair is wrong as soon as a layer is
// translucent. The expression grammar is the same:
//
//   primary                       a token, by name
//   border-strong over surface    a translucent token on what it sits on
//   (white/15 over primary)/80 over primary
//
// Leftmost layer is on top; the bottom one must be opaque. An integer alpha
// suffix is a percent (`/15`), a decimal a fraction (`/0.15`).
//
// What changed in the port is only where tokens come from: a brand's DTCG
// `tokens.json` (designtokens.org colour values and `{group.token}` aliases)
// instead of `--color-*` declarations in a stylesheet. Colour space is
// oklch → sRGB (D65); the ratio is WCAG 2.x.

/** @typedef {{ r: number, g: number, b: number, a: number }} Rgba */
/** @typedef {Map<string, unknown>} TokenMap */

/** Named colours that are not tokens but are written as if they were. */
const BUILT_IN = /** @type {Record<string, string>} */ ({ white: "#ffffff", black: "#000000" });

/** @param {number} x */
function srgbFromLinear(x) {
  return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

/** @param {number} x */
function clamp01(x) {
  return Math.min(1, Math.max(0, x));
}

/**
 * oklch (L 0-1, C, h degrees) to sRGB channels, gamut-clipped per channel.
 *
 * @param {number} L
 * @param {number} C
 * @param {number} h
 * @returns {[number, number, number]}
 */
function oklchToRgb(L, C, h) {
  const hr = (h * Math.PI) / 180;
  const a = C * Math.cos(hr);
  const b = C * Math.sin(hr);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  const [r = 0, g = 0, bl = 0] = linear.map((v) => clamp01(srgbFromLinear(v)));
  return [r, g, bl];
}

/**
 * @param {string} text
 * @returns {Rgba}
 */
function parseHex(text) {
  const hex = text.slice(1);
  const expanded = hex.length === 3 || hex.length === 4 ? [...hex].map((c) => c + c).join("") : hex;
  if (expanded.length !== 6 && expanded.length !== 8) throw new Error(`not a hex colour: ${text}`);
  /** @param {number} i */
  const channel = (i) => Number.parseInt(expanded.slice(i * 2, i * 2 + 2), 16) / 255;
  return { r: channel(0), g: channel(1), b: channel(2), a: expanded.length === 8 ? channel(3) : 1 };
}

/**
 * A DTCG colour value: `{ colorSpace, components, alpha?, hex? }`.
 *
 * @param {unknown} value
 * @param {string} name for errors
 * @returns {Rgba}
 */
function parseDtcgColor(value, name) {
  const color = /** @type {{ colorSpace?: string, components?: number[], alpha?: number }} */ (
    value
  );
  const alpha = color.alpha ?? 1;
  const [c0 = Number.NaN, c1 = Number.NaN, c2 = Number.NaN] = color.components ?? [];
  if (color.colorSpace === "oklch") {
    const [r, g, b] = oklchToRgb(c0, c1, c2);
    return { r, g, b, a: alpha };
  }
  if (color.colorSpace === "srgb") return { r: c0, g: c1, b: c2, a: alpha };
  throw new Error(`token "${name}": colour space ${String(color.colorSpace)} is not supported`);
}

/**
 * Flattens a DTCG `color` group into a name → $value map, the names being the
 * token keys (`primary`, `bubble-own-bg`), which is how pairs refer to them.
 *
 * @param {Record<string, unknown>} tokens parsed tokens.json
 * @returns {TokenMap}
 */
export function colorTokens(tokens) {
  const group = /** @type {Record<string, { $value?: unknown }>} */ (tokens.color ?? {});
  const map = new Map();
  for (const [name, token] of Object.entries(group)) {
    if (name.startsWith("$")) continue;
    map.set(name, token.$value);
  }
  return map;
}

/**
 * @param {string} name
 * @param {TokenMap} tokens
 * @param {Set<string>} seen alias chain, to refuse cycles
 * @returns {Rgba}
 */
function resolveToken(name, tokens, seen) {
  if (seen.has(name)) throw new Error(`token alias cycle through "${name}"`);
  const builtIn = BUILT_IN[name];
  if (builtIn) return parseHex(builtIn);
  if (!tokens.has(name)) throw new Error(`unknown colour "${name}": not a token or a hex value`);
  const value = tokens.get(name);
  if (typeof value === "string") {
    const alias = /^\{color\.([a-z0-9-]+)\}$/.exec(value);
    if (alias?.[1]) return resolveToken(alias[1], tokens, new Set([...seen, name]));
    if (value.startsWith("#")) return parseHex(value);
    throw new Error(`token "${name}": ${value} is neither an alias nor a hex value`);
  }
  return parseDtcgColor(value, name);
}

/**
 * Alpha suffix, Tailwind-style: an integer is a percent, a decimal a fraction.
 *
 * @param {string} text
 */
function parseAlpha(text) {
  const value = Number(text);
  if (Number.isNaN(value)) throw new Error(`not an alpha value: /${text}`);
  return text.includes(".") ? value : value / 100;
}

/**
 * Splits on top-level occurrences only, so a parenthesised sub-expression
 * keeps its own `over`s and `/`.
 *
 * @param {string} text
 * @param {string} separator
 */
function splitTopLevel(text, separator) {
  /** @type {string[]} */
  const parts = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === "(") depth++;
    if (char === ")") depth--;
    if (depth === 0 && isSeparatorAt(text, i, separator)) {
      parts.push(current);
      current = "";
      i += separator.length - 1;
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts.map((p) => p.trim());
}

/**
 * @param {string} text
 * @param {number} i
 * @param {string} separator
 */
function isSeparatorAt(text, i, separator) {
  if (separator === "/") return text[i] === "/";
  return (
    text.slice(i, i + separator.length) === separator &&
    /(^|\s)$/.test(text.slice(0, i)) &&
    /^(\s|$)/.test(text.slice(i + separator.length))
  );
}

/**
 * @param {string} text
 * @param {TokenMap} tokens
 * @returns {Rgba}
 */
function parseAtom(text, tokens) {
  if (text.startsWith("(")) return parseExpression(text.slice(1, -1), tokens);
  if (text.startsWith("#")) return parseHex(text);
  return resolveToken(text, tokens, new Set());
}

/**
 * `src` composited over `dst` (source-over).
 *
 * @param {Rgba} src
 * @param {Rgba} dst
 * @returns {Rgba}
 */
function over(src, dst) {
  const a = src.a + dst.a * (1 - src.a);
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
  /** @param {"r" | "g" | "b"} key */
  const channel = (key) => (src[key] * src.a + dst[key] * dst.a * (1 - src.a)) / a;
  return { r: channel("r"), g: channel("g"), b: channel("b"), a };
}

/**
 * Resolves a layer expression to a single colour.
 *
 * @param {string} expression
 * @param {TokenMap} tokens
 * @returns {Rgba}
 */
function parseExpression(expression, tokens) {
  const layers = splitTopLevel(expression.trim(), "over").map((layer) => {
    const [body = "", alpha] = splitTopLevel(layer, "/");
    const color = parseAtom(body, tokens);
    return alpha === undefined ? color : { ...color, a: color.a * parseAlpha(alpha) };
  });
  return layers.reduceRight((below, above) => over(above, below));
}

/**
 * Resolves an expression and insists the result is opaque.
 *
 * @param {string} expression
 * @param {TokenMap} tokens
 */
function resolve(expression, tokens) {
  const color = parseExpression(expression, tokens);
  if (color.a < 0.999) {
    throw new Error(
      `"${expression}" is only ${Math.round(color.a * 100)}% opaque; name what it sits on, e.g. "… over surface"`,
    );
  }
  return color;
}

/** @param {Rgba} color */
function toHex(color) {
  /** @param {number} v */
  const channel = (v) =>
    Math.round(clamp01(v) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`;
}

/** @param {Rgba} color */
function relativeLuminance({ r, g, b }) {
  /** @param {number} v */
  const linear = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/**
 * WCAG 2.x contrast ratio, rounded to two decimals the way thresholds are read.
 *
 * @param {Rgba} a
 * @param {Rgba} b
 */
function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [lighter, darker] = la > lb ? [la, lb] : [lb, la];
  return Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100;
}

/**
 * Thresholds a pair is judged against. `nonText` is SC 1.4.11, which applies
 * to a boundary or mark only when it carries meaning; contrast-pairs.json
 * lists only those.
 */
export const THRESHOLDS = /** @type {const} */ ({
  aaNormal: { label: "AA normal text", min: 4.5 },
  aaLarge: { label: "AA large/bold text", min: 3 },
  aaa: { label: "AAA normal text", min: 7 },
  nonText: { label: "non-text / UI boundary (1.4.11)", min: 3 },
});

/**
 * One pair, resolved.
 *
 * @param {string} foreground
 * @param {string} background
 * @param {TokenMap} tokens
 */
export function measure(foreground, background, tokens) {
  const fg = resolve(foreground, tokens);
  const bg = resolve(background, tokens);
  return { fg: toHex(fg), bg: toHex(bg), ratio: contrastRatio(fg, bg) };
}
