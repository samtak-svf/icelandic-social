// @ts-check
// Test fixtures: a throwaway copy of the parts of the repo a guard reads, so
// each test can break exactly one thing and watch the guard fail on it.

import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "../lib/repo.mjs";

/**
 * @param {string[]} paths repo-relative files or directories to copy
 * @returns {string} the copy's root
 */
export function copyRepo(paths) {
  const dir = mkdtempSync(join(tmpdir(), "spjall-guard-"));
  for (const path of paths) cpSync(join(ROOT, path), join(dir, path), { recursive: true });
  return dir;
}

/**
 * @param {string} root
 * @param {string} relPath
 * @param {(json: any) => void} mutate
 */
export function editJson(root, relPath, mutate) {
  const path = join(root, relPath);
  const json = JSON.parse(readFileSync(path, "utf8"));
  mutate(json);
  writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`);
}

/**
 * @param {string} root
 * @param {string[]} args
 */
export function git(root, args) {
  return execFileSync(
    "git",
    [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "-c",
      "core.hooksPath=/dev/null",
      ...args,
    ],
    {
      cwd: root,
      encoding: "utf8",
    },
  );
}

/** @param {string} root */
export function initRepo(root) {
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["add", "."]);
  git(root, ["commit", "-q", "-m", "base"]);
}
