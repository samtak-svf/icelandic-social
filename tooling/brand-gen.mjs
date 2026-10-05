// @ts-check
// Brand generation (docs/decisions/0004): brand/<name>/ in, committed
// platform files out. The apps and the Worker read only these outputs, never
// brand/ itself, so switching brand is `BRAND=<name> pnpm brand:gen` plus the
// diff it produces.
//
//   node tooling/brand-gen.mjs          write the outputs for BRAND (default: the only real brand)
//   node tooling/brand-gen.mjs --check  fail if any output is stale, missing or extra
//
// A brand that tooling/brand-check.mjs rejects generates nothing. Outputs are
// listed in tooling/lib/brand-gen/paths.mjs; every byte, icons included, is
// deterministic so --check can compare exactly.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { checkBrand } from "./brand-check.mjs";
import { android } from "./lib/brand-gen/android.mjs";
import { backend } from "./lib/brand-gen/backend.mjs";
import { ios } from "./lib/brand-gen/ios.mjs";
import { activeBrand, OWNED_DIRS } from "./lib/brand-gen/paths.mjs";
import { readJson, ROOT } from "./lib/repo.mjs";

/**
 * @typedef {import("./lib/brand-gen/strings.mjs").OutputFile} OutputFile
 */

/**
 * Every output for one brand, or the reasons it cannot generate.
 *
 * @param {string} name
 * @param {string} [root]
 * @returns {{ problems: string[], files: OutputFile[] }}
 */
export function generate(name, root = ROOT) {
  if (!existsSync(join(root, "brand", name, "brand.json")))
    return { problems: [`brand/${name}: no such brand`], files: [] };
  const { problems } = checkBrand(name, root);
  if (problems.length > 0) return { problems, files: [] };
  const dir = `brand/${name}`;
  const manifest = readJson(`${dir}/brand.json`, root);
  const brand = {
    name,
    manifest,
    strings: readJson(`${dir}/strings.is.json`, root),
    contract: readJson("brand/strings.contract.json", root),
    tokens: readJson(`${dir}/tokens.json`, root),
    ids: readJson("identifiers/ids.json", root),
    iconSvg: readFileSync(join(root, dir, manifest.icon.foreground), "utf8"),
  };
  const files = [...android(brand), ...ios(brand), ...backend(brand)];
  return { problems: [], files: files.sort((a, b) => a.path.localeCompare(b.path)) };
}

/**
 * Files on disk under the owned directories, repo-relative.
 *
 * @param {string} root
 * @returns {string[]}
 */
function ownedOnDisk(root) {
  return OWNED_DIRS.flatMap((dir) =>
    existsSync(join(root, dir))
      ? readdirSync(join(root, dir), { recursive: true, withFileTypes: true })
          .filter((entry) => entry.isFile())
          .map(
            (entry) =>
              `${join(entry.parentPath, entry.name).slice(root.length).replace(/^\/+/, "")}`,
          )
      : [],
  );
}

/**
 * Writes the outputs (removing strays in owned directories) or, with
 * `check`, lists what differs from them.
 *
 * @param {{ name: string, check: boolean, root?: string }} options
 * @returns {{ problems: string[], stale: string[], written: number }}
 */
export function run({ name, check, root = ROOT }) {
  const { problems, files } = generate(name, root);
  if (problems.length > 0) return { problems, stale: [], written: 0 };
  const wanted = new Set(files.map((f) => f.path));
  const strays = ownedOnDisk(root).filter((path) => !wanted.has(path));
  if (check) {
    const stale = files
      .filter(({ path, content }) => {
        const full = join(root, path);
        return !existsSync(full) || !readFileSync(full).equals(Buffer.from(content));
      })
      .map((f) => f.path);
    return {
      problems: [],
      stale: [...stale, ...strays.map((p) => `${p} (not generated)`)],
      written: 0,
    };
  }
  for (const path of strays) rmSync(join(root, path));
  for (const { path, content } of files) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return { problems: [], stale: [], written: files.length };
}

function main() {
  const name = activeBrand();
  const check = process.argv.includes("--check");
  const { problems, stale, written } = run({ name, check });
  if (problems.length > 0) {
    for (const p of problems) console.error(`::error file=brand/${name}::${p}`);
    console.error(`\nbrand/${name} does not pass tooling/brand-check.mjs; nothing was generated.`);
    process.exit(1);
  }
  if (!check) {
    console.log(`wrote ${written} file(s) for brand/${name}`);
    return;
  }
  if (stale.length > 0) {
    for (const path of stale) console.error(`::error file=${path}::stale brand output`);
    console.error(
      `\n❌ ${stale.length} output(s) differ from brand/${name}. Run \`pnpm brand:gen\` and commit.`,
    );
    process.exit(1);
  }
  console.log(`✓ brand outputs match brand/${name}`);
}

if (import.meta.main) main();
