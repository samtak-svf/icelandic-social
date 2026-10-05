// @ts-check
// Core artifact guard (decision 0002, plan PR 5).
//
// 1. `core/artifact.lock.json` has the shape `cargo xtask fetch` relies on:
//    before the first publish `version` is null and nothing is pinned; after
//    it, both platforms are pinned by file name and a 64-hex SHA-256, and
//    `baseUrl` is https with `{version}` where the version goes (decision
//    0013). A lock is only ever moved by a PR, never by CI.
// 2. No Gradle or Xcode build file calls cargo. The apps read the core from
//    `android/core/crypto/libs/` and `ios/Packages/SpjallCore/`, which
//    `cargo xtask core <platform>` or `cargo xtask fetch <platform>` fill;
//    a build that shells out to cargo would need a Rust toolchain on every
//    machine that builds an app.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, readJson, visibleFiles } from "./lib/repo.mjs";

const LOCK = "core/artifact.lock.json";
const PLATFORMS = ["android", "ios"];
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
  const state = lock.version === null ? unpublished(lock, artifacts) : published(lock, artifacts);
  return [...problems, ...state];
}

/**
 * @param {any} lock
 * @param {Record<string, any>} artifacts
 */
function unpublished(lock, artifacts) {
  /** @type {string[]} */
  const problems = [];
  if (Object.keys(artifacts).length > 0) problems.push("artifacts are pinned but version is null");
  if (lock.baseUrl !== null && !isHttps(lock.baseUrl)) {
    problems.push("baseUrl must be null or an https:// URL without a trailing slash");
  }
  return problems;
}

/**
 * @param {any} lock
 * @param {Record<string, any>} artifacts
 */
function published(lock, artifacts) {
  /** @type {string[]} */
  const problems = [];
  if (typeof lock.version !== "string" || !SEMVER.test(lock.version)) {
    problems.push(`version must be null or X.Y.Z, not ${JSON.stringify(lock.version)}`);
  }
  if (!isHttps(lock.baseUrl) || !lock.baseUrl.includes("{version}")) {
    problems.push(
      "a published version needs baseUrl, an https:// URL with {version} and no trailing slash",
    );
  }
  const pinned = Object.keys(artifacts).sort().join(",");
  if (pinned !== PLATFORMS.join(",")) {
    problems.push(`a published version pins both android and ios; found ${pinned || "none"}`);
  }
  for (const platform of PLATFORMS) {
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
  const lock = lockProblems(readJson(LOCK, root));
  const calls = visibleFiles(root)
    .filter((file) => GRADLE.test(file) || XCODE.test(file))
    .flatMap((file) => cargoCalls(file, readFileSync(join(root, file), "utf8")));
  return { lock, calls };
}

function main() {
  const { lock, calls } = findProblems();
  for (const problem of lock) console.error(`::error file=${LOCK}::${problem}`);
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
