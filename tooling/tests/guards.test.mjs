// @ts-check
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkRegistry, observeStages, readSources, stagesOf } from "../lib/guards-registry.mjs";
import { ROOT } from "../lib/repo.mjs";

const packageJson = {
  scripts: {
    check: "pnpm run lint && pnpm run check:a && pnpm run check:b",
    lint: "oxlint",
    "check:a": "node tooling/a.mjs",
    "check:b": "node tooling/b.mjs --check && node tooling/c.mjs",
    gen: "node tooling/b.mjs",
    test: "vitest run",
  },
};
const lefthook = `
# node tooling/commented.mjs
pre-commit:
  commands:
    a:
      run: node tooling/a.mjs --staged
pre-push:
  commands:
    b:
      run: node tooling/b.mjs --check
    t:
      run: pnpm test
commit-msg:
  commands:
    m:
      run: node tooling/m.mjs --message {1}
`;
const workflows = {
  ".github/workflows/ci.yml":
    "steps:\n  - run: pnpm run check\n  - run: node tooling/d.mjs --base x # tail",
  ".github/actions/x/action.yml": "runs:\n  steps:\n    - run: node tooling/e.mjs",
  ".github/workflows/paths.yml": 'paths:\n  - "tooling/f.mjs"\n',
};

/** @param {Partial<Parameters<typeof checkRegistry>[0]>} over */
function problems(over) {
  const registry = {
    guards: [
      { name: "a", script: "a", stages: ["commit", "ci"] },
      { name: "b", script: "b", stages: ["push", "ci"], flag: "--check" },
      { name: "c", script: "c", stages: ["ci"], reason: "slow" },
      { name: "d", script: "d", stages: ["ci"], reason: "needs the PR base" },
      { name: "e", script: "e", stages: ["ci"], reason: "composite action" },
      { name: "m", script: "m", stages: ["commit"] },
    ],
    tools: [{ script: "lib-ish", reason: "a helper" }],
  };
  const files = ["a", "b", "c", "d", "e", "m", "lib-ish"];
  return checkRegistry({
    registry,
    files,
    observed: observeStages({ packageJson, lefthook, workflows }),
    ...over,
  });
}

describe("observeStages", () => {
  const observed = observeStages({ packageJson, lefthook, workflows });
  const stages = (/** @type {string} */ s, flag = "") => [...stagesOf(observed, s, flag)].sort();

  it("maps lefthook sections to commit and push and follows pnpm run chains to ci", () => {
    expect(stages("a")).toEqual(["ci", "commit"]);
    expect(stages("m")).toEqual(["commit"]);
    expect(stages("c")).toEqual(["ci"]);
  });

  it("counts a flagged invocation only when the flag is present", () => {
    expect(stages("b", "--check")).toEqual(["ci", "push"]);
    const bare = observeStages({
      packageJson: { scripts: { check: "node tooling/b.mjs" } },
      lefthook: "",
      workflows: { "w.yml": "run: pnpm run check" },
    });
    expect([...stagesOf(bare, "b", "--check")]).toEqual([]);
    expect([...stagesOf(bare, "b")]).toEqual(["ci"]);
  });

  it("ignores comments, path filters and unreachable scripts", () => {
    expect(observed.has("commented")).toBe(false);
    expect(observed.has("f")).toBe(false);
    expect(stages("d")).toEqual(["ci"]);
    expect(stages("e")).toEqual(["ci"]);
  });
});

describe("checkRegistry", () => {
  it("passes a consistent registry", () => {
    expect(problems({})).toEqual([]);
  });

  it("fails a guard that runs at a stage it is not registered for", () => {
    const lh = lefthook.replace(
      "node tooling/a.mjs --staged",
      "node tooling/a.mjs --staged\n    x:\n      run: node tooling/c.mjs",
    );
    expect(problems({ observed: observeStages({ packageJson, lefthook: lh, workflows }) })).toEqual(
      [expect.stringContaining("c: runs at commit")],
    );
  });

  it("fails a registered stage that does not run the guard", () => {
    const lh = lefthook.replace("node tooling/a.mjs --staged", "echo nothing");
    expect(problems({ observed: observeStages({ packageJson, lefthook: lh, workflows }) })).toEqual(
      [expect.stringContaining("a: registered for commit")],
    );
  });

  it("fails an unregistered guard that is added to the check chain", () => {
    const pkg = {
      scripts: { ...packageJson.scripts, "check:a": "node tooling/a.mjs && node tooling/z.mjs" },
    };
    expect(
      problems({
        observed: observeStages({ packageJson: pkg, lefthook, workflows }),
        files: ["a", "b", "c", "d", "e", "m", "lib-ish", "z"],
      }),
    ).toEqual([expect.stringContaining("z: tooling/z.mjs is not in tooling/guards.json")]);
  });

  it("fails a script nobody runs and nobody registered", () => {
    expect(problems({ files: ["a", "b", "c", "d", "e", "m", "lib-ish", "orphan"] })).toEqual([
      expect.stringContaining("orphan: tooling/orphan.mjs is not in tooling/guards.json"),
    ]);
  });

  it("fails a ci-only guard without a reason", () => {
    const registry = {
      guards: [
        { name: "a", script: "a", stages: ["commit", "ci"] },
        { name: "b", script: "b", stages: ["push", "ci"], flag: "--check" },
        { name: "c", script: "c", stages: ["ci"] },
        { name: "d", script: "d", stages: ["ci"], reason: "x" },
        { name: "e", script: "e", stages: ["ci"], reason: "x" },
        { name: "m", script: "m", stages: ["commit"] },
      ],
      tools: [{ script: "lib-ish", reason: "a helper" }],
    };
    expect(problems({ registry })).toEqual([
      expect.stringContaining("c: runs in CI only, so it needs a reason"),
    ]);
  });

  it("fails a duplicate script, an unknown stage and a missing file", () => {
    const registry = {
      guards: [
        { name: "a", script: "a", stages: ["commit", "ci"] },
        { name: "a2", script: "a", stages: ["commit", "ci"] },
        { name: "b", script: "b", stages: ["push", "ci", "bogus"], flag: "--check" },
        { name: "gone", script: "gone", stages: ["ci"], reason: "x" },
      ],
      tools: [],
    };
    const out = problems({ registry }).join("\n");
    expect(out).toContain("a2: script a is registered twice");
    expect(out).toContain('b: unknown stage "bogus"');
    expect(out).toContain("gone: tooling/gone.mjs does not exist");
  });
});

describe("the real repo", () => {
  it("registers every guard at the stages it runs at", () => {
    const sources = readSources(ROOT);
    const registry = JSON.parse(readFileSync(`${ROOT}/tooling/guards.json`, "utf8"));
    const files = readdirSync(`${ROOT}/tooling`)
      .filter((f) => f.endsWith(".mjs"))
      .map((f) => f.slice(0, -4));
    expect(checkRegistry({ registry, files, observed: observeStages(sources) })).toEqual([]);
  });
});
