// @ts-check
// Nothing is pushed to main: every change reaches it through a PR.
//
// Git hands a pre-push hook one line per ref being pushed on stdin:
// `<local ref> <local sha> <remote ref> <remote sha>`. The guard reads the
// REMOTE ref, which is what the push changes, not the branch checked out
// here. Testing the local HEAD instead refused every push made from a main
// checkout, deleting a merged branch on the remote or pushing a tag included,
// while it let `git push origin feature:main` from a feature branch through.

import { readFileSync } from "node:fs";

const MAIN = "refs/heads/main";

/**
 * @param {string} stdin what git writes to a pre-push hook
 * @returns {string[]} the pushed lines that would update or delete main
 */
export function pushesToMain(stdin) {
  return stdin
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.split(/\s+/)[2] === MAIN);
}

function main() {
  const refused = pushesToMain(readFileSync(0, "utf8"));
  if (refused.length === 0) return;
  console.error("❌ Direct pushes to main are not allowed. Use a PR.");
  process.exit(1);
}

if (import.meta.main) main();
