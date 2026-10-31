// @ts-check
// tokens.json and tokens.css of the design-system page, from a brand's tokens. Colours come
// from the same resolver the apps' generators use (brandColors), so a hex here is the hex a
// phone gets; no alias, var() or colour function survives into the file.

import {
  brandColors,
  cssFamily,
  fontFamilies,
  hex,
  radii,
  spacing,
  typeStyles,
} from "../brand-gen/color.mjs";
import { woff2Name } from "../brand-gen/web.mjs";

/**
 * @typedef {import("../brand-gen/strings.mjs").BrandInput} BrandInput
 * @typedef {{ pairs: Array<{ fg: string, bg: string, level: string, use: string }> }} Pairs
 */

/** A sample line that shows the Icelandic letters of a face. */
const SAMPLE = "Aa Bb Cc 0123 ÁÐÉÍÓÚÝÞÆÖ";

/** @param {string} word */
const title = (word) => word.charAt(0).toUpperCase() + word.slice(1);

/**
 * @param {unknown} value a raw token value
 * @returns {string | undefined} the key an alias `{color.key}` names
 */
function aliasOf(value) {
  return typeof value === "string" ? /^\{color\.([a-z0-9-]+)\}$/.exec(value)?.[1] : undefined;
}

/**
 * What a colour is for, from its own description and from the contrast pairs it appears in, so
 * every sentence is a measurement or a quotation and none is invented.
 *
 * @param {string} name
 * @param {BrandInput} brand
 * @param {Pairs} pairs
 */
function colorUsage(name, brand, pairs) {
  const raw = (/** @type {string} */ group) => brand.tokens[group]?.[name];
  const light = raw("color")?.$description;
  const dark = raw("dark")?.$description;
  const on = pairs.pairs.filter((p) => p.fg === name);
  const under = pairs.pairs.filter((p) => p.bg === name);
  const aliases = /** @type {const} */ (["color", "dark"])
    .map((group) => [group === "color" ? "light" : "dark", aliasOf(raw(group)?.$value)])
    .filter(([, alias]) => alias !== undefined)
    .map(([mode, alias]) => `In ${mode} it is an alias of \`${alias}\`.`);
  const parts = [
    light,
    dark && dark !== light ? `In dark: ${dark}` : undefined,
    on.length > 0
      ? `Reads on ${on.map((p) => `\`${p.bg}\` (${p.use})`).join(", ")}, in light and dark.`
      : undefined,
    under.length > 0
      ? `Ground for ${under.map((p) => `\`${p.fg}\` (${p.use})`).join(", ")}.`
      : undefined,
    ...aliases,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : "No contrast pair names this colour.";
}

/**
 * The font families as CSS stacks and the faces that back them.
 *
 * @param {BrandInput} brand
 */
function typeSection(brand) {
  const families = fontFamilies(brand.tokens);
  const fallbacks = (/** @type {string} */ key) => brand.tokens.font?.[key]?.$value?.slice(1) ?? [];
  const styles = typeStyles(brand.tokens);
  return {
    fonts: brand.fonts.map((font) => ({
      family: families.find((f) => f.name === font.family)?.family ?? font.family,
      file: `fonts/${woff2Name(font.fileName)}`,
      weight: String(font.weight),
      style: "normal",
    })),
    families: Object.fromEntries(
      families.map((f) => [f.name, [f.family, ...fallbacks(f.name)].map(cssFamily).join(", ")]),
    ),
    groups: families
      .map((f) => ({
        name: title(f.name),
        family: f.name,
        styles: styles
          .filter((s) => s.family === f.name)
          .map((s) => ({
            name: s.name,
            fontSize: `${s.size}px`,
            ...(s.lineHeight !== undefined && { lineHeight: `${s.lineHeight}px` }),
            fontWeight: s.weight,
            ...(s.letterSpacing !== undefined && { letterSpacing: `${s.letterSpacing}em` }),
            usage: s.description ?? `${f.name} ${s.weight}, ${s.size}px.`,
            sample: SAMPLE,
          })),
      }))
      .filter((g) => g.styles.length > 0),
  };
}

/**
 * The page's tokens.json.
 *
 * @param {BrandInput} brand
 * @param {Pairs} pairs
 * @param {{ commit: string, tokensSha256: string }} source
 */
export function tokensJson(brand, pairs, source) {
  const light = brandColors(brand.tokens);
  const dark = brandColors(brand.tokens, "dark");
  return {
    name: brand.manifest.displayName,
    version: 1,
    meta: { source },
    color: {
      themes: [
        { id: "light", name: "Light" },
        { id: "dark", name: "Dark" },
      ],
      tokens: light.map((c, i) => ({
        name: c.name,
        value: { light: hex(c), dark: hex(/** @type {any} */ (dark[i])) },
        usage: colorUsage(c.name, brand, pairs),
      })),
    },
    type: typeSection(brand),
    spacing: {
      tokens: spacing(brand.tokens).map((s) => ({
        name: s.name,
        value: `${s.value}px`,
        usage: `A ${s.value}px gap the apps repeat.`,
      })),
    },
    radius: {
      tokens: radii(brand.tokens).map((r) => ({
        name: `radius-${r.name}`,
        value: `${r.value}px`,
        usage:
          /** @type {any} */ (brand.tokens.radius[r.name]).$description ?? `A ${r.value}px corner.`,
      })),
    },
  };
}

/** @param {string} name a token name, with `.` escaped as CSS wants */
const cssName = (name) => name.replaceAll(".", "\\.");

/**
 * tokens.css as the page would compile it from tokens.json, which it never does for a system
 * kept in code (`editing: "code"`), so the export writes it.
 *
 * @param {ReturnType<typeof tokensJson>} json
 * @returns {string}
 */
export function tokensCss(json) {
  /** @param {"light" | "dark"} mode */
  const colors = (mode) =>
    json.color.tokens.map((t) => `  --${cssName(t.name)}: ${t.value[mode]};`);
  const statics = [
    ...json.spacing.tokens.map((t) => `  --${cssName(t.name)}: ${t.value};`),
    ...json.radius.tokens.map((t) => `  --${cssName(t.name)}: ${t.value};`),
    ...Object.entries(json.type.families).map(([key, stack]) => `  --font-${key}: ${stack};`),
  ];
  const classes = json.type.groups.flatMap((g) =>
    g.styles.map((s) =>
      [
        `.${cssName(s.name)} {`,
        `  font-family: var(--font-${g.family});`,
        `  font-size: ${s.fontSize};`,
        ...("lineHeight" in s ? [`  line-height: ${s.lineHeight};`] : []),
        `  font-weight: ${s.fontWeight};`,
        ...("letterSpacing" in s ? [`  letter-spacing: ${s.letterSpacing};`] : []),
        "}",
      ].join("\n"),
    ),
  );
  const faces = json.type.fonts.map((f) =>
    [
      "@font-face {",
      `  font-family: ${cssFamily(f.family)};`,
      `  font-weight: ${f.weight};`,
      `  font-style: ${f.style};`,
      "  font-display: swap;",
      `  src: url("${f.file}") format("woff2");`,
      "}",
    ].join("\n"),
  );
  return (
    [
      `/* ${json.name} design system — generated from tokens.json */`,
      `:root, [data-theme="light"] {\n${colors("light").join("\n")}\n}`,
      `[data-theme="dark"] {\n${colors("dark").join("\n")}\n}`,
      `:root {\n${statics.join("\n")}\n}`,
      ...classes,
      ...faces,
    ].join("\n\n") + "\n"
  );
}
