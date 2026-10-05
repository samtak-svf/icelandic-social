// @ts-check
// Shared plumbing for the guards: where the repo is, which files git can see,
// and JSON reading with the path in the error. Kept dependency-free so every
// guard stays runnable with plain `node` before `pnpm install`.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute path of the repository root, independent of the caller's cwd. */
export const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/**
 * @param {string} relPath path relative to the repository root
 * @param {string} [root]
 * @returns {any}
 */
export function readJson(relPath, root = ROOT) {
  const text = readFileSync(join(root, relPath), "utf8");
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${relPath}: not valid JSON (${/** @type {Error} */ (error).message})`, {
      cause: error,
    });
  }
}

/**
 * The environment without GIT_* variables, so git finds its repository from
 * `cwd`. A hook run from a worktree exports GIT_DIR, which would otherwise
 * point every call, including ones aimed at a test fixture, at the real repo.
 */
export const GIT_ENV = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
);

/**
 * @param {string[]} args
 * @param {string} [cwd]
 */
export function git(args, cwd = ROOT) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: GIT_ENV,
    maxBuffer: 64 * 1024 * 1024,
  });
}

/**
 * Files git knows about plus untracked files that are not ignored: the set
 * that can reach history with the next `git add`. Scanning only tracked files
 * would let a new file through until the commit after it was added.
 *
 * @param {string} [cwd]
 * @returns {string[]}
 */
export function visibleFiles(cwd = ROOT) {
  return git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"], cwd)
    .split("\0")
    .filter(Boolean)
    .filter((file) => existsSync(join(cwd, file)));
}

/**
 * Files staged for the current commit, for pre-commit hooks.
 *
 * @param {string} [cwd]
 * @returns {string[]}
 */
export function stagedFiles(cwd = ROOT) {
  return git(["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"], cwd)
    .split("\0")
    .filter(Boolean);
}

/**
 * Every brand directory: a direct child of `brand/` holding a `brand.json`.
 *
 * @param {string} [root]
 * @returns {string[]}
 */
export function brandNames(root = ROOT) {
  return readdirSync(join(root, "brand"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(join(root, "brand", name, "brand.json")))
    .sort();
}

/**
 * Every string inside a JSON value, with its JSON Pointer, for guards that
 * judge text rather than structure.
 *
 * @param {unknown} value
 * @param {string} [pointer]
 * @returns {Generator<{ pointer: string, text: string }>}
 */
export function* jsonStrings(value, pointer = "") {
  if (typeof value === "string") {
    yield { pointer: pointer || "/", text: value };
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    yield* jsonStrings(child, `${pointer}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`);
  }
}
