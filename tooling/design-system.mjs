// @ts-check
// Exports a brand as the files of a read-only design-system page (docs/design-system.md):
//
//   node tooling/design-system.mjs [--brand <name>] [--icon-blob <id>] [--out <dir>]
//
// It writes `<out>/project/...`, `<out>/publish.json` (the `files` map and the totals of one
// publish) and `<out>/icon/<file>` (the mark, to upload as the page's asset). It never
// publishes. The default `<out>` is `private/design-system/<brand>/` of the primary checkout,
// so a worktree does not leave its output behind. Exit 1 names every problem.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { loadBrand } from "./brand-gen.mjs";
import { checkBrand } from "./brand-check.mjs";
import { designSystem } from "./lib/brand-gen/design-system.mjs";
import { radii, spacing, typeStyles } from "./lib/brand-gen/color.mjs";
import { adHocSizes, wiredStatus } from "./lib/design-system/scan.mjs";
import { publishManifest } from "./lib/design-system/validate.mjs";
import { ROOT, brandNames, git, readJson } from "./lib/repo.mjs";

/** Where each platform's reader code lives, and the extensions that count as source. */
const SOURCES = {
  android: { dir: "android/app/src/main/kotlin", ext: /\.kt$/ },
  ios: { dir: "ios/App", ext: /\.swift$/ },
  web: { dir: "web/src", ext: /\.(tsx?|css)$/ },
};
/** Component folders listed in the inventory. */
const INVENTORY = [
  "web/src/ui",
  "web/src/social",
  "android/app/src/main/kotlin/samtak/spjall/ui",
  "ios/App/UI",
];
const NOT_SOURCE = /(^|\/)(generated|node_modules|build)\/|\.test\.|Tests?\.|(^|\/)tests?\//;

/**
 * @param {string} dir absolute
 * @param {RegExp} ext
 * @returns {string[]} absolute paths of source files, tests and generated files left out
 */
function walk(dir, ext) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && ext.test(e.name))
    .map((e) => join(e.parentPath, e.name))
    .filter((p) => !NOT_SOURCE.test(p.slice(ROOT.length)));
}

/** @param {string} root */
function scanSources(root) {
  const read = (/** @type {{ dir: string, ext: RegExp }} */ s) =>
    walk(join(root, s.dir), s.ext)
      .map((p) => readFileSync(p, "utf8"))
      .join("\n");
  return {
    android: read(SOURCES.android),
    ios: read(SOURCES.ios),
    web: read(SOURCES.web),
  };
}

/**
 * @param {string} root
 * @param {any} tokens
 * @returns {import("./lib/design-system/scan.mjs").Scan}
 */
function scan(root, tokens) {
  const src = scanSources(root);
  const names = {
    radius: radii(tokens).map((r) => r.name),
    type: typeStyles(tokens).map((s) => s.name),
    spacing: spacing(tokens).map((s) => s.name),
  };
  return {
    wired: wiredStatus(names, src),
    inventory: Object.fromEntries(
      INVENTORY.map((dir) => [
        dir,
        walk(join(root, dir), /\.(tsx?|kt|swift)$/)
          .map((p) => basename(p))
          .sort(),
      ]),
    ),
    adHoc: adHocSizes(src),
  };
}

/** @param {string[]} argv @param {string} flag */
const option = (argv, flag) => {
  const at = argv.indexOf(flag);
  return at >= 0 ? argv[at + 1] : undefined;
};

function main() {
  const argv = process.argv.slice(2);
  const name = option(argv, "--brand") ?? brandNames().find((n) => !n.startsWith("_"));
  const iconBlob = option(argv, "--icon-blob");
  if (!name) return fail(["no brand found under brand/"]);

  const checked = checkBrand(name);
  if (checked.problems.length > 0) return fail(checked.problems.map((p) => `brand/${name}: ${p}`));

  const primary = resolve(
    dirname(git(["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim()),
  );
  const out = resolve(option(argv, "--out") ?? join(primary, "private/design-system", name));
  const brand = loadBrand(name);
  const tokensText = readFileSync(join(ROOT, "brand", name, "tokens.json"), "utf8");
  const result = designSystem({
    brand,
    pairs: readJson("brand/contrast-pairs.json"),
    scan: scan(ROOT, brand.tokens),
    sha: git(["rev-parse", "HEAD"]).trim(),
    tokensSha256: createHash("sha256").update(tokensText).digest("hex"),
    at: new Date().toISOString(),
    by: "design-system export",
    iconBlob,
  });
  const manifest = publishManifest(result.files);
  const problems = [...result.problems, ...manifest.problems];
  if (problems.length > 0) return fail(problems);

  // Only this export's own folder is cleared; anything else under <out> is somebody's.
  rmSync(join(out, "project"), { recursive: true, force: true });
  for (const file of result.files) {
    const target = join(out, file.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.content);
  }
  writeFileSync(join(out, "publish.json"), `${JSON.stringify(manifest.json, null, 2)}\n`);
  const icon = String(brand.manifest.icon?.foreground ?? "icon.svg");
  mkdirSync(join(out, "icon"), { recursive: true });
  writeFileSync(join(out, "icon", basename(icon)), brand.iconSvg);
  console.log(`✓ ${manifest.json.count} files, ${manifest.json.bytes} bytes → ${out}`);
}

/** @param {string[]} problems */
function fail(problems) {
  for (const p of problems) console.error(`✗ ${p}`);
  console.error(`\n${problems.length} problem(s); nothing was written.`);
  process.exit(1);
}

if (import.meta.main) main();
