// @ts-check
// docs/commands.md names the pnpm workspace; the claim drifted once (#579), so
// the members it lists are compared with pnpm-workspace.yaml.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT } from "../lib/repo.mjs";

/** @param {string} yaml */
function workspacePackages(yaml) {
  return [...yaml.matchAll(/^\s+-\s+["']?([^"'\s#]+)["']?\s*$/gm)].map((m) => m[1] ?? "").sort();
}

/**
 * The paths in the backticks of "one workspace (the root, `a/`, ...)".
 * @param {string} doc
 */
function documentedPackages(doc) {
  const sentence = /one workspace \(([^)]*)\)/.exec(doc.replace(/\s+/g, " "))?.[1] ?? "";
  return [...sentence.matchAll(/`([^`]+)`/g)].map((m) => (m[1] ?? "").replace(/\/$/, "")).sort();
}

describe("docs/commands.md workspace statement", () => {
  const doc = readFileSync(join(ROOT, "docs/commands.md"), "utf8");
  const yaml = readFileSync(join(ROOT, "pnpm-workspace.yaml"), "utf8");

  it("lists exactly the packages in pnpm-workspace.yaml", () => {
    const listed = workspacePackages(yaml);
    expect(listed.length).toBeGreaterThan(0);
    expect(documentedPackages(doc)).toEqual(listed);
  });

  it("notices a member the sentence leaves out", () => {
    const stale = doc.replace(", `web/`", "");
    expect(documentedPackages(stale)).not.toEqual(workspacePackages(yaml));
  });
});
