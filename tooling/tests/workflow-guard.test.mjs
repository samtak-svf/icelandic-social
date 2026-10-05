// @ts-check
import { describe, expect, it } from "vitest";
import { findInWorkflow, findProblems } from "../workflow-guard.mjs";

const SHA = "a".repeat(40);
const job = (/** @type {string} */ body) => `on: push\njobs:\n  x:\n${body}`;

describe("workflow-guard", () => {
  it("passes on the repo as it is", () => {
    expect(findProblems()).toEqual([]);
  });

  it("rejects an action pinned to a tag or branch", () => {
    const text = job("    steps:\n      - uses: actions/checkout@v5\n      - uses: org/a/b@main\n");
    expect(findInWorkflow("w.yml", text).map((p) => [p.line, p.rule])).toEqual([
      [5, "pin"],
      [6, "pin"],
    ]);
  });

  it("wants the tag beside the SHA, so a reader and Dependabot can tell the version", () => {
    const bare = job(`    steps:\n      - uses: actions/checkout@${SHA}\n`);
    expect(findInWorkflow("w.yml", bare).map((p) => p.rule)).toEqual(["pin"]);
    const tagged = job(`    steps:\n      - uses: actions/checkout@${SHA} # v5.1.0\n`);
    expect(findInWorkflow("w.yml", tagged)).toEqual([]);
  });

  it("leaves local and docker actions alone", () => {
    const text = job("    steps:\n      - uses: ./.github/a\n      - uses: docker://alpine:3\n");
    expect(findInWorkflow("w.yml", text)).toEqual([]);
  });

  it("rejects a runner variable that a fork PR could reach", () => {
    const text = job("    runs-on: ${{ fromJSON(vars.RUNNER_LABELS || '[\"ubuntu-latest\"]') }}\n");
    expect(findInWorkflow("w.yml", text).map((p) => p.rule)).toEqual(["fork-runner"]);
  });

  it("accepts a runner variable with the hosted fallback for forks", () => {
    const runsOn =
      "${{ fromJSON(github.event.pull_request.head.repo.fork && '[\"ubuntu-latest\"]' || vars.RUNNER_LABELS || '[\"ubuntu-latest\"]') }}";
    expect(findInWorkflow("w.yml", job(`    runs-on: ${runsOn}\n`))).toEqual([]);
  });

  it("rejects pull_request_target, which runs fork code with the repo's secrets", () => {
    const text = "on:\n  pull_request_target:\njobs: {}\n";
    expect(findInWorkflow("w.yml", text).map((p) => p.rule)).toEqual(["trigger"]);
  });
});
