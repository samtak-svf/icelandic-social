// @ts-check
// The step scheduler behind `pnpm check` (issue #584): runs shell commands in
// parallel under a concurrency bound, holds declared orderings, buffers each
// step's output so it prints grouped, and totals the result. No repo knowledge
// lives here; tooling/check.mjs feeds it the steps.

import { spawn } from "node:child_process";

/**
 * @typedef {{ name: string, command: string, after?: string[] }} Step
 * @typedef {{ name: string, status: "pass" | "fail" | "skipped", ms: number, output: string, note?: string }} Result
 */

/**
 * Run one command through the shell, collecting stdout and stderr in order.
 * @param {string} command
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv }} [options]
 * @returns {Promise<{ code: number, output: string }>}
 */
export function runCommand(command, { cwd, env } = {}) {
  return new Promise((resolve) => {
    const child = spawn("sh", ["-c", command], { cwd, env: { ...process.env, ...env } });
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    child.on("error", (error) => resolve({ code: 127, output: output + String(error) }));
    child.on("close", (code) => resolve({ code: code ?? 1, output }));
  });
}

/**
 * Reject a plan that cannot run: duplicate names, an `after` that names no step, or a cycle.
 * @param {Step[]} steps
 */
export function validateSteps(steps) {
  const names = new Set();
  for (const s of steps) {
    if (names.has(s.name)) throw new Error(`step ${s.name} is listed twice`);
    names.add(s.name);
  }
  for (const s of steps) {
    for (const d of s.after ?? []) {
      if (!names.has(d)) throw new Error(`step ${s.name} runs after ${d}, which is not a step`);
    }
  }
  const done = new Set();
  let left = steps;
  while (left.length > 0) {
    const ready = left.filter((s) => (s.after ?? []).every((d) => done.has(d)));
    if (ready.length === 0)
      throw new Error(`ordering cycle among: ${left.map((s) => s.name).join(", ")}`);
    for (const s of ready) done.add(s.name);
    left = left.filter((s) => !done.has(s.name));
  }
}

/**
 * Run the steps, at most `limit` at a time, each only after the steps it names
 * have passed. A step whose prerequisite failed is skipped, not run.
 * @param {Step[]} steps in preferred start order
 * @param {{ limit: number, run?: (step: Step) => Promise<{ code: number, output: string }>,
 *   onResult?: (result: Result) => void, now?: () => number }} options
 * @returns {Promise<Result[]>} in completion order
 */
export async function runSteps(
  steps,
  { limit, run = (s) => runCommand(s.command), onResult = () => {}, now = Date.now },
) {
  validateSteps(steps);
  /** @type {Map<string, Result>} */
  const finished = new Map();
  /** @type {Result[]} */
  const results = [];
  const pending = [...steps];
  let active = 0;

  /** @param {Result} r */
  const record = (r) => {
    finished.set(r.name, r);
    results.push(r);
    onResult(r);
  };

  await new Promise((resolve) => {
    const pump = () => {
      for (let i = 0; i < pending.length;) {
        const step = /** @type {Step} */ (pending[i]);
        const deps = (step.after ?? []).map((d) => finished.get(d));
        if (deps.some((d) => d && d.status !== "pass")) {
          const bad = deps.find((d) => d && d.status !== "pass");
          pending.splice(i, 1);
          record({
            name: step.name,
            status: "skipped",
            ms: 0,
            output: "",
            note: `after ${bad?.name}, which did not pass`,
          });
          continue;
        }
        if (deps.some((d) => !d) || active >= limit) {
          i++;
          continue;
        }
        pending.splice(i, 1);
        active++;
        const start = now();
        run(step)
          .catch((error) => ({ code: 1, output: String(error) }))
          .then(({ code, output }) => {
            active--;
            record({
              name: step.name,
              status: code === 0 ? "pass" : "fail",
              ms: now() - start,
              output,
            });
            pump();
          });
      }
      if (pending.length === 0 && active === 0) resolve(undefined);
    };
    pump();
  });
  return results;
}

/**
 * @param {Result[]} results
 * @param {number} wallMs
 * @returns {string}
 */
export function summaryLine(results, wallMs) {
  const count = (/** @type {Result["status"]} */ s) => results.filter((r) => r.status === s).length;
  const skipped = count("skipped");
  return `${count("pass")} passed, ${count("fail")} failed${skipped ? `, ${skipped} skipped` : ""} of ${results.length} steps in ${(wallMs / 1000).toFixed(1)} s`;
}
