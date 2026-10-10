// @ts-check
// The rule drill (docs/testing.md § Critical rules): break a critical rule on
// purpose and check that its tests notice.
//
// tooling/drills/<rule-id>.patch is a minimal diff that breaks the rule of
// that id in tooling/critical-rules.json. For each one:
//
//   node tooling/rule-drill.mjs [<rule-id>...]
//       apply the patch to the working tree, run the tests the registry names
//       for that rule, revert, and report every drill whose tests still
//       passed: a rule no test holds, whatever the registry says;
//   node tooling/rule-drill.mjs --check
//       (pnpm check) every patch still applies and names a rule, so a drill
//       cannot rot unnoticed between monthly runs.
//
// The run edits the working tree, so it refuses one with changes to a file a
// patch touches. Kotlin and Swift tests are not run here; a rule held only by
// them is reported as not drilled.

import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GIT_ENV, readJson, ROOT } from "./lib/repo.mjs";

const DRILLS = "tooling/drills";

/** @typedef {import("./critical-rules.mjs").Rule} Rule */
/** @typedef {{ cwd: string, cmd: string, args: string[] }} Command */

/**
 * The commands that run `rule`'s tests: vitest per package, cargo per crate.
 *
 * @param {Rule} rule
 * @param {string} [root]
 * @returns {Command[]}
 */
export function commandsFor(rule, root = ROOT) {
  /** @type {Map<string, Command>} */
  const commands = new Map();
  for (const { file } of rule.tests) {
    if (file.startsWith("backend/")) {
      const c = commands.get("backend") ?? {
        cwd: "backend",
        cmd: "pnpm",
        args: ["exec", "vitest", "run"],
      };
      if (!c.args.includes(file.slice("backend/".length)))
        c.args.push(file.slice("backend/".length));
      commands.set("backend", c);
    } else if (file.startsWith("tooling/")) {
      const c = commands.get("tooling") ?? {
        cwd: ".",
        cmd: "pnpm",
        args: ["exec", "vitest", "run"],
      };
      if (!c.args.includes(file)) c.args.push(file);
      commands.set("tooling", c);
    } else if (file.startsWith("core/")) {
      const crate = file.split("/")[1] ?? "";
      const manifest = readFileSync(join(root, "core", crate, "Cargo.toml"), "utf8");
      const name = /^name\s*=\s*"([^"]+)"/m.exec(manifest)?.[1];
      if (name) {
        commands.set(`core:${name}`, {
          cwd: "core",
          cmd: "cargo",
          args: ["test", "-q", "-p", name],
        });
      }
    }
  }
  return [...commands.values()];
}

/** @param {string} [root] */
function drillIds(root = ROOT) {
  return readdirSync(join(root, DRILLS))
    .filter((f) => f.endsWith(".patch"))
    .map((f) => f.slice(0, -".patch".length))
    .sort();
}

/**
 * @param {string[]} args
 * @param {string} [root]
 */
function gitApply(args, root = ROOT) {
  return spawnSync("git", ["apply", ...args], { cwd: root, env: GIT_ENV, encoding: "utf8" });
}

/**
 * Every patch applies cleanly and names a rule in the registry.
 *
 * @param {string} [root]
 * @returns {string[]}
 */
export function checkDrills(root = ROOT) {
  const rules = new Set(
    /** @type {{ rules: Rule[] }} */ (readJson("tooling/critical-rules.json", root)).rules.map(
      (r) => r.id,
    ),
  );
  return drillIds(root).flatMap((id) => {
    const patch = `${DRILLS}/${id}.patch`;
    if (!rules.has(id)) return [`${patch}: no rule "${id}" in tooling/critical-rules.json`];
    const apply = gitApply(["--check", patch], root);
    return apply.status === 0 ? [] : [`${patch} no longer applies: ${apply.stderr.trim()}`];
  });
}

/**
 * Applies one drill, runs its rule's tests, reverts. True when a test failed.
 *
 * @param {string} id
 * @param {Rule} rule
 */
function drill(id, rule) {
  const patch = `${DRILLS}/${id}.patch`;
  const touched = gitApply(["--numstat", patch]).stdout.split("\n").filter(Boolean);
  const files = touched.map((line) => line.split("\t")[2] ?? "");
  const dirty = execFileSync("git", ["status", "--porcelain", "--", ...files], {
    cwd: ROOT,
    env: GIT_ENV,
    encoding: "utf8",
  });
  if (dirty.trim()) throw new Error(`${patch}: commit or stash the changes to ${files.join(", ")}`);

  const commands = commandsFor(rule);
  if (commands.length === 0) return null;
  const applied = gitApply([patch]);
  if (applied.status !== 0) throw new Error(`${patch} does not apply: ${applied.stderr.trim()}`);
  try {
    return commands.some(({ cwd, cmd, args }) => {
      console.log(`  $ (cd ${cwd} && ${cmd} ${args.join(" ")})`);
      return spawnSync(cmd, args, { cwd: join(ROOT, cwd), stdio: "ignore" }).status !== 0;
    });
  } finally {
    gitApply(["-R", patch]);
  }
}

function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === "--check") {
    const problems = checkDrills();
    for (const p of problems) console.error(`::error file=${DRILLS}::${p}`);
    if (problems.length > 0) process.exit(1);
    console.log(`✓ ${drillIds().length} drills apply and name a critical rule`);
    return;
  }
  const rules = new Map(
    /** @type {{ rules: Rule[] }} */ (readJson("tooling/critical-rules.json")).rules.map((r) => [
      r.id,
      r,
    ]),
  );
  const ids = argv.length > 0 ? argv : drillIds();
  /** @type {string[]} */
  const survived = [];
  for (const id of ids) {
    const rule = rules.get(id);
    if (!rule) throw new Error(`no rule "${id}" in tooling/critical-rules.json`);
    console.log(`drill ${id}`);
    const caught = drill(id, rule);
    console.log(
      caught === null ? "  not drilled: no test here runs it" : caught ? "  caught" : "  SURVIVED",
    );
    if (!caught) survived.push(id);
  }
  if (survived.length > 0) {
    for (const id of survived) {
      console.error(`::error file=${DRILLS}/${id}.patch::rule ${id} broke and no test failed`);
    }
    process.exit(1);
  }
  console.log(`✓ every drill was caught (${ids.length})`);
}

if (import.meta.main) main();
