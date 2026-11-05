// @ts-check
// Kotlin and Swift style, checked before a push instead of after a remote build.
//
// The Android and iOS builds run on a Mac of our own (tooling/mac-remote.mjs); a
// local Gradle daemon is banned because it fills swap. ktlint and detekt are
// plain command-line tools and need neither, so this runs them over the Kotlin
// files the branch changed since it left main. swift-format does the same for
// ios/ where it is installed (macOS or a Swift toolchain).
//
// A tool that is not on PATH is not a failure: the guard prints the CI job that
// checks the files instead and exits 0. Install notes: docs/commands.md § Native lint.
//
//   node tooling/native-lint.mjs                     files changed since the merge base with origin/main
//   node tooling/native-lint.mjs --files a.kt b.kt   these files, for a test or a spot check

import { spawnSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";
import { git, ROOT } from "./lib/repo.mjs";

const KOTLIN_ROOTS = ["android/app/", "android/core/"];
const DETEKT_CONFIG = "android/config/detekt.yml";

/**
 * @param {string} name
 * @returns {boolean} whether an executable of that name is on PATH
 */
export function onPath(name) {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    try {
      accessSync(join(dir, name), constants.X_OK);
      return true;
    } catch {}
  }
  return false;
}

/**
 * Files changed on this branch, committed or not: the working tree against the
 * merge base with main. Without a main to compare to, every tracked file.
 *
 * @returns {string[]}
 */
export function changedFiles() {
  for (const ref of ["origin/main", "main"]) {
    try {
      const base = git(["merge-base", ref, "HEAD"]).trim();
      return git(["diff", "--name-only", "--diff-filter=ACMR", "-z", base])
        .split("\0")
        .filter(Boolean);
    } catch {}
  }
  return git(["ls-files", "-z"]).split("\0").filter(Boolean);
}

/**
 * The hand-written Kotlin among the files. Generated code and build output are
 * checked by their generator; androidTest is not detekt's (see detektFiles).
 *
 * @param {string[]} files
 * @returns {string[]}
 */
export function kotlinFiles(files) {
  return files.filter(
    (f) =>
      /\.kts?$/.test(f) &&
      KOTLIN_ROOTS.some((root) => f.startsWith(root)) &&
      !/(^|\/)(build|generated)\//.test(f),
  );
}

/**
 * Gradle's detekt task reads src/main and src/test only, so the same files here.
 *
 * @param {string[]} kotlin
 * @returns {string[]}
 */
export function detektFiles(kotlin) {
  return kotlin.filter((f) => /\/src\/(main|test)\//.test(f));
}

/**
 * @param {string[]} files
 * @returns {boolean} whether a change needs the Swift check
 */
export function touchesSwift(files) {
  return files.some(
    (f) => f.startsWith("ios/") && (/\.swift$/.test(f) || f.endsWith(".swift-format")),
  );
}

/**
 * @param {string} command
 * @param {string[]} args
 * @returns {boolean} whether it exited 0
 */
function run(command, args) {
  console.log(
    `$ ${command} ${args.length > 3 ? `${args.slice(0, 2).join(" ")} ...` : args.join(" ")}`,
  );
  const result = spawnSync(command, args, { cwd: ROOT, stdio: "inherit" });
  return result.status === 0;
}

/**
 * @param {string[]} files
 * @returns {boolean} whether every check that could run passed
 */
export function lint(files) {
  let ok = true;
  const kotlin = kotlinFiles(files);
  if (kotlin.length > 0) {
    if (onPath("ktlint")) {
      console.log(`native-lint: ktlint over ${kotlin.length} Kotlin file(s)`);
      ok = run("ktlint", kotlin) && ok;
    } else {
      console.log(
        `native-lint: ${kotlin.length} Kotlin file(s) changed, ktlint not installed; the android workflow checks them`,
      );
    }
    const detekt = detektFiles(kotlin);
    if (detekt.length === 0) {
      console.log("native-lint: detekt has no src/main or src/test file to read");
    } else if (onPath("detekt")) {
      console.log(`native-lint: detekt over ${detekt.length} Kotlin file(s)`);
      ok =
        run("detekt", [
          "--build-upon-default-config",
          "-c",
          DETEKT_CONFIG,
          "-i",
          detekt.join(delimiter),
        ]) && ok;
    } else {
      console.log(
        `native-lint: ${detekt.length} Kotlin file(s) changed, detekt not installed; the android workflow checks them`,
      );
    }
  }
  if (touchesSwift(files)) {
    if (onPath("swift-format") || onPath("xcrun")) {
      console.log("native-lint: swift-format over ios/");
      ok = run("ios/scripts/lint.sh", []) && ok;
    } else {
      console.log(
        "native-lint: Swift changed, swift-format not installed; the ios workflow checks it",
      );
    }
  }
  if (kotlin.length === 0 && !touchesSwift(files)) {
    console.log("native-lint: no Kotlin or Swift file changed, nothing to check");
  }
  return ok;
}

function main() {
  const at = process.argv.indexOf("--files");
  const files = at === -1 ? changedFiles() : process.argv.slice(at + 1);
  if (!lint(files)) {
    console.error("✗ native-lint: fix the style errors above; ktlint -F rewrites most of them");
    process.exit(1);
  }
}

if (import.meta.main) main();
