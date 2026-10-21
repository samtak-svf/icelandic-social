// @ts-check
// Every module a page needs at load is in its <link rel="modulepreload"> list.
//
// TanStack Start writes each route's preloads as its chunk and that chunk's
// direct imports, one level deep. A module two levels down is found only
// after the browser has fetched and parsed the module above it: one more
// round trip before the app runs (570 ms on a Slow 4G phone profile, measured
// 2026-10-21). This reads the built manifest and the client chunks after
// `cf build`, and fails when the static import closure of a page's preloads
// reaches a file the page does not preload.
//
//   node tooling/preload-check.mjs [<output dir>]

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "./lib/repo.mjs";

const OUTPUT = join(ROOT, "backend/.cloudflare/output/v0/workers/default");

/**
 * @typedef {{ preloads?: string[], children?: string[] }} RouteEntry
 * @typedef {{ routes: Record<string, RouteEntry> }} Manifest
 */

/**
 * The relative files a built chunk imports statically. Dynamic `import()`
 * is left out: the router loads those when it needs them.
 *
 * @param {string} code
 * @returns {string[]}
 */
export function staticImports(code) {
  const out = [];
  for (const m of code.matchAll(
    /(?:^|[;}\n])\s*(?:import|export)\s*(?:[^"'();]*?\bfrom\s*)?["'](\.\.?\/[^"']+)["']/g,
  ))
    out.push(/** @type {string} */ (m[1]));
  return out;
}

/**
 * Each route's chain from the root, as its routes' ids.
 *
 * @param {Manifest} manifest
 * @returns {string[][]}
 */
function chains(manifest) {
  /** @type {string[][]} */
  const out = [];
  /** @param {string} id @param {string[]} above */
  const walk = (id, above) => {
    const chain = [...above, id];
    const children = manifest.routes[id]?.children ?? [];
    if (children.length === 0) out.push(chain);
    for (const child of children) walk(child, chain);
  };
  walk("__root__", []);
  return out;
}

/**
 * @param {Manifest} manifest
 * @param {(href: string) => string | undefined} read a client file's code by its URL path
 * @returns {string[]} problems
 */
export function check(manifest, read) {
  /** @type {string[]} */
  const problems = [];
  for (const chain of chains(manifest)) {
    const preloaded = new Set(chain.flatMap((id) => manifest.routes[id]?.preloads ?? []));
    const queue = [...preloaded];
    const seen = new Set(queue);
    while (queue.length > 0) {
      const href = /** @type {string} */ (queue.shift());
      const code = read(href);
      if (code === undefined) {
        problems.push(`${chain.at(-1)}: ${href} is preloaded but not in the build`);
        continue;
      }
      for (const rel of staticImports(code)) {
        const target = new URL(rel, `https://x${href}`).pathname;
        if (seen.has(target)) continue;
        seen.add(target);
        queue.push(target);
        if (!preloaded.has(target))
          problems.push(`${chain.at(-1)}: ${target} is imported by ${href} but not preloaded`);
      }
    }
  }
  return problems;
}

/** @param {string} output */
async function load(output) {
  const dir = join(output, "bundle/assets");
  const file = existsSync(dir)
    ? readdirSync(dir).find((f) => /^_tanstack-start-manifest_v-.*\.js$/.test(f))
    : undefined;
  if (!file)
    throw new Error(
      `no start manifest under ${dir}; run \`pnpm --filter spjall-backend build\` first`,
    );
  const mod = await import(pathToFileURL(join(dir, file)).href);
  return /** @type {Manifest} */ (mod.tsrStartManifest());
}

async function main() {
  const output = process.argv[2] ?? OUTPUT;
  const manifest = await load(output);
  const routes = Object.keys(manifest.routes).length;
  if (routes < 2) throw new Error(`the manifest lists ${routes} route(s); nothing to check`);
  const problems = check(manifest, (href) => {
    const path = join(output, "assets", href);
    return existsSync(path) ? readFileSync(path, "utf8") : undefined;
  });
  for (const p of problems) console.error(`::error::${p}`);
  if (problems.length > 0) {
    console.error(`\n❌ ${problems.length} module(s) a page loads are not preloaded`);
    process.exit(1);
  }
  console.log(`✓ every page's static imports are preloaded (${routes} routes)`);
}

if (import.meta.main) await main();
