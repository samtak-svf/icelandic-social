// @ts-check
// Puts a contract branch on main with nothing to edit by hand (#397).
//
//   node tooling/contract-rebase.mjs
//
// 1. Rebases on origin/main. A generated file never stops it (.gitattributes,
//    merge=generated keeps main's side), because the next step writes it anew. A
//    source file both sides changed still stops it: resolve that, `git rebase
//    --continue`, and run this again.
// 2. Moves the branch's own migrations above main's, in their order, so the order
//    of merging decides the order of migrating. Only a file that is not on main is
//    moved: cf records a migration by its file name, so an applied one stays put.
// 3. Regenerates the contract from the zod schemas and commits what moved.
//
// `openapi.ts --check`, `web-api.mjs --check` and `migration-guard --base` stay the
// gate: this only saves the steps, and a branch that skips it is refused there.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { git, GIT_ENV, ROOT } from "./lib/repo.mjs";
import { MIGRATIONS, migrationsAt, numberOf } from "./migration-guard.mjs";

const BASE = "origin/main";

/** What the two generators write. */
const GENERATED = [
  "api/openapi.json",
  "web/src/generated/api.ts",
  "web/src/generated/frames.ts",
  "web/src/generated/size-classes.css",
];

/**
 * The renames that put the branch's own migrations above every one of main's,
 * keeping their order. None when they are already above it and each has its own
 * number, so running this again changes nothing. Highest first, so that no rename
 * lands on a file a later one was going to move.
 * @param {string[]} onBase file names on main
 * @param {string[]} own file names the branch adds
 * @returns {{ from: string, to: string }[]}
 */
export function renumbered(onBase, own) {
  const top = Math.max(0, ...onBase.map(numberOf));
  const sorted = own.toSorted();
  const numbers = sorted.map(numberOf);
  if (numbers.every((n, i) => n > top && n !== numbers[i - 1])) return [];
  return sorted
    .flatMap((name, i) => {
      const to = `${String(top + i + 1).padStart(4, "0")}${name.slice(4)}`;
      return to === name ? [] : [{ from: name, to }];
    })
    .toReversed();
}

/**
 * Rebases with the generated files out of the way. Without the config the attribute
 * falls back to an ordinary text merge, which is what a plain `git rebase` still does.
 * @param {string} base
 * @param {string} [root]
 * @returns {boolean} false when a source file stopped it
 */
export function rebaseOn(base, root = ROOT) {
  git(["config", "--local", "merge.generated.name", "written anew after the rebase"], root);
  git(["config", "--local", "merge.generated.driver", "true"], root);
  try {
    git(["rebase", base], root);
    return true;
  } catch {
    return false;
  }
}

/**
 * Moves the branch's own migrations above the base's, and with them every mention
 * of the old file name: a test that reads its own migration names it.
 * @param {string} base
 * @param {string} [root]
 * @returns {{ from: string, to: string }[]}
 */
export function settleNumbers(base, root = ROOT) {
  const onBase = migrationsAt(base, root);
  const own = migrationsAt("HEAD", root).filter((name) => !onBase.includes(name));
  const renames = renumbered(onBase, own);
  for (const { from, to } of renames) {
    git(["mv", `${MIGRATIONS}/${from}`, `${MIGRATIONS}/${to}`], root);
    const [stem, next] = [from.slice(0, -".sql".length), to.slice(0, -".sql".length)];
    for (const file of mentioning(stem, root)) {
      const path = join(root, file);
      writeFileSync(path, readFileSync(path, "utf8").replaceAll(stem, next));
      git(["add", "--", file], root);
    }
  }
  return renames;
}

/**
 * @param {string} text
 * @param {string} root
 * @returns {string[]} tracked files holding it; `git grep` exits 1 on none
 */
function mentioning(text, root) {
  try {
    return git(["grep", "-lF", "--", text], root).split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

/** @param {string[]} args */
function loud(...args) {
  const [command = "", ...rest] = args;
  execFileSync(command, rest, { cwd: ROOT, env: GIT_ENV, stdio: "inherit" });
}

function main() {
  if (git(["status", "--porcelain"]) !== "") {
    console.error("✗ the tree is not clean: commit first, this ends in a commit of its own");
    process.exit(1);
  }

  loud("git", "fetch", "-q", "origin", "main");
  if (!rebaseOn(BASE)) {
    console.error(`✗ Two changes overlap in a source file, which is for a person to resolve:
  resolve it, \`git rebase --continue\`, and run this command again.`);
    process.exit(1);
  }

  for (const { from, to } of settleNumbers(BASE)) console.log(`  ${from} → ${to}`);

  loud("node", "backend/scripts/openapi.ts");
  loud("node", "tooling/web-api.mjs");
  git(["add", "--", ...GENERATED]);

  if (git(["diff", "--cached", "--name-only"]) === "") {
    console.log(`✓ on ${BASE}; numbers and generated files already right`);
    return;
  }
  loud("git", "commit", "-q", "-m", "chore: settle migration numbers and generated files");
  console.log(`✓ on ${BASE}, with one commit settling numbers and generated files`);
}

if (import.meta.main) main();
