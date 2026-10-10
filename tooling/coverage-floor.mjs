// @ts-check
// Coverage floor (docs/testing.md § Coverage floor).
//
// tooling/coverage-floor.json lists the modules that hold a critical rule,
// per area, with the line and branch coverage each must keep. The floor is
// fail-closed: a summary that is missing, or a listed module the summary does
// not mention, fails the same as one below its floor, so a run that measured
// nothing cannot pass.
//
//   node tooling/coverage-floor.mjs <backend|core>
//       compare the area's coverage summary with its floors;
//   node tooling/coverage-floor.mjs <backend|core> --record
//       set each listed module's floor to its coverage now, rounded down,
//       less SLACK points: a DO alarm racing a test moves a branch or two
//       between runs, and a floor that flakes is noise. A deleted test moves
//       a module by far more. Only in a PR that means to move a floor.
//
// backend reads istanbul's json-summary (`pnpm --filter spjall-backend
// coverage`); core reads `cargo llvm-cov --json --summary-only`, where
// regions stand in for branches (branch coverage needs a nightly toolchain).

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { readJson, ROOT } from "./lib/repo.mjs";

const FLOORS = "tooling/coverage-floor.json";
const SLACK = 1;

/** @typedef {{ lines: number, branches: number }} Coverage */
/** @typedef {{ summary: string, format: "istanbul" | "llvm-cov", modules: Record<string, Coverage> }} Area */

/**
 * Per-file coverage from either tool, keyed by path from the repo root.
 *
 * @param {Area["format"]} format
 * @param {any} summary
 * @param {string} root
 * @returns {Map<string, Coverage>}
 */
export function readSummary(format, summary, root) {
  const key = (/** @type {string} */ file) => (isAbsolute(file) ? relative(root, file) : file);
  /** @type {Map<string, Coverage>} */
  const files = new Map();
  if (format === "istanbul") {
    for (const [file, c] of Object.entries(summary)) {
      if (file !== "total") files.set(key(file), { lines: c.lines.pct, branches: c.branches.pct });
    }
  } else {
    for (const f of summary.data?.[0]?.files ?? []) {
      files.set(key(f.filename), {
        lines: f.summary.lines.percent,
        branches: f.summary.regions.percent,
      });
    }
  }
  return files;
}

/**
 * @param {string} name
 * @param {Area} area
 * @param {Map<string, Coverage>} measured
 * @returns {string[]}
 */
export function checkArea(name, area, measured) {
  /** @type {string[]} */
  const problems = [];
  if (Object.keys(area.modules).length === 0) problems.push(`${name}: no modules listed`);
  for (const [module, floor] of Object.entries(area.modules)) {
    const now = measured.get(module);
    if (!now) {
      problems.push(`${name}: ${module} has no coverage data (renamed, or not run by the tests?)`);
      continue;
    }
    for (const kind of /** @type {const} */ (["lines", "branches"])) {
      if (now[kind] < floor[kind]) {
        problems.push(
          `${name}: ${module} ${kind} ${now[kind].toFixed(2)}% is below its floor of ${floor[kind]}%`,
        );
      }
    }
  }
  return problems;
}

/** @param {string[]} argv */
function main(argv) {
  const [name, flag] = argv;
  const floors = /** @type {Record<string, Area>} */ (readJson(FLOORS));
  const area = name && !name.startsWith("$") ? floors[name] : undefined;
  if (!name || !area) {
    const areas = Object.keys(floors).filter((k) => !k.startsWith("$"));
    console.error(`usage: coverage-floor.mjs <${areas.join("|")}> [--record]`);
    process.exit(2);
  }
  const path = join(ROOT, area.summary);
  if (!existsSync(path)) {
    console.error(`::error file=${FLOORS}::${name}: no coverage summary at ${area.summary}`);
    process.exit(1);
  }
  const measured = readSummary(area.format, JSON.parse(readFileSync(path, "utf8")), ROOT);

  if (flag === "--record") {
    for (const module of Object.keys(area.modules)) {
      const now = measured.get(module);
      if (!now) throw new Error(`${module} has no coverage data`);
      const floor = (/** @type {number} */ pct) => Math.max(0, Math.floor(pct) - SLACK);
      area.modules[module] = { lines: floor(now.lines), branches: floor(now.branches) };
    }
    writeFileSync(join(ROOT, FLOORS), `${JSON.stringify(floors, null, 2)}\n`);
    console.log(`recorded ${Object.keys(area.modules).length} floors for ${name}`);
    return;
  }
  const problems = checkArea(name, area, measured);
  if (problems.length > 0) {
    for (const p of problems) console.error(`::error file=${FLOORS}::${p}`);
    process.exit(1);
  }
  console.log(`✓ ${Object.keys(area.modules).length} ${name} modules at or above their floor`);
}

if (import.meta.main) main(process.argv.slice(2));
