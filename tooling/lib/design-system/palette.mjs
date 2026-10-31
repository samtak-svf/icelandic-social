// @ts-check
// Which colours the cover (and anything else that must stay visible in both modes) can use:
// measured against the ground, never chosen by name. A colour is visible when it is at least
// MIN_VISIBLE OKLab away from the ground in light and in dark.

import { colorTokens, distance, measure, oklab, resolveColor } from "../contrast.mjs";

/** The smallest OKLab distance at which a field still reads against the ground. */
export const MIN_VISIBLE = 0.05;
const PLAIN = /^[a-z0-9-]+$/;

/**
 * @typedef {{ pairs: Array<{ fg: string, bg: string, level: string }> }} Pairs
 * @typedef {{
 *   maps: { light: Map<string, unknown>, dark: Map<string, unknown> },
 *   ground: string, ink: string | undefined, muted: string | undefined,
 *   slab: string | undefined, accent: string | undefined, tint: string | undefined,
 *   problems: string[],
 * }} Palette
 */

/**
 * @param {string} name
 * @param {Map<string, unknown>} map
 */
function chroma(name, map) {
  const c = resolveColor(name, map);
  const [, a, b] = oklab({ r: c.r / 255, g: c.g / 255, b: c.b / 255, a: 1 });
  return Math.hypot(a, b);
}

/**
 * @param {Pairs} pairs
 * @param {(name: string) => boolean} known
 * @returns {string | undefined} the background most pairs sit on
 */
function groundOf(pairs, known) {
  /** @type {Map<string, number>} */
  const count = new Map();
  for (const p of pairs.pairs) if (known(p.bg)) count.set(p.bg, (count.get(p.bg) ?? 0) + 1);
  return [...count].sort((a, b) => b[1] - a[1])[0]?.[0];
}

/**
 * @param {any} brand
 * @param {Pairs} pairs
 * @returns {Palette}
 */
export function palette(brand, pairs) {
  const maps = { light: colorTokens(brand.tokens), dark: colorTokens(brand.tokens, "dark") };
  const known = (/** @type {string} */ n) => PLAIN.test(n) && maps.light.has(n) && maps.dark.has(n);
  const ground = groundOf(pairs, known);
  if (!ground) throw new Error("no contrast pair names a ground");

  const visibility = (/** @type {string} */ n) =>
    Math.min(distance(n, ground, maps.light).delta, distance(n, ground, maps.dark).delta);
  const opaque = (/** @type {string} */ n) =>
    resolveColor(n, maps.light).a === 255 && resolveColor(n, maps.dark).a === 255;
  const visible = [...maps.light.keys()].filter(
    (n) => n !== ground && known(n) && opaque(n) && visibility(n) >= MIN_VISIBLE,
  );

  const strength = (/** @type {string} */ fg) =>
    Math.min(measure(fg, ground, maps.light).ratio, measure(fg, ground, maps.dark).ratio);
  const onGround = pairs.pairs.filter((p) => p.bg === ground && known(p.fg));
  const ink = onGround.map((p) => p.fg).sort((a, b) => strength(b) - strength(a))[0];
  const muted = onGround
    .filter((p) => p.level === "aaNormal" && p.fg !== ink && strength(p.fg) >= 4.5)
    .map((p) => p.fg)
    .sort((a, b) => strength(a) - strength(b))[0];

  const slab = visible.includes(brand.manifest.icon?.background)
    ? brand.manifest.icon.background
    : visible[0];
  const accent = visible.includes("secondary")
    ? "secondary"
    : visible
        .filter((n) => n !== slab && distance(n, slab ?? n, maps.light).delta >= 0.12)
        .sort((a, b) => chroma(b, maps.light) - chroma(a, maps.light))[0];
  const asBackground = new Set(pairs.pairs.map((p) => p.bg));
  const taken = new Set([slab, accent, ink]);
  const tint = visible
    .filter((n) => !taken.has(n))
    .sort(
      (a, b) =>
        Number(asBackground.has(b)) - Number(asBackground.has(a)) ||
        chroma(a, maps.light) - chroma(b, maps.light),
    )[0];

  const roles = { ink: visible.includes(ink ?? "") ? ink : undefined, slab, accent, tint };
  const problems = Object.entries(roles)
    .filter(([, token]) => !token)
    .map(([role]) => `no colour is visible against ${ground} in both modes for the ${role} block`);
  if (!muted) problems.push(`no muted text colour reads on ${ground} in both modes`);
  return { maps, ground, ink: roles.ink, muted, slab, accent, tint, problems };
}
