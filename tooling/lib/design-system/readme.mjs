// @ts-check
// README.md of the design-system page: the author's text the page shows first. The rules are
// derived from the tokens and the contrast pairs, the tables from measurement.

import { radii, spacing, typeStyles } from "../brand-gen/color.mjs";
import { colorTokens, measure, THRESHOLDS } from "../contrast.mjs";

/**
 * @typedef {import("../brand-gen/strings.mjs").BrandInput} BrandInput
 * @typedef {import("./scan.mjs").Scan} Scan
 * @typedef {{ pairs: Array<{ fg: string, bg: string, level: keyof typeof THRESHOLDS, use: string }> }} Pairs
 */

/** @param {string[]} names */
const code = (names) => names.map((n) => `\`${n}\``).join(", ");
/** @param {boolean | null} v */
const mark = (v) => (v === null ? "Tailwind scale" : v ? "yes" : "no");

/**
 * The contrast table: every pair in both modes, a failing pair kept at its real value.
 *
 * @param {BrandInput} brand
 * @param {Pairs} pairs
 */
function contrastTable(brand, pairs) {
  const maps = { light: colorTokens(brand.tokens), dark: colorTokens(brand.tokens, "dark") };
  const rows = pairs.pairs.map((p) => {
    const need = THRESHOLDS[p.level];
    const cells = /** @type {const} */ (["light", "dark"]).map((mode) => {
      const { ratio } = measure(p.fg, p.bg, maps[mode]);
      return `${ratio.toFixed(2)}:1${ratio >= need.min ? "" : " FAIL"}`;
    });
    return `| \`${p.fg}\` on \`${p.bg}\` | ${need.label} (${need.min}:1) | ${cells.join(" | ")} | ${p.use} |`;
  });
  return ["| Pair | Needs | Light | Dark | Use |", "| --- | --- | --- | --- | --- |", ...rows].join(
    "\n",
  );
}

/**
 * @param {BrandInput} brand
 * @param {Pairs} pairs
 */
function colourRules(brand, pairs) {
  /** @type {Map<string, string[]>} */
  const grounds = new Map();
  for (const p of pairs.pairs)
    if (/^[a-z0-9-]+$/.test(p.bg) && /^[a-z0-9-]+$/.test(p.fg))
      grounds.set(p.bg, [...(grounds.get(p.bg) ?? []), `\`${p.fg}\` for ${p.use}`]);
  return [...grounds]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 3)
    .map(([bg, uses]) => `- On \`${bg}\` set ${uses.join(", ")}.`);
}

/**
 * @param {BrandInput} brand
 * @param {Pairs} pairs
 * @param {Scan} scan
 * @returns {string}
 */
export function readme(brand, pairs, scan) {
  const name = brand.manifest.displayName;
  const radius = radii(brand.tokens).sort((a, b) => a.value - b.value);
  const space = spacing(brand.tokens).sort((a, b) => a.value - b.value);
  const styles = typeStyles(brand.tokens);
  const ink = /fill="(#[0-9a-fA-F]{3,8})"/.exec(brand.iconSvg)?.[1];
  const ground = brand.manifest.icon?.background;
  const status = (/** @type {"radius" | "type" | "spacing"} */ family) =>
    [
      `### ${{ radius: "Radius", type: "Type", spacing: "Spacing" }[family]}`,
      "| Token | Android | iOS | Web |",
      "| --- | --- | --- | --- |",
      ...Object.entries(scan.wired[family]).map(
        ([token, w]) => `| \`${token}\` | ${mark(w.android)} | ${mark(w.ios)} | ${mark(w.web)} |`,
      ),
    ].join("\n");
  const sizes = (/** @type {import("./scan.mjs").SizeCount[]} */ list) =>
    list.length > 0 ? list.map((s) => `${s.value} (${s.count})`).join(", ") : "none";
  const weights = [...new Set(brand.fonts.map((f) => f.weight))].sort((a, b) => a - b);

  return (
    [
      `This page is the read-only design system of ${name}, generated from the brand's tokens. To propose a change, comment on the page or open a pull request against \`brand/${brand.name}/tokens.json\`; the repository's checks guard it.`,
      [
        "## Content fundamentals",
        "- Write every user-facing sentence in Icelandic, as a whole sentence per string, never a name interpolated into a template.",
        "- Use no em dash and no spaced en dash; an unspaced en dash in a range (9–17) is fine.",
        "- Write code, comments and documentation in English.",
      ].join("\n"),
      [
        "## Visual foundations",
        `- Reference a colour by its token name in both modes and never write a hex: all ${brand.tokens.color ? Object.keys(brand.tokens.color).filter((k) => !k.startsWith("$")).length : 0} colours have a light and a dark value.`,
        ...colourRules(brand, pairs),
        `- Take every corner from the radius scale: ${code(radius.map((r) => `radius-${r.name}`))}.`,
        `- Take every gap from the spacing scale: ${code(space.map((s) => s.name))}.`,
        `- Set text in the type styles ${code(styles.map((s) => s.name))} and never in a literal size.`,
      ].join("\n"),
      ink && ground
        ? `## Iconography\n- The mark is a single ink, \`${ink}\` as the SVG's fill says, on the ground \`${ground}\`; keep it one ink and never recolour it.`
        : "",
      `## Contrast\nEvery pair below is measured in both modes; a pair under its threshold keeps its real value and is flagged FAIL.\n\n${contrastTable(brand, pairs)}`,
      [
        "## Wired status",
        "Measured from the apps' source text: a token is wired where a platform's reader names it. Colours reach all three platforms through generated files, so they are wired by construction.",
        "",
        status("radius"),
        "",
        status("type"),
        "",
        status("spacing"),
      ].join("\n"),
      [
        "## Components",
        ...Object.entries(scan.inventory).map(
          ([dir, files]) => `- \`${dir}\`: ${files.length > 0 ? code(files) : "none"}`,
        ),
        "",
        "Component previews are not on this page yet.",
      ].join("\n"),
      [
        "## Ad hoc sizes",
        "Literal font sizes in the apps' source, with how often each appears: candidates to consolidate into the type styles.",
        `- Android (\`sp\`): ${sizes(scan.adHoc.android)}`,
        `- iOS (points): ${sizes(scan.adHoc.ios)}`,
        `- Web: ${sizes(scan.adHoc.web)}`,
        `- \`font-semibold\` appears ${scan.adHoc.semibold} times; the bundled faces are weights ${weights.join(", ")}${weights.includes(600) ? "" : ", so none is 600"}.`,
      ].join("\n"),
    ]
      .filter(Boolean)
      .join("\n\n") + "\n"
  );
}
