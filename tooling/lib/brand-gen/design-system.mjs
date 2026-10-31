// @ts-check
// A brand as the files of a read-only design-system page (docs/design-system.md). Pure: the
// CLI reads the brand and the source scans and writes what this returns, so a test feeds it
// fixtures. Nothing here publishes; the files land in private/ for a person to hand over.

import { cover } from "../design-system/cover.mjs";
import { readme } from "../design-system/readme.mjs";
import { tokensCss, tokensJson } from "../design-system/tokens.mjs";
import { validateTokens } from "../design-system/validate.mjs";
import { woff2 } from "./woff2.mjs";
import { woff2Name } from "./web.mjs";

/**
 * @typedef {import("./strings.mjs").BrandInput} BrandInput
 * @typedef {import("../design-system/scan.mjs").Scan} Scan
 * @typedef {{ path: string, content: string | Buffer }} File
 * @typedef {{
 *   brand: BrandInput,
 *   pairs: { pairs: Array<{ fg: string, bg: string, level: any, use: string }> },
 *   scan: Scan,
 *   sha: string,
 *   tokensSha256: string,
 *   at: string,
 *   by: string,
 *   iconBlob?: string,
 * }} Input
 */

/** The file name the icon is filed under in the Logos group. */
const iconName = (/** @type {BrandInput} */ brand) =>
  String(brand.manifest.icon?.foreground ?? "icon.svg")
    .split("/")
    .pop() ?? "icon.svg";

/**
 * @param {Input} input
 * @returns {{ files: File[], problems: string[] }}
 */
export function designSystem({ brand, pairs, scan, sha, tokensSha256, at, by, iconBlob }) {
  const displayName = brand.manifest.displayName;
  const json = tokensJson(brand, pairs, { commit: sha, tokensSha256 });
  const problems = validateTokens(json);
  const art = cover(brand, pairs);
  problems.push(...art.problems);

  const logo = `assets/Logos/${iconName(brand)}`;
  const ink = /fill="(#[0-9a-fA-F]{3,8})"/.exec(brand.iconSvg)?.[1];
  const index = {
    v: 3,
    layout: "files",
    createdOnFiles: { v: 1, at },
    title: `${displayName} design system`,
    namespace: `${displayName.replace(/[^A-Za-z0-9]/g, "")}DS`,
    libraries: [],
    sections: {},
    groups: [],
    assetGroups: {
      Logos: {
        name: "Logos",
        tile: "l",
        order: iconBlob ? [logo] : [],
        files: iconBlob
          ? {
              [logo]: {
                name: iconName(brand),
                blob: iconBlob,
                size: Buffer.byteLength(brand.iconSvg),
                type: "image/svg+xml",
              },
            }
          : {},
      },
    },
    blobs: {},
    docs: { sections: [] },
    editing: "code",
    lastChange: {
      by,
      at,
      via: `tooling/design-system.mjs @ ${sha.slice(0, 7)}`,
      note: `Exported from ${brand.name}'s tokens`,
    },
  };

  /** @type {File[]} */
  const files = [
    { path: "project/design-system.json", content: `${JSON.stringify(index, null, 2)}\n` },
    { path: "project/tokens.json", content: `${JSON.stringify(json, null, 2)}\n` },
    { path: "project/tokens.css", content: tokensCss(json) },
    { path: "project/README.md", content: readme(brand, pairs, scan) },
    { path: "project/components/Cover/preview.html", content: art.html },
  ];
  if (iconBlob && ink)
    files.push({
      path: "project/assets/Logos/README.md",
      content: `The mark is a single ink, \`${ink}\`, read from the SVG's fill.\n`,
    });
  const licences = new Set();
  for (const font of brand.fonts) {
    files.push({ path: `project/fonts/${woff2Name(font.fileName)}`, content: woff2(font.bytes) });
    if (!licences.has(font.licenseName)) {
      licences.add(font.licenseName);
      files.push({
        path: `project/fonts/${font.licenseName}`,
        content: `${font.license.trimEnd()}\n`,
      });
    }
  }
  const duplicates = files.map((f) => f.path).filter((p, i, all) => all.indexOf(p) !== i);
  for (const p of new Set(duplicates)) problems.push(`two files write ${p}`);
  return { files, problems };
}
