// @ts-check
import { describe, expect, it } from "vitest";
import { scopeSteps, stepsFromPackage } from "../check.mjs";
import { runCommand, runSteps, summaryLine, validateSteps } from "../lib/run-steps.mjs";

/** A fake executor: records start and end order, fails the steps named in `failing`. */
function fake(
  /** @type {string[]} */ failing = [],
  /** @type {Record<string, number>} */ delays = {},
) {
  /** @type {string[]} */
  const events = [];
  let live = 0;
  let peak = 0;
  return {
    events,
    peak: () => peak,
    run: async (/** @type {{ name: string }} */ step) => {
      live++;
      peak = Math.max(peak, live);
      events.push(`start ${step.name}`);
      await new Promise((r) => setTimeout(r, delays[step.name] ?? 5));
      events.push(`end ${step.name}`);
      live--;
      return {
        code: failing.includes(step.name) ? 1 : 0,
        output: `out ${step.name}\n`,
      };
    },
  };
}
const step = (/** @type {string} */ name, /** @type {string[]} */ after = []) => ({
  name,
  command: name,
  after,
});

describe("runSteps", () => {
  it("runs independent steps at once, never more than the limit", async () => {
    const f = fake();
    const steps = ["a", "b", "c", "d", "e"].map((n) => step(n));
    const results = await runSteps(steps, { limit: 3, run: f.run });
    expect(results).toHaveLength(5);
    expect(f.peak()).toBe(3);
  });

  it("holds an ordering: a step starts only after the one it waits for ended", async () => {
    const f = fake([], { lint: 30 });
    await runSteps([step("lint"), step("format", ["lint"]), step("other")], {
      limit: 4,
      run: f.run,
    });
    expect(f.events.indexOf("start format")).toBeGreaterThan(f.events.indexOf("end lint"));
    expect(f.events.indexOf("start other")).toBeLessThan(f.events.indexOf("end lint"));
  });

  it("propagates a failure and skips what waited for it", async () => {
    const f = fake(["lint"]);
    const results = await runSteps([step("lint"), step("format", ["lint"]), step("other")], {
      limit: 4,
      run: f.run,
    });
    const by = Object.fromEntries(results.map((r) => [r.name, r.status]));
    expect(by).toEqual({ lint: "fail", format: "skipped", other: "pass" });
    expect(f.events).not.toContain("start format");
    expect(summaryLine(results, 1500)).toBe("1 passed, 1 failed, 1 skipped of 3 steps in 1.5 s");
  });

  it("keeps each step's own output and runs real shell commands", async () => {
    const ok = await runCommand("echo out; echo err 1>&2");
    expect(ok.code).toBe(0);
    expect(ok.output).toContain("out");
    expect(ok.output).toContain("err");
    const results = await runSteps(
      [
        { name: "bad", command: "echo boom; exit 3" },
        { name: "good", command: "echo fine" },
      ],
      { limit: 2 },
    );
    expect(results.find((r) => r.name === "bad")).toMatchObject({
      status: "fail",
      output: "boom\n",
    });
    expect(results.find((r) => r.name === "good")).toMatchObject({
      status: "pass",
      output: "fine\n",
    });
  });

  it("rejects a plan with an unknown prerequisite, a duplicate or a cycle", () => {
    expect(() => validateSteps([step("a", ["zz"])])).toThrow(/not a step/);
    expect(() => validateSteps([step("a"), step("a")])).toThrow(/twice/);
    expect(() => validateSteps([step("a", ["b"]), step("b", ["a"])])).toThrow(/cycle/);
  });
});

describe("stepsFromPackage", () => {
  const pkg = {
    scripts: { "check:chain": "pnpm run lint && pnpm run check:a", lint: "x", "check:a": "y" },
    guardRunner: { after: { "check:a": ["lint"] } },
  };
  it("reads the chain in order with its orderings", () => {
    expect(stepsFromPackage(pkg)).toEqual([
      { name: "lint", command: "pnpm run lint", after: [] },
      { name: "check:a", command: "pnpm run check:a", after: ["lint"] },
    ]);
  });
  it("refuses a chain entry that is not a pnpm run of a real script", () => {
    expect(() => stepsFromPackage({ scripts: { "check:chain": "pnpm run nope" } })).toThrow(
      /no script/,
    );
    expect(() => stepsFromPackage({ scripts: { "check:chain": "node x.mjs" } })).toThrow(/not a/);
  });
});

describe("--changed", () => {
  const steps = [step("lint"), step("format", ["lint"]), step("guard")];
  const scoped = {
    lint: { command: "oxlint {files}", match: "\\.(js|ts)$" },
    format: { command: "oxfmt {files}", match: "\\.(js|ts|md)$" },
  };
  it("passes the changed files that match to a scoped step, quoted, and runs the rest in full", () => {
    const r = scopeSteps(steps, scoped, ["a.ts", "docs/it's.md", "b.rs"]);
    expect(r.steps.map((s) => s.command)).toEqual([
      "oxlint 'a.ts'",
      "oxfmt 'a.ts' 'docs/it'\\''s.md'",
      "guard",
    ]);
    expect(r.dropped).toEqual([]);
  });
  it("drops a scoped step with no matching file, and the ordering that pointed at it", () => {
    const r = scopeSteps(steps, scoped, ["notes.md"]);
    expect(r.dropped).toEqual(["lint"]);
    expect(r.steps.map((s) => s.name)).toEqual(["format", "guard"]);
    expect(r.steps[0]?.after).toEqual([]);
    expect(() => validateSteps(r.steps)).not.toThrow();
  });
});
