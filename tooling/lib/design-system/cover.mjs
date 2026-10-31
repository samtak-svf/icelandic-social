// @ts-check
// The cover of the design-system page (components/Cover/preview.html): colour blocks, one
// pattern and the name, all chosen by measurement from the brand's own tokens, so the file
// reads in light and dark without an outline.

import { radii, spacing, typeStyles } from "../brand-gen/color.mjs";
import { MIN_VISIBLE, palette } from "./palette.mjs";

const WIDTH = 960;
const SPLIT = 480;
const TEXT_WIDTH = 440;
const ROWS = 13;
const TAGLINE = "Design tokens for the Android, iOS and web apps";

/** Blocks as [column, row, columns, rows] right of the name's zone, in units of the largest step. */
const LAYOUT = /** @type {const} */ ({
  slab: [3, 0, 6, 8],
  accent: [12, 1, 8, 5],
  ink: [9, 8, 5, 5],
  tint: [15, 7, 5, 6],
});

/**
 * The lines a name breaks into (at a space or hyphen it already has) and the size it takes:
 * the largest of 120 down to 64 at which the longest line, counted at 0.6em a letter, fits.
 *
 * @param {string} name
 * @returns {{ lines: string[], size: number } | undefined}
 */
function fitName(name) {
  const words = name.split(/(?<=[ -])/);
  const splits = [[name]];
  for (let i = 1; i < words.length; i++)
    splits.push([words.slice(0, i).join("").trimEnd(), words.slice(i).join("").trimEnd()]);
  const longest = (/** @type {string[]} */ lines) => Math.max(...lines.map((l) => l.length));
  const best = splits.sort((a, b) => longest(a) - longest(b) || a.length - b.length)[0] ?? [name];
  for (let size = 120; size >= 64; size--)
    if (longest(best) * 0.6 * size <= TEXT_WIDTH) return { lines: best, size };
  return undefined;
}

/**
 * @param {Record<string, string | undefined>} picks role to colour token
 * @param {number} unit
 * @param {number} bleed how far a block runs past the edge it bleeds off
 * @returns {{ rects: string[], boxes: Array<[number, number, number, number]> }}
 */
function placeBlocks(picks, unit, bleed) {
  const height = unit * ROWS;
  /** @type {Array<[number, number, number, number]>} */
  const boxes = [];
  const rects = Object.entries(LAYOUT)
    .filter(([role]) => picks[role])
    .map(([role, [c, r, w, h]]) => {
      const box = /** @type {[number, number, number, number]} */ ([
        SPLIT + c * unit,
        r * unit,
        w * unit,
        h * unit,
      ]);
      boxes.push(box);
      const [x, y, bw, bh] = box;
      const top = y === 0 ? bleed : 0;
      const right = x + bw === WIDTH ? bleed : 0;
      const bottom = y + bh >= height ? bleed : 0;
      return `<rect class="block ${role}" x="${x}" y="${y - top}" width="${bw + right}" height="${bh + top + bottom}"/>`;
    });
  return { rects, boxes };
}

/**
 * Discs on a lattice of two units, wherever a disc clears every block by half a unit.
 *
 * @param {Array<[number, number, number, number]>} boxes
 * @param {number} unit
 * @param {number} size
 */
function placeDots(boxes, unit, size) {
  const gap = unit / 2;
  const clear = (/** @type {number} */ x, /** @type {number} */ y) =>
    boxes.every(
      ([bx, by, bw, bh]) =>
        x + size + gap <= bx || x - gap >= bx + bw || y + size + gap <= by || y - gap >= by + bh,
    );
  const dots = [];
  for (let row = 0; row < Math.floor(ROWS / 2); row++)
    for (let col = 0; col < SPLIT / (2 * unit); col++) {
      const x = SPLIT + (2 * col + 1) * unit - size / 2;
      const y = (2 * row + 1) * unit - size / 2;
      if (clear(x, y))
        dots.push(`<rect class="dot" x="${x}" y="${y}" width="${size}" height="${size}"/>`);
    }
  return dots;
}

/**
 * @param {number} height
 * @param {number} area share of the cover the blocks cover
 * @param {number} dots
 * @returns {string[]}
 */
function measureProblems(height, area, dots) {
  /** @type {string[]} */
  const problems = [];
  if (height < 240 || height > 360) problems.push(`cover: height ${height} is outside 240 to 360`);
  if (area < 0.25 || area > 0.5)
    problems.push(
      `cover: blocks cover ${Math.round(area * 100)}% of the cover, not a quarter to half`,
    );
  if (dots < 12 || dots > 60) problems.push(`cover: the pattern has ${dots} units, not 12 to 60`);
  return problems;
}

/**
 * The name, set in the face of the largest type style, and the face of the smallest for the line under it.
 *
 * @param {import("../brand-gen/strings.mjs").BrandInput} brand
 * @param {number} height
 */
function nameBlock(brand, height) {
  const styles = typeStyles(brand.tokens);
  const display = [...styles].sort((a, b) => b.size - a.size)[0];
  const body = [...styles].sort((a, b) => a.size - b.size)[0];
  const name = brand.manifest.displayName;
  const fitted = fitName(name);
  const { lines, size } = fitted ?? { lines: [name], size: 64 };
  /** @type {string[]} */
  const problems = [];
  if (!fitted)
    problems.push(
      `cover: "${name}" is wider than ${TEXT_WIDTH}px at 64px and needs the top-band layout, which is not implemented`,
    );
  if (lines.length * size * 0.95 + 14 + 2 * 16 > height)
    problems.push(`cover: the name at ${size}px does not fit the height`);
  return { lines, size, display, body, problems };
}

/**
 * @param {import("../brand-gen/strings.mjs").BrandInput} brand
 * @param {import("./palette.mjs").Pairs} pairs
 * @returns {{ html: string, problems: string[] }}
 */
export function cover(brand, pairs) {
  const pal = palette(brand, pairs);
  const problems = pal.problems.map((p) => `cover: ${p}`);
  const steps = spacing(brand.tokens).map((s) => s.value);
  const unit = Math.max(0, ...steps) || 24;
  const height = unit * ROWS;
  const scale = radii(brand.tokens).sort((a, b) => a.value - b.value);
  const corner = scale[Math.floor(scale.length / 2)];
  const cornerValue = corner?.value ?? 0;
  const dotSize = [...steps].sort((a, b) => Math.abs(a - 16) - Math.abs(b - 16))[0] ?? 16;

  const picks = { slab: pal.slab, accent: pal.accent, ink: pal.ink, tint: pal.tint };
  const { rects, boxes } = placeBlocks(picks, unit, cornerValue);
  const dots = placeDots(boxes, unit, dotSize);
  const area = boxes.reduce((sum, [, , w, h]) => sum + w * h, 0) / (WIDTH * height);
  const title = nameBlock(brand, height);
  problems.push(...title.problems, ...measureProblems(height, area, dots.length));
  const { lines, size, display, body } = title;

  const radius = `rx:var(--radius-${corner?.name});ry:var(--radius-${corner?.name})`;
  const css = [
    `.cover{position:relative;width:${WIDTH}px;height:${height}px;overflow:hidden;background:var(--${pal.ground})}`,
    ".art{position:absolute;left:0;top:0}",
    ...["slab", "accent", "ink", "tint"].map(
      (role) =>
        `.${role}{fill:var(--${picks[/** @type {keyof typeof picks} */ (role)]});${radius}}`,
    ),
    `.dot{fill:var(--${pal.accent});rx:${dotSize / 2}px;ry:${dotSize / 2}px}`,
    `.text{position:absolute;left:40px;bottom:${unit}px;width:${TEXT_WIDTH}px}`,
    `.name{margin:0;color:var(--${pal.ink});font-family:var(--font-${display?.family});font-weight:${display?.weight};font-size:${size}px;line-height:.95}`,
    `.tagline{margin:16px 0 0;color:var(--${pal.muted});font-family:var(--font-${body?.family});font-size:14px;line-height:1.3}`,
  ].join("\n");

  const derivation = [
    `Blocks: ${Object.entries(LAYOUT)
      .map(
        ([role, [, , w, h]]) =>
          `${role} ${picks[/** @type {keyof typeof picks} */ (role)]} ${w}x${h}`,
      )
      .join(
        ", ",
      )} units of ${unit}px; each at full value and at least ${MIN_VISIBLE} OKLab from ${pal.ground} in both modes.`,
    `Arrangement: one tall slab bleeding off the top with satellites, the accent bleeding off the right and the ink off the bottom, all right of x = ${SPLIT}.`,
    `Pattern: ${dots.length} discs of ${dotSize}px on a ${2 * unit}px lattice in ${pal.accent}, chosen because the radius scale ends in large radii (${scale
      .map((r) => r.value)
      .slice(-3)
      .join(", ")}px).`,
    `Steps and radii: unit ${unit}px (the largest spacing step), dots ${dotSize}px, block corners radius-${corner?.name} (${cornerValue}px); name ${size}px in ${display?.family} ${display?.weight}.`,
  ];
  const html = [
    `<!-- @dsCard height=${height} -->`,
    `<style>\n${css}\n</style>`,
    '<div class="cover">',
    `<!--\n${derivation.join("\n")}\n-->`,
    `<svg class="art" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" aria-hidden="true">`,
    ...rects,
    ...dots,
    "</svg>",
    '<div class="text">',
    `<h1 class="name">${lines.join(" ")}</h1>`,
    `<p class="tagline">${TAGLINE}</p>`,
    "</div>",
    "</div>",
    "",
  ].join("\n");
  return { html, problems };
}
