// @ts-check
// The Worker serves the integrity of every file the page loads (decisions
// 0064, 0081).
//
// web/integrity.ts hashes the client build into the server bundle, and the
// page response is stamped from that map. A file the map lacks loads with no
// integrity, and a stale hash stops the page from loading at all. This reads
// the built server bundle after `cf build` and fails unless its map names
// every script, style and wasm file of the client output, with that file's
// SHA-384, and nothing else.
//
//   node tooling/sri-check.mjs [<output dir>]

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { ROOT } from "./lib/repo.mjs";

const OUTPUT = join(ROOT, "backend/.cloudflare/output/v0/workers/default");
const HASHED = /\.(?:m?js|css|wasm)$/;

/**
 * The integrity map as the server bundle carries it.
 *
 * @param {string} code
 * @returns {Map<string, string>}
 */
export function servedHashes(code) {
  const out = new Map();
  for (const m of code.matchAll(/"(\/[^"]+)":\s*"(sha384-[A-Za-z0-9+/=]+)"/g))
    out.set(/** @type {string} */ (m[1]), /** @type {string} */ (m[2]));
  return out;
}

/** @param {Uint8Array} bytes */
export const sri = (bytes) => `sha384-${createHash("sha384").update(bytes).digest("base64")}`;

/**
 * @param {Map<string, string>} served the map in the server bundle
 * @param {Map<string, Uint8Array>} files every hashed client file, by URL path
 * @returns {string[]} problems
 */
export function check(served, files) {
  /** @type {string[]} */
  const problems = [];
  for (const [path, bytes] of files) {
    const want = sri(bytes);
    const got = served.get(path);
    if (got === undefined) problems.push(`${path} is served with no integrity`);
    else if (got !== want) problems.push(`${path}: the served integrity is not the file's`);
  }
  for (const path of served.keys())
    if (!files.has(path)) problems.push(`${path} has an integrity but is not in the build`);
  return problems;
}

/** @param {string} dir @returns {string[]} */
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}

function main() {
  const output = process.argv[2] ?? OUTPUT;
  const bundle = join(output, "bundle/index.js");
  if (!existsSync(bundle))
    throw new Error(
      `no server bundle at ${bundle}; run \`pnpm --filter spjall-backend build\` first`,
    );
  const assets = join(output, "assets");
  /** @type {Map<string, Uint8Array>} */
  const files = new Map();
  for (const path of walk(assets))
    if (HASHED.test(path)) files.set(`/${relative(assets, path)}`, readFileSync(path));
  if (files.size === 0) throw new Error(`no scripts or styles under ${assets}; nothing to check`);
  const problems = check(servedHashes(readFileSync(bundle, "utf8")), files);
  for (const p of problems) console.error(`::error::${p}`);
  if (problems.length > 0) {
    console.error(`\n❌ ${problems.length} file(s) are not served with their integrity`);
    process.exit(1);
  }
  console.log(
    `✓ every script, style and wasm file is served with its integrity (${files.size} files)`,
  );
}

if (import.meta.main) main();
