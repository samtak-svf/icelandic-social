// @ts-check
// `pnpm check`: lint, types, format and every guard CI runs, in parallel.
//
// The one list is the `check:chain` script in package.json (a plain `&&` chain
// of `pnpm run <step>`, so the guard registry reads it like any other chain and
// `pnpm run check:chain` still runs the steps serially). This runner reads that
// chain and runs the steps at once, bounded by the machine's headroom
// (tooling/vitest-load.mjs). Two optional package.json keys tune it:
//
//   "guardRunner": {
//     "after":  { "<step>": ["<step it waits for>"] },      ordering that must hold
//     "scoped": { "<step>": { "command": "... {files}", "match": "<regex>" } }
//   }
//
// `--changed` runs a `scoped` step on the files changed against the merge base
// with origin/main (committed, uncommitted and untracked) that match its regex,
// and skips it when none do; a step without a `scoped` entry cannot narrow and
// runs in full. Output prints per step when the step ends, then one summary line.
// A passing step prints its `--- <name>: pass in N s` line only; a failing step
// replays its whole output; `--verbose` prints every step's output (issue #588).
// GUARDS_JOBS overrides the concurrency.

import { execFileSync } from "node:child_process";
import os from "node:os";
import { readJson, ROOT } from "./lib/repo.mjs";
import { runCommand, runSteps, summaryLine } from "./lib/run-steps.mjs";
import { vitestLoad } from "./vitest-load.mjs";

/** @typedef {import("./lib/run-steps.mjs").Step} Step */

/**
 * The steps of the `check:chain` script, in order, each with its ordering.
 * @param {{ scripts?: Record<string, string>, guardRunner?: { after?: Record<string, string[]> } }} pkg
 * @returns {Step[]}
 */
export function stepsFromPackage(pkg) {
  const chain = pkg.scripts?.["check:chain"];
  if (!chain) throw new Error("package.json has no check:chain script");
  return chain.split("&&").map((part) => {
    const m = /^\s*pnpm run ([\w:-]+)\s*$/.exec(part);
    if (!m) throw new Error(`check:chain: "${part.trim()}" is not a "pnpm run <script>" step`);
    const name = /** @type {string} */ (m[1]);
    if (!Object.hasOwn(pkg.scripts ?? {}, name))
      throw new Error(`check:chain: no script named ${name}`);
    return { name, command: `pnpm run ${name}`, after: pkg.guardRunner?.after?.[name] ?? [] };
  });
}

/**
 * Narrow the steps that can scope to the changed files; a scoped step with no matching file drops out.
 * @param {Step[]} steps
 * @param {Record<string, { command: string, match: string }>} scoped
 * @param {string[]} changed
 * @returns {{ steps: Step[], dropped: string[] }}
 */
export function scopeSteps(steps, scoped, changed) {
  /** @type {Step[]} */
  const out = [];
  /** @type {string[]} */
  const dropped = [];
  for (const step of steps) {
    const rule = scoped[step.name];
    if (!rule) {
      out.push(step);
      continue;
    }
    const files = changed.filter((f) => new RegExp(rule.match).test(f));
    if (files.length === 0) dropped.push(step.name);
    else
      out.push({
        ...step,
        command: rule.command.replace("{files}", files.map(shellQuote).join(" ")),
      });
  }
  const kept = new Set(out.map((s) => s.name));
  return {
    steps: out.map((s) => ({ ...s, after: (s.after ?? []).filter((d) => kept.has(d)) })),
    dropped,
  };
}

/** @param {string} s */
const shellQuote = (s) => `'${s.replaceAll("'", `'\\''`)}'`;

/** Files changed against the merge base with origin/main, plus uncommitted and untracked ones. */
function changedFiles() {
  const git = (/** @type {string[]} */ ...args) =>
    execFileSync("git", args, { cwd: ROOT, encoding: "utf8" });
  const base = git("merge-base", "HEAD", "origin/main").trim();
  const lines = (/** @type {string} */ text) => text.split("\n").filter(Boolean);
  return [
    ...new Set([
      ...lines(git("diff", "--name-only", "--diff-filter=ACMR", base)),
      ...lines(git("ls-files", "--others", "--exclude-standard")),
    ]),
  ];
}

/** @returns {{ limit: number, basis: string }} */
function concurrency() {
  const forced = Number(process.env.GUARDS_JOBS);
  if (Number.isInteger(forced) && forced > 0) return { limit: forced, basis: "GUARDS_JOBS" };
  const load = vitestLoad({ perForkMb: 700, minWorkers: 2 });
  const limit = Math.min(8, load.maxWorkers ?? os.availableParallelism());
  return {
    limit,
    basis: load.line.replace(/^\[vitest-load\]\s*/, "").split(" testTimeout")[0] ?? "",
  };
}

/**
 * What one finished step prints: the timing line, plus its output when it failed or `verbose`.
 * @param {import("./lib/run-steps.mjs").Result} r
 * @param {boolean} verbose
 * @returns {string}
 */
export function renderResult(r, verbose) {
  if (r.status === "skipped") return `\n--- ${r.name}: skipped, ${r.note}\n`;
  const line = `--- ${r.name}: ${r.status} in ${(r.ms / 1000).toFixed(1)} s\n`;
  if (r.status === "pass" && !verbose) return line;
  const head = `\n${line}`;
  if (!r.output.trim()) return head;
  return head + (r.output.endsWith("\n") ? r.output : `${r.output}\n`);
}

async function main() {
  const verbose = process.argv.includes("--verbose");
  const wantChanged = process.argv.includes("--changed");
  const pkg = readJson("package.json");
  let steps = stepsFromPackage(pkg);
  if (wantChanged) {
    const files = changedFiles();
    const scoped = scopeSteps(steps, pkg.guardRunner?.scoped ?? {}, files);
    steps = scoped.steps;
    console.log(
      `--changed: ${files.length} file(s) against the merge base; ${scoped.dropped.length} scoped step(s) skipped for lack of a matching file (${scoped.dropped.join(", ") || "none"}); ${scoped.steps.length} to run`,
    );
  }
  const { limit, basis } = concurrency();
  if (verbose) console.log(`check: ${steps.length} steps, ${limit} at a time (${basis})`);
  const start = Date.now();
  const results = await runSteps(steps, {
    limit,
    run: (step) => runCommand(step.command, { cwd: ROOT }),
    onResult: (r) => {
      process.stdout.write(renderResult(r, verbose));
    },
  });
  const wall = Date.now() - start;
  const failed = results.filter((r) => r.status !== "pass");
  console.log(`${verbose || failed.length > 0 ? "\n" : ""}check: ${summaryLine(results, wall)}`);
  if (failed.length > 0) {
    console.log(`check: not passing: ${failed.map((r) => r.name).join(", ")}`);
    process.exitCode = 1;
  }
}

if (import.meta.main) await main();
