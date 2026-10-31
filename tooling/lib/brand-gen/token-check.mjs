// @ts-check
// The design-scale half of brand-check: the type, radius and spacing groups
// must exist, and every type style must be drawable from the faces the brand
// bundles.

import { radii, spacing, typeStyles } from "./color.mjs";

/**
 * @param {any} tokens
 * @returns {string[]} a problem per type style whose family alias names no font token
 */
function unknownFamilies(tokens) {
  const families = new Set(Object.keys(tokens.font ?? {}));
  return Object.entries(tokens.type ?? {})
    .filter(([name]) => !name.startsWith("$"))
    .map(([name, token]) => ({ name, alias: /** @type {any} */ (token).$value?.fontFamily }))
    .filter(({ alias }) => !families.has(/^\{font\.([^}]+)\}$/.exec(alias)?.[1] ?? ""))
    .map(({ name, alias }) => `type.${name}: font family ${alias} is not a font token`);
}

/**
 * @param {any} tokens parsed tokens.json
 * @param {{ family: string, weight: number }[] | undefined} fonts brand.json `fonts`
 * @returns {string[]}
 */
export function checkScales(tokens, fonts) {
  const missing = ["type", "radius", "spacing"]
    .filter((group) => tokens[group] === undefined)
    .map((group) => `${group}: missing`);
  const unknown = unknownFamilies(tokens);
  if (missing.length + unknown.length > 0) return [...missing, ...unknown];
  const faces = new Set((fonts ?? []).map((f) => `${f.family}/${f.weight}`));
  try {
    radii(tokens);
    spacing(tokens);
    return typeStyles(tokens)
      .filter((s) => !faces.has(`${s.family}/${s.weight}`))
      .map(
        (s) => `type.${s.name}: ${s.family}/${s.weight} has no bundled face in brand.json fonts`,
      );
  } catch (error) {
    return [/** @type {Error} */ (error).message];
  }
}
