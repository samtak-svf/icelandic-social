// @ts-check
// Core artifact guard (decision 0002, plan PR 5).
//
// 1. `core/artifact.lock.json` pins a published core, the only one app CI
//    uses (decision 0013): a version, both platforms by file name and a
//    64-hex SHA-256, and `baseUrl` https with `{version}` where the version
//    goes. A lock is only ever moved by a PR, never by CI.
// 2. No Gradle or Xcode build file calls cargo. The apps read the core from
//    `android/core/crypto/libs/` and `ios/Packages/SpjallCore/`, which
//    `cargo xtask core <platform>` or `cargo xtask fetch <platform>` fill;
//    a build that shells out to cargo would need a Rust toolchain on every
//    machine that builds an app.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, readJson, visibleFiles } from "./lib/repo.mjs";

const LOCK = "core/artifact.lock.json";
// The apps pin android and ios; the web module is pinned too once published,
// but a lock that predates it stays valid.
const PLATFORMS = ["android", "ios"];
const OPTIONAL_PLATFORMS = ["web"];
const WEB_TYPES = "web/src/generated/core.d.ts";
const WEB_TYPES_BUILT = "web/core/spjall_wasm.d.ts";
const SEMVER = /^\d+\.\d+\.\d+$/;
const SHA256 = /^[0-9a-f]{64}$/;

const GRADLE = /\.gradle(\.kts)?$/;
const XCODE = /(^|\/)(project\.yml|Package\.swift)$|\.(xcconfig|pbxproj)$/;
// Gradle runs a process from an argument list, so cargo appears as its own
// string ("cargo" or "cargo build …"). Xcode script phases are shell lines.
// An error message that merely tells a person to run cargo is neither.
const GRADLE_CARGO = /["']cargo(["']|\s)/;
const XCODE_CARGO = /(^|[\s;&|"'(])cargo\s+[a-z]/;

/**
 * @param {any} lock parsed lock
 * @returns {string[]} problems
 */
export function lockProblems(lock) {
  if (typeof lock !== "object" || lock === null || Array.isArray(lock)) {
    return ["the lock must be a JSON object"];
  }
  /** @type {string[]} */
  const problems = [];
  const keys = Object.keys(lock).sort().join(",");
  if (keys !== "androidNdk,artifacts,baseUrl,version") {
    problems.push(`keys must be androidNdk, artifacts, baseUrl, version; found ${keys || "none"}`);
  }
  if (typeof lock.androidNdk !== "string" || !SEMVER.test(lock.androidNdk)) {
    problems.push(`androidNdk must be an NDK release like 30.0.16248370`);
  }
  const artifacts = lock.artifacts ?? {};
  if (typeof artifacts !== "object" || Array.isArray(artifacts)) {
    return [...problems, "artifacts must be an object"];
  }
  return [...problems, ...published(lock, artifacts)];
}

/**
 * @param {any} lock
 * @param {Record<string, any>} artifacts
 */
function published(lock, artifacts) {
  /** @type {string[]} */
  const problems = [];
  if (typeof lock.version !== "string" || !SEMVER.test(lock.version)) {
    problems.push(`version must be X.Y.Z, not ${JSON.stringify(lock.version)}`);
  }
  if (!isHttps(lock.baseUrl) || !lock.baseUrl.includes("{version}")) {
    problems.push(
      "a published version needs baseUrl, an https:// URL with {version} and no trailing slash",
    );
  }
  const pinned = Object.keys(artifacts).sort().join(",");
  const accepted = [PLATFORMS, [...PLATFORMS, ...OPTIONAL_PLATFORMS]].map((list) => list.join(","));
  if (!accepted.includes(pinned)) {
    problems.push(`a published version pins both android and ios; found ${pinned || "none"}`);
  }
  for (const platform of [...PLATFORMS, ...OPTIONAL_PLATFORMS]) {
    if (artifacts[platform]) problems.push(...pinProblems(platform, artifacts[platform]));
  }
  return problems;
}

/**
 * @param {string} platform
 * @param {any} entry
 */
function pinProblems(platform, entry) {
  /** @type {string[]} */
  const problems = [];
  const file = `spjall-core-${platform}.zip`;
  if (entry.file !== file) problems.push(`artifacts.${platform}.file must be ${file}`);
  if (typeof entry.sha256 !== "string" || !SHA256.test(entry.sha256)) {
    problems.push(`artifacts.${platform}.sha256 must be 64 lowercase hex characters`);
  }
  const extra = Object.keys(entry).filter((key) => key !== "file" && key !== "sha256");
  if (extra.length > 0) problems.push(`artifacts.${platform} has unknown keys: ${extra}`);
  return problems;
}

/**
 * wasm-bindgen numbers its internal exports (`__wasm_bindgen_func_elem_6079`)
 * by the order the linker left them in, which differs between two builds of
 * the same source. The page never names them, so only the number is ignored:
 * an export added, removed or changed in shape still counts.
 *
 * @param {string} text
 */
function comparable(text) {
  return text.replaceAll(/__wasm_bindgen_func_elem_\d+/g, "__wasm_bindgen_func_elem_N");
}

/**
 * The committed declarations of the browser module must be what the build
 * emits, so the web client is typed against the module it will load. The
 * built file is gitignored: without it the comparison is skipped, except in
 * the CI web job (`requireBuilt`), which always builds it first.
 *
 * @param {string} [root]
 * @param {{ requireBuilt?: boolean }} [options]
 * @returns {string[]} problems
 */
export function webTypesProblems(root = ROOT, { requireBuilt = false } = {}) {
  const committed = join(root, WEB_TYPES);
  const built = join(root, WEB_TYPES_BUILT);
  if (!existsSync(committed)) {
    return [`${WEB_TYPES} is missing; run cargo xtask core web and copy ${WEB_TYPES_BUILT} there`];
  }
  if (!existsSync(built)) {
    return requireBuilt ? [`${WEB_TYPES_BUILT} is not built; run cargo xtask core web first`] : [];
  }
  if (comparable(readFileSync(committed, "utf8")) !== comparable(readFileSync(built, "utf8"))) {
    return [`${WEB_TYPES} is stale; run cargo xtask core web and copy ${WEB_TYPES_BUILT} over it`];
  }
  return [];
}

/** @param {unknown} url */
function isHttps(url) {
  return typeof url === "string" && /^https:\/\/[^/\s]+(\/[^\s]*[^/\s])?$/.test(url);
}

/**
 * @param {string} file repo-relative path
 * @param {string} source
 * @returns {{ file: string, line: number }[]}
 */
export function cargoCalls(file, source) {
  const pattern = GRADLE.test(file) ? GRADLE_CARGO : XCODE.test(file) ? XCODE_CARGO : null;
  if (!pattern) return [];
  return source
    .split("\n")
    .map((text, index) => ({ text: text.trim(), line: index + 1 }))
    .filter(({ text }) => !text.startsWith("//") && !text.startsWith("#") && pattern.test(text))
    .map(({ line }) => ({ file, line }));
}

/**
 * @param {string} [root]
 * @returns {{ lock: string[], calls: { file: string, line: number }[] }}
 */
export function findProblems(root = ROOT) {
  const lock = [
    ...lockProblems(readJson(LOCK, root)),
    ...webTypesProblems(root, { requireBuilt: process.env.CORE_WEB_BUILT === "1" }),
  ];
  const calls = visibleFiles(root)
    .filter((file) => GRADLE.test(file) || XCODE.test(file))
    .flatMap((file) => cargoCalls(file, readFileSync(join(root, file), "utf8")));
  return { lock, calls };
}

function main() {
  const { lock, calls } = findProblems();
  for (const problem of lock) console.error(`::error::${problem}`);
  for (const call of calls) {
    console.error(
      `::error file=${call.file},line=${call.line}::build files never call cargo; ` +
        "the core comes from cargo xtask core <platform> or cargo xtask fetch <platform>",
    );
  }
  if (lock.length + calls.length > 0) process.exit(1);
  console.log(`✓ ${LOCK} is well formed and no build file calls cargo`);
}

if (import.meta.main) main();
