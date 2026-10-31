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
      return { name, value: inUnit(`radius.${name}`, /** @type {any} */ (token).$value, "px") };
    });
}

/**
 * @param {string} where e.g. `type.bubble`
 * @param {any} dimension a DTCG `{ value, unit }`
 * @param {string} unit
 */
function inUnit(where, dimension, unit) {
  if (dimension.unit !== unit)
    throw new Error(`${where}: unit ${dimension.unit}, expected ${unit}`);
  return /** @type {number} */ (dimension.value);
}

/**
 * Type styles with the family alias resolved to the font token's key. Size and
 * line height are in sp/pt, letter spacing in em.
 *
 * @typedef {{ name: string, family: string, weight: number, size: number, lineHeight?: number, letterSpacing?: number, description?: string }} TypeStyle
 * @param {any} tokens parsed tokens.json
 * @returns {TypeStyle[]}
 */
export function typeStyles(tokens) {
  return Object.entries(tokens.type ?? {})
    .filter(([name]) => !name.startsWith("$"))
    .map(([name, token]) => {
      const t = /** @type {any} */ (token);
      const v = t.$value;
      const family = /^\{font\.([a-z0-9-]+)\}$/.exec(v.fontFamily)?.[1];
      if (family === undefined)
        throw new Error(`type.${name}: fontFamily ${v.fontFamily} is not a {font.*} alias`);
      return {
        name,
        family,
        weight: v.fontWeight,
        size: inUnit(`type.${name}.fontSize`, v.fontSize, "px"),
        ...(v.lineHeight && { lineHeight: inUnit(`type.${name}.lineHeight`, v.lineHeight, "px") }),
        ...(v.letterSpacing && {
          letterSpacing: inUnit(`type.${name}.letterSpacing`, v.letterSpacing, "em"),
        }),
        description: t.$description,
      };
    });
}

/**
 * Spacing in points/dp, like the radii.
 *
 * @param {any} tokens parsed tokens.json
 * @returns {Array<{ name: string, value: number }>}
 */
export function spacing(tokens) {
  return Object.entries(tokens.spacing ?? {})
    .filter(([name]) => !name.startsWith("$"))
    .map(([name, token]) => ({
      name,
      value: inUnit(`spacing.${name}`, /** @type {any} */ (token).$value, "px"),
    }));
}

/** @param {number} byte */
export function hex2(byte) {
  return byte.toString(16).toUpperCase().padStart(2, "0");
}
