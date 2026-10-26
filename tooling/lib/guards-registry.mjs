// @ts-check
// The guard registry check (issue #276).
//
// `tooling/guards.json` is the one list of guards: for each script in
// `tooling/*.mjs` the stages it must run at. A stage is `commit` (lefthook
// pre-commit or commit-msg), `push` (lefthook pre-push) or `ci` (a workflow,
// a composite action, or a `pnpm run` chain they reach, `pnpm check` included).
// This module reads where each script really runs and compares the two, so a
// guard added to one place only, or dropped from one, fails `pnpm test`.
//
// A script in `tooling/*.mjs` is either a `guards` entry or a `tools` entry
// (with the reason it checks nothing); one in neither fails, whether or not
// anything runs it. A generator that has a `--check` mode is a guard with
// `"flag": "--check"`: only an invocation carrying the flag counts.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** @typedef {"commit" | "push" | "ci"} Stage */
/** @typedef {{ name: string, script: string, stages: string[], reason?: string, flag?: string }} Guard */
/** @typedef {{ guards: Guard[], tools: { script: string, reason: string }[] }} Registry */
/** @typedef {{ packageJson: { scripts?: Record<string, string> }, lefthook: string, workflows: Record<string, string> }} Sources */
/** @typedef {Map<string, { stage: Stage, args: string }[]>} Observed */

const STAGES = ["commit", "push", "ci"];

const LEFTHOOK_STAGE = /** @type {Record<string, Stage>} */ ({
  "pre-commit": "commit",
  "commit-msg": "commit",
  "pre-push": "push",
});

/** @param {string} text */
function codeLines(text) {
  return text
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .map((line) => line.replace(/\s#\s.*$/, ""));
}

/**
 * Every `node tooling/x.mjs <args>` in the lines, and every `pnpm [run] <name>`
 * that names a script of the root package.json, followed through its commands.
 * @param {string[]} lines
 * @param {Record<string, string>} scripts
 * @param {Stage} stage
 * @param {Observed} out
 * @param {Set<string>} [seen]
 */
function collect(lines, scripts, stage, out, seen = new Set()) {
  for (const line of lines) {
    for (const m of line.matchAll(/\bnode\s+(?:\.\.\/)?tooling\/([\w-]+)\.mjs([^&|;\n]*)/g)) {
      const script = m[1] ?? "";
      const args = m[2] ?? "";
      out.set(script, [...(out.get(script) ?? []), { stage, args: args.trim() }]);
    }
    for (const m of line.matchAll(/\bpnpm\s+(?:run\s+)?([\w:-]+)/g)) {
      const name = m[1] ?? "";
      if (!Object.hasOwn(scripts, name) || seen.has(name)) continue;
      seen.add(name);
      collect((scripts[name] ?? "").split(/&&|;/), scripts, stage, out, seen);
    }
  }
}

/**
 * @param {Sources} sources
 * @returns {Observed} per script, every invocation with the stage it runs at
 */
export function observeStages({ packageJson, lefthook, workflows }) {
  const scripts = packageJson.scripts ?? {};
  /** @type {Observed} */
  const out = new Map();
  /** @type {Stage | null} */
  let stage = null;
  /** @type {string[]} */
  let section = [];
  const flush = () => {
    if (stage) collect(section, scripts, stage, out);
    section = [];
  };
  for (const line of codeLines(lefthook)) {
    const top = /^([\w-]+):\s*$/.exec(line);
    if (top) {
      flush();
      stage = LEFTHOOK_STAGE[top[1] ?? ""] ?? null;
    } else section.push(line);
  }
  flush();
  for (const text of Object.values(workflows)) collect(codeLines(text), scripts, "ci", out);
  return out;
}

/**
 * @param {Observed} observed
 * @param {string} script
 * @param {string} [flag] when given, only invocations carrying it count
 * @returns {Set<Stage>}
 */
export function stagesOf(observed, script, flag) {
  return new Set(
    (observed.get(script) ?? [])
      .filter(({ args }) => !flag || args.split(/\s+/).includes(flag))
      .map(({ stage }) => stage),
  );
}

/**
 * @param {Guard} g
 * @param {Observed} observed
 * @returns {string[]}
 */
function checkGuard(g, observed) {
  /** @type {string[]} */
  const problems = [];
  for (const s of g.stages) {
    if (!STAGES.includes(s)) problems.push(`${g.name}: unknown stage "${s}"`);
  }
  if (g.stages.length === 0) problems.push(`${g.name}: no stage`);
  const actual = stagesOf(observed, g.script, g.flag);
  for (const s of actual) {
    if (!g.stages.includes(s))
      problems.push(`${g.name}: runs at ${s} but is not registered for it`);
  }
  for (const s of g.stages) {
    if (STAGES.includes(s) && !actual.has(/** @type {Stage} */ (s))) {
      problems.push(`${g.name}: registered for ${s} but nothing runs it there`);
    }
  }
  const local = g.stages.some((s) => s === "commit" || s === "push");
  if (!local && g.stages.includes("ci") && !g.reason) {
    problems.push(`${g.name}: runs in CI only, so it needs a reason`);
  }
  return problems;
}

/**
 * @param {{ registry: Registry, files: string[], observed: Observed }} input
 *   `files` are the basenames (no extension) of `tooling/*.mjs`
 * @returns {string[]} one line per problem, empty when consistent
 */
export function checkRegistry({ registry, files, observed }) {
  /** @type {string[]} */
  const problems = [];
  const fileSet = new Set(files);
  const guards = new Set();
  for (const g of registry.guards) {
    if (guards.has(g.script)) problems.push(`${g.name}: script ${g.script} is registered twice`);
    guards.add(g.script);
    if (!fileSet.has(g.script)) problems.push(`${g.name}: tooling/${g.script}.mjs does not exist`);
    problems.push(...checkGuard(g, observed));
  }
  const tools = new Set();
  for (const t of registry.tools) {
    tools.add(t.script);
    if (!fileSet.has(t.script))
      problems.push(`${t.script}: tooling/${t.script}.mjs does not exist`);
    if (guards.has(t.script)) problems.push(`${t.script}: is both a guard and a tool`);
    if (!t.reason) problems.push(`${t.script}: a tool needs a reason`);
  }
  for (const f of [...fileSet].sort()) {
    if (!guards.has(f) && !tools.has(f)) {
      problems.push(`${f}: tooling/${f}.mjs is not in tooling/guards.json (guards or tools)`);
    }
  }
  return problems;
}

/**
 * @param {string} root
 * @returns {Sources}
 */
export function readSources(root) {
  const read = (/** @type {string} */ p) => readFileSync(join(root, p), "utf8");
  /** @type {Record<string, string>} */
  const workflows = {};
  for (const f of readdirSync(join(root, ".github/workflows"))) {
    if (/\.ya?ml$/.test(f)) workflows[`.github/workflows/${f}`] = read(`.github/workflows/${f}`);
  }
  const actions = join(root, ".github/actions");
  if (existsSync(actions)) {
    for (const d of readdirSync(actions)) {
      for (const name of ["action.yml", "action.yaml"]) {
        const p = `.github/actions/${d}/${name}`;
        if (existsSync(join(root, p))) workflows[p] = read(p);
      }
    }
  }
  return {
    packageJson: JSON.parse(read("package.json")),
    lefthook: read("lefthook.yml"),
    workflows,
  };
}
