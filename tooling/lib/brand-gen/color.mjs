// @ts-check
// Every colour token resolved once, through the same path as the contrast
// check (tooling/lib/contrast.mjs resolveColor).

import { colorTokens, resolveColor } from "../contrast.mjs";

/**
 * @typedef {{ name: string, r: number, g: number, b: number, a: number, description?: string }} BrandColor
 */

/**
 * One mode's colours, in the order tokens.json lists the light ones, so both
 * modes come out key for key (brand-check holds them to the same keys). The
 * description is the light token's.
 *
 * @param {any} tokens parsed tokens.json
 * @param {import("../contrast.mjs").Mode} [mode]
 * @returns {BrandColor[]}
 */
export function brandColors(tokens, mode = "light") {
  const map = colorTokens(tokens, mode);
  return [...colorTokens(tokens).keys()].map((name) => ({
    name,
    ...resolveColor(name, map),
    description: tokens.color[name].$description,
  }));
}

/**
 * @param {any} tokens parsed tokens.json
 * @returns {Array<{ name: string, family: string }>}
 */
export function fontFamilies(tokens) {
  return Object.entries(tokens.font ?? {})
    .filter(([name]) => !name.startsWith("$"))
    .map(([name, token]) => ({ name, family: /** @type {any} */ (token).$value[0] }));
}

/**
 * Radii in points/dp. tokens.json writes them in CSS px, which equal dp and pt.
 *
 * @param {any} tokens parsed tokens.json
 * @returns {Array<{ name: string, value: number }>}
 */
export function radii(tokens) {
  return Object.entries(tokens.radius ?? {})
    .filter(([name]) => !name.startsWith("$"))
    .map(([name, token]) => {
      const { value, unit } = /** @type {any} */ (token).$value;
      if (unit !== "px") throw new Error(`radius.${name}: unit ${unit}, expected px`);
      return { name, value };
    });
}

/** @param {number} byte */
export function hex2(byte) {
  return byte.toString(16).toUpperCase().padStart(2, "0");
}
