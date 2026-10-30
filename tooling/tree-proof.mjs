// @ts-check
// Do not test the same tree twice (issue #394).
//
// A merge to main runs the path-matched workflows again, though most merges
// land the very tree the PR run just tested. So a PR run that passed uploads an
// empty marker named after what it tested, and the push run looks for that name
// before it starts anything: found, the jobs are skipped; not found, they run.
// A merge that combined two changes has a tree no PR tested, so it has no marker
// and runs in full.
//
// The name covers exactly what the workflow says can affect it:
// - every file its `push` path filter selects, by mode and blob, so a change
//   anywhere else keeps the name and a change in there moves it. With no filter
//   (ci.yml) that is the whole tree;
// - the blob of the workflow itself, so a changed job never trusts an old run.
//
// A pull_request run checks out the merge of the PR with its base, so the name
// is that of the tree the jobs really saw, not of the PR's head. It is read from
// the index, which a fresh checkout leaves equal to the commit, so a file a job
// generates cannot move it.
//
// The marker is looked up with tooling/core-reuse.mjs `pick`, which refuses a
// fork's run: a fork could upload any name it likes.
//
//   node tooling/tree-proof.mjs name <workflow>
//     prints tree-proof-<workflow>-<40 hex> for the commit checked out

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ROOT, git } from "./lib/repo.mjs";

const ENTRY = /^\s+-\s+["']?([^"'\s]+)["']?\s*$/;

/**
 * The patterns of the workflow's `push` path filter, or an empty list when it
 * has none. Line-based, like tooling/workflow-guard.mjs.
 *
 * @param {string} text a workflow file
 * @returns {string[]}
 */
export function pushPaths(text) {
  const lines = text.split("\n");
  const push = lines.findIndex((line) => /^ {2}push:\s*$/.test(line));
  if (push < 0) throw new Error("the workflow has no push trigger");
  const found = [];
  let inPaths = false;
  for (const line of lines.slice(push + 1)) {
    if (line.trim() === "") continue;
    if (!/^ {4}/.test(line)) break;
    if (/^ {4}\S/.test(line)) {
      inPaths = /^ {4}paths:\s*$/.test(line);
      continue;
    }
    const entry = ENTRY.exec(line)?.[1];
    if (inPaths && entry) found.push(entry);
  }
  return found;
}

/**
 * @param {string} workflow the workflow's file name, without `.yml`
 * @param {string} [root]
 * @returns {string} `tree-proof-<workflow>-<40 hex>`
 */
export function proofName(workflow, root = ROOT) {
  const file = `.github/workflows/${workflow}.yml`;
  const patterns = pushPaths(readFileSync(join(root, file), "utf8"));
  const pathspecs = patterns.length ? patterns.map((pattern) => `:(glob)${pattern}`) : ["."];
  const selected = git(["ls-files", "--stage", "--", ...pathspecs], root);
  // A filter that selects nothing would give every commit one name, so every
  // later merge would pass on the first marker.
  if (!selected.trim()) throw new Error(`${file}: the path filter selects no file`);
  const blob = git(["rev-parse", "--verify", "--quiet", `HEAD:${file}`], root).trim();
  const key = createHash("sha1").update(`workflow ${blob}\n${selected}`).digest("hex");
  return `tree-proof-${workflow}-${key}`;
}

function main() {
  const [command, workflow] = process.argv.slice(2);
  if (command === "name" && workflow) {
    console.log(proofName(workflow));
  } else {
    console.error("usage: tree-proof.mjs name <workflow>");
    process.exit(2);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
