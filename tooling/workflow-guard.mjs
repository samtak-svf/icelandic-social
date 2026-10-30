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
// 5. No `nohup`: under the launchd runner on samtak-mac it has no terminal to
//    detach from, so it exits ("can't detach from console") without starting
//    the command. `(trap '' HUP; exec …) &` ignores SIGHUP the same way and
//    works on every runner (web/scripts/e2e.sh).
// 6. `rustup toolchain install` lives only in .github/actions/rust-toolchain: a
//    copy in a workflow leaves RUSTUP_TOOLCHAIN unset, and on a runner whose
//    rustup has no default toolchain (samtak-mac) Swatinem/rust-cache fails
//    running `rustc -vV` outside core/.
// 7. No fixed dev Worker port (`127.0.0.1:8787`, `localhost:8787`) in a
//    workflow, and `EXCLUSIVE_RUNNER_LABELS` only in android.yml. The Worker
//    takes a free port per job (backend/scripts/dev-worker.sh), so web and
//    interop share the build lane; only the one-AVD Android device job still
//    queues on the exclusive runner (docs/testing.md).
// 8. Swatinem/rust-cache, taiki-e/install-action and `cargo install` come after
//    .github/actions/rust-toolchain in their job. The action gives each
//    self-hosted runner its own CARGO_HOME: the two samtak-mac runners share
//    one $HOME, and rust-cache's post step cleans the registry and cargo/bin,
//    so with one ~/.cargo it deleted the sources and tools of the job running
//    beside it.
// 9. Each runner variable has ONE `runs-on` expression, byte for byte
//    (`RUNNER_EXPRESSIONS`): twelve hand-copied variants of the fork fallback
//    were a policy change away from drifting (#281).
// 10. The composite actions in .github/actions are walked too: their remote
//    actions are pinned like the workflows' (rule 1) and they run no nohup.
// 11. A workflow with a path filter lists every local action it uses, and the
//    local actions those use, in each filter (`.github/actions/<name>/**`).
//    Otherwise a change to a shared action alone runs none of its callers and
//    merges untested.
// 12. A job the tree-proof gate can skip runs unless the gate says "false", so a
//    gate that failed runs everything, and the `proof` job waits on it by name,
//    so a marker never says more than what passed (tooling/tree-proof.mjs). Both
//    callers grant `actions: read`: GitHub checks the called file's every job
//    against the caller, so a run without it fails to start at all.
//
// Line-based on purpose: the rules are about single lines, and the guard stays
// dependency-free like the others (tooling/lib/repo.mjs).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, visibleFiles } from "./lib/repo.mjs";

const WORKFLOW = /^\.github\/workflows\/[^/]+\.ya?ml$/;
const ACTION = /^\.github\/actions\/[^/]+\/action\.ya?ml$/;
const USES = /^\s*(?:-\s+)?uses:\s*(\S+)(.*)$/;
const PINNED = /^[^@\s]+@[0-9a-f]{40}$/;
const TAG_COMMENT = /^\s+#\s*v\d\S*\s*$/;
const RUNS_ON = /^\s*runs-on:\s*(.+)$/;
const FORK_FALLBACK = /github\.event\.pull_request\.head\.repo\.fork\s*&&/;
const TARGET = /^\s*pull_request_target\s*:|\bpull_request_target\b\s*[\],]/;
const JOB = /^ {2}[\w-]+:\s*$/;
const NOHUP = /(?:^|[\s;&|(])nohup\s/;
const TOOLCHAIN_INSTALL = /\brustup\s+toolchain\s+install\b/;
// core-artifact runs the toolchain action first, so it counts as one.
const TOOLCHAIN_ACTION =
  /^\s*(?:-\s+)?uses:\s*\.\/\.github\/actions\/(?:rust-toolchain|core-artifact)\s*$/;
const CARGO_HOME_WRITER =
  /^\s*(?:-\s+)?uses:\s*(?:Swatinem\/rust-cache|taiki-e\/install-action)@|\bcargo\s+install\b/;
const LOCAL_ACTION = /^\s*(?:-\s+)?uses:\s*\.\/\.github\/actions\/([\w-]+)\s*$/;
const PATHS = /^(\s+)paths:\s*$/;
const ENTRY = /^\s+-\s+["']?([^"'\s]+)["']?\s*$/;
const SECRET = /\bsecrets\.(?!GITHUB_TOKEN\b)\w+/;

/**
 * @typedef {{ file: string, line: number, rule: "pin" | "fork-runner" | "trigger" | "secret-runner" | "nohup" | "rust-toolchain" | "fixed-port" | "exclusive-lane" | "cargo-home" | "runner-expr" | "action-paths" | "tree-proof", message: string }} Problem
 */

/**
 * The remote action a `uses:` line names without a SHA pin and its tag.
 * @param {string} code
 * @returns {string | undefined}
 */
function unpinnedAction(code) {
  const uses = USES.exec(code);
  const ref = uses?.[1];
  if (!ref || ref.startsWith("./") || ref.startsWith("docker://")) return undefined;
  if (PINNED.test(ref) && TAG_COMMENT.test(uses[2] ?? "")) return undefined;
  return ref.split("@")[0];
}

/** Lines refused by their text alone. */
const BANNED = [
  {
    rule: /** @type {const} */ ("trigger"),
    pattern: TARGET,
    message: "pull_request_target is not allowed",
  },
  {
    rule: /** @type {const} */ ("nohup"),
    pattern: NOHUP,
    message: "nohup exits on the launchd runner; use (trap '' HUP; exec …) &",
  },
  {
    rule: /** @type {const} */ ("rust-toolchain"),
    pattern: TOOLCHAIN_INSTALL,
    message: "install the toolchain with ./.github/actions/rust-toolchain, not rustup directly",
  },
  {
    rule: /** @type {const} */ ("fixed-port"),
    pattern: /\b(?:127\.0\.0\.1|localhost):8787\b/,
    message:
      "the dev Worker takes a free port per job: use $SPJALL_DEV_URL (backend/scripts/dev-worker.sh)",
  },
];

/**
 * The one `runs-on` expression allowed for each runner variable: the fork
 * fallback names the hosted runner of the lane (macOS for the Mac lane).
 * @param {string} variable
 * @param {string} hosted
 */
const runnerExpression = (variable, hosted) =>
  `\${{ fromJSON(github.event.pull_request.head.repo.fork && '["${hosted}"]' || vars.${variable} || '["${hosted}"]') }}`;

/** @type {Record<string, string>} */
export const RUNNER_EXPRESSIONS = {
  RUNNER_LABELS: runnerExpression("RUNNER_LABELS", "ubuntu-latest"),
  GUARD_RUNNER_LABELS: runnerExpression("GUARD_RUNNER_LABELS", "ubuntu-latest"),
  EXCLUSIVE_RUNNER_LABELS: runnerExpression("EXCLUSIVE_RUNNER_LABELS", "ubuntu-latest"),
  MAC_RUNNER_LABELS: runnerExpression("MAC_RUNNER_LABELS", "macos-26"),
};

const EXCLUSIVE_LANE = /\bEXCLUSIVE_RUNNER_LABELS\b/;
const EXCLUSIVE_FILE = ".github/workflows/android.yml";

/**
 * The rules that each line answers on its own: pin, fork-runner, trigger, nohup, rust-toolchain, fixed-port.
 * @param {string} code a line with its comment removed
 * @returns {{ rule: Problem["rule"], message: string }[]}
 */
function lineProblems(code) {
  /** @type {{ rule: Problem["rule"], message: string }[]} */
  const found = [];
  const unpinned = unpinnedAction(code);
  if (unpinned) {
    found.push({
      rule: "pin",
      message: `pin ${unpinned} to a commit SHA with its tag in a comment`,
    });
  }
  const runsOn = RUNS_ON.exec(code)?.[1];
  if (runsOn?.includes("vars.") && !FORK_FALLBACK.test(runsOn)) {
    found.push({
      rule: "fork-runner",
      message: "a runner variable needs the hosted fallback for fork PRs",
    });
  }
  if (runsOn?.includes("vars.") && FORK_FALLBACK.test(runsOn)) {
    for (const [, variable = ""] of runsOn.matchAll(/\bvars\.(\w+)/g)) {
      const canonical = RUNNER_EXPRESSIONS[variable];
      if (canonical === undefined) {
        found.push({
          rule: "runner-expr",
          message: `vars.${variable} has no canonical runs-on expression`,
        });
      } else if (runsOn.trim() !== canonical) {
        found.push({
          rule: "runner-expr",
          message: `runs-on for ${variable} must be exactly: ${canonical}`,
        });
      }
    }
  }
  for (const { rule, pattern, message } of BANNED)
    if (pattern.test(code)) found.push({ rule, message });
  return found;
}

/** @typedef {{ runsOn: number, secret: boolean, toolchain: boolean }} Job */

/**
 * Records what a job line tells about its job, and answers rule 8.
 * @param {Job} job
 * @param {string} code a line with its comment removed
 * @param {number} line
 * @returns {{ rule: Problem["rule"], message: string }[]}
 */
function jobLine(job, code, line) {
  if (SECRET.test(code)) job.secret = true;
  if (RUNS_ON.exec(code)?.[1]?.includes("vars.")) job.runsOn = line;
  if (TOOLCHAIN_ACTION.test(code)) job.toolchain = true;
  if (job.toolchain || !CARGO_HOME_WRITER.test(code)) return [];
  return [
    {
      rule: "cargo-home",
      message:
        "run ./.github/actions/rust-toolchain first: it gives a self-hosted runner its own CARGO_HOME",
    },
  ];
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
  /** @type {Job | null} */
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
      job = { runsOn: 0, secret: false, toolchain: false };
    }
    if (job) for (const p of jobLine(job, code, line)) found.push({ file, line, ...p });

    for (const p of lineProblems(code)) found.push({ file, line, ...p });
    if (file !== EXCLUSIVE_FILE && EXCLUSIVE_LANE.test(code)) {
      found.push({
        file,
        line,
        rule: "exclusive-lane",
        message: "only android.yml's device job (one AVD) uses the exclusive runner lane",
      });
    }
  });
  endJob();
  return found;
}

/**
 * A composite action: pinned remote actions, no nohup.
 * @param {string} file repo-relative path
 * @param {string} text
 * @returns {Problem[]}
 */
export function findInAction(file, text) {
  return findInWorkflow(file, text).filter((p) => p.rule === "pin" || p.rule === "nohup");
}

/**
 * The local actions (`./.github/actions/<name>`) a file uses directly.
 * @param {string} text
 * @returns {Set<string>}
 */
function localActions(text) {
  const names = new Set();
  for (const raw of text.split("\n")) {
    const name = LOCAL_ACTION.exec(raw.replace(/^(\s*)#.*$/, "$1"))?.[1];
    if (name) names.add(name);
  }
  return names;
}

/**
 * Rule 11: each path filter of a workflow lists every local action it reaches.
 * @param {string} file repo-relative path
 * @param {string} text
 * @param {Map<string, Set<string>>} actionUses each action's own local actions
 * @returns {Problem[]}
 */
export function actionPathProblems(file, text, actionUses) {
  const reached = new Set();
  const visit = (/** @type {string} */ name) => {
    if (reached.has(name)) return;
    reached.add(name);
    for (const next of actionUses.get(name) ?? []) visit(next);
  };
  for (const name of localActions(text)) visit(name);
  if (reached.size === 0) return [];

  /** @type {Problem[]} */
  const found = [];
  const lines = text.split("\n");
  lines.forEach((raw, index) => {
    const indent = PATHS.exec(raw)?.[1];
    if (indent === undefined) return;
    const listed = new Set();
    for (const next of lines.slice(index + 1)) {
      const entry = ENTRY.exec(next);
      if (!entry || (/^\s*/.exec(next)?.[0].length ?? 0) <= indent.length) break;
      listed.add(entry[1]);
    }
    const missing = [...reached].sort().filter((n) => !listed.has(`.github/actions/${n}/**`));
    if (missing.length > 0) {
      found.push({
        file,
        line: index + 1,
        rule: "action-paths",
        message: `the path filter misses ${missing.map((n) => `.github/actions/${n}/**`).join(", ")}, so a change to it runs none of this workflow`,
      });
    }
  });
  return found;
}

/**
 * The jobs of a workflow, each with its first line, its `if` and its `needs`.
 * @param {string} text
 * @returns {{ name: string, line: number, condition: string, needs: string[], canReadActions: boolean, callsProof: boolean }[]}
 */
function jobHeads(text) {
  /** @type {ReturnType<typeof jobHeads>} */
  const jobs = [];
  let inJobs = false;
  text.split("\n").forEach((raw, index) => {
    if (/^\S/.test(raw)) inJobs = /^jobs:\s*$/.test(raw);
    if (!inJobs) return;
    const name = /^ {2}([\w-]+):\s*$/.exec(raw)?.[1];
    if (name)
      jobs.push({
        name,
        line: index + 1,
        condition: "",
        needs: [],
        canReadActions: false,
        callsProof: false,
      });
    const job = jobs.at(-1);
    if (!job) return;
    if (/^ {6}actions: read\b/.test(raw)) job.canReadActions = true;
    if (/^ {4}uses: \.\/\.github\/workflows\/tree-proof\.yml\s*$/.test(raw)) job.callsProof = true;
    const condition = /^ {4}if:\s*(.+)$/.exec(raw)?.[1];
    if (condition) job.condition = condition;
    const needs = /^ {4}needs:\s*(.+)$/.exec(raw)?.[1];
    if (needs)
      job.needs = needs
        .replace(/[[\]]/g, "")
        .split(",")
        .map((n) => n.trim());
  });
  return jobs;
}

const GATE_OPEN = "!cancelled() && needs.gate.outputs.run != 'false'";

/**
 * Rule 12.
 * @param {string} file repo-relative path
 * @param {string} text
 * @returns {Problem[]}
 */
export function treeProofProblems(file, text) {
  const jobs = jobHeads(text);
  const gated = jobs.filter((job) => job.needs.includes("gate"));
  /** @type {Problem[]} */
  const found = [];
  const problem = (/** @type {number} */ line, /** @type {string} */ message) =>
    found.push({ file, line, rule: "tree-proof", message });
  const proof = jobs.find((job) => job.name === "proof");
  if (!proof && gated[0]) problem(gated[0].line, "a workflow with a gate needs a proof job");
  for (const job of gated) {
    if (!job.condition.includes(GATE_OPEN)) {
      problem(job.line, `${job.name} must run unless the gate says so: if: ${GATE_OPEN}`);
    }
    if (proof && !proof.needs.includes(job.name)) {
      problem(proof.line, `proof must need ${job.name}, which the gate can skip`);
    }
    if (proof && !proof.condition.includes(`needs.${job.name}.result == 'success'`)) {
      problem(proof.line, `proof must require needs.${job.name}.result == 'success'`);
    }
  }
  for (const job of jobs) {
    if (job.callsProof && !job.canReadActions) {
      problem(job.line, `${job.name} calls tree-proof.yml and must grant actions: read`);
    }
  }
  return found;
}

/**
 * @param {string} [root]
 * @returns {Problem[]}
 */
export function findProblems(root = ROOT) {
  const files = visibleFiles(root);
  const read = (/** @type {string} */ file) => readFileSync(join(root, file), "utf8");
  const actions = files.filter((f) => ACTION.test(f));
  const actionUses = new Map(actions.map((f) => [f.split("/")[2] ?? "", localActions(read(f))]));
  return [
    ...files
      .filter((f) => WORKFLOW.test(f))
      .flatMap((f) => [
        ...findInWorkflow(f, read(f)),
        ...actionPathProblems(f, read(f), actionUses),
        ...treeProofProblems(f, read(f)),
      ]),
    ...actions.flatMap((f) => findInAction(f, read(f))),
  ];
}

function main() {
  const problems = findProblems();
  for (const p of problems) console.error(`::error file=${p.file},line=${p.line}::${p.message}`);
  if (problems.length > 0) process.exit(1);
  console.log(
    "✓ workflows pin every action by SHA, keep fork PRs and secrets off the org runners, use no nohup, install Rust only through the action, no fixed dev port, the exclusive lane only for Android and the toolchain action before CARGO_HOME is written, one runs-on expression per runner variable, composite actions pinned too, every used local action in the path filters, every job the tree-proof gate can skip proven",
  );
}

if (import.meta.main) main();
