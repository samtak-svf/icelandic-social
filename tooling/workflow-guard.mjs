// @ts-check
// Workflow guard: what makes the workflows safe to run for a stranger's PR.
//
// 1. A remote action is pinned to a full commit SHA, with its tag in a comment
//    (`uses: owner/repo@<40 hex> # v5.1.0`). A tag can be moved to any commit
//    by whoever controls the action; a SHA cannot. The comment is what tells a
//    reader, and Dependabot, which version the SHA is.
// 2. A `runs-on` that reads a repo variable falls back to a hosted runner for
//    a PR from a fork. The variables name self-hosted runner groups, which
//    must never run code from outside the org.
// 3. No `pull_request_target`: it runs with the repo's secrets on a fork's PR.
// 4. A job that reads a secret runs on a hosted runner, never on a runner a
//    variable names: those are our own machines (samtak-mac), and no secret
//    reaches them (docs/testing.md, "Where CI runs").
//
// Line-based on purpose: the rules are about single lines, and the guard stays
// dependency-free like the others (tooling/lib/repo.mjs).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, visibleFiles } from "./lib/repo.mjs";

const WORKFLOW = /^\.github\/workflows\/[^/]+\.ya?ml$/;
const USES = /^\s*(?:-\s+)?uses:\s*(\S+)(.*)$/;
const PINNED = /^[^@\s]+@[0-9a-f]{40}$/;
const TAG_COMMENT = /^\s+#\s*v\d\S*\s*$/;
const RUNS_ON = /^\s*runs-on:\s*(.+)$/;
const FORK_FALLBACK = /github\.event\.pull_request\.head\.repo\.fork\s*&&/;
const TARGET = /^\s*pull_request_target\s*:|\bpull_request_target\b\s*[\],]/;
const JOB = /^ {2}[\w-]+:\s*$/;
const SECRET = /\bsecrets\.(?!GITHUB_TOKEN\b)\w+/;

/**
 * @typedef {{ file: string, line: number, rule: "pin" | "fork-runner" | "trigger" | "secret-runner", message: string }} Problem
 */

/**
 * The rules that each line answers on its own: pin, fork-runner, trigger.
 * @param {string} code a line with its comment removed
 * @returns {{ rule: Problem["rule"], message: string }[]}
 */
function lineProblems(code) {
  /** @type {{ rule: Problem["rule"], message: string }[]} */
  const found = [];
  const uses = USES.exec(code);
  const remote = uses?.[1] && !uses[1].startsWith("./") && !uses[1].startsWith("docker://");
  if (uses?.[1] && remote && (!PINNED.test(uses[1]) || !TAG_COMMENT.test(uses[2] ?? ""))) {
    found.push({
      rule: "pin",
      message: `pin ${uses[1].split("@")[0]} to a commit SHA with its tag in a comment`,
    });
  }
  const runsOn = RUNS_ON.exec(code)?.[1];
  if (runsOn?.includes("vars.") && !FORK_FALLBACK.test(runsOn)) {
    found.push({
      rule: "fork-runner",
      message: "a runner variable needs the hosted fallback for fork PRs",
    });
  }
  if (TARGET.test(code)) {
    found.push({ rule: "trigger", message: "pull_request_target is not allowed" });
  }
  return found;
}

/**
 * @param {string} file repo-relative path
 * @param {string} text
 * @returns {Problem[]}
 */
export function findInWorkflow(file, text) {
  /** @type {Problem[]} */
  const found = [];
  let inJobs = false;
  /** @type {{ runsOn: number, secret: boolean } | null} */
  let job = null;
  const endJob = () => {
    if (job?.secret && job.runsOn > 0) {
      found.push({
        file,
        line: job.runsOn,
        rule: "secret-runner",
        message: "a job that reads a secret runs on a hosted runner, not a runner variable",
      });
    }
    job = null;
  };
  text.split("\n").forEach((raw, index) => {
    const line = index + 1;
    const code = raw.replace(/^(\s*)#.*$/, "$1");

    if (/^\S/.test(code)) {
      endJob();
      inJobs = /^jobs:\s*$/.test(code);
    } else if (inJobs && JOB.test(code)) {
      endJob();
      job = { runsOn: 0, secret: false };
    }
    if (job && SECRET.test(code)) job.secret = true;
    if (job && RUNS_ON.exec(code)?.[1]?.includes("vars.")) job.runsOn = line;

    for (const p of lineProblems(code)) found.push({ file, line, ...p });
  });
  endJob();
  return found;
}

/**
 * @param {string} [root]
 * @returns {Problem[]}
 */
export function findProblems(root = ROOT) {
  return visibleFiles(root)
    .filter((file) => WORKFLOW.test(file))
    .flatMap((file) => findInWorkflow(file, readFileSync(join(root, file), "utf8")));
}

function main() {
  const problems = findProblems();
  for (const p of problems) console.error(`::error file=${p.file},line=${p.line}::${p.message}`);
  if (problems.length > 0) process.exit(1);
  console.log(
    "✓ workflows pin every action by SHA and keep fork PRs and secrets off the org runners",
  );
}

if (import.meta.main) main();
