// @ts-check
import { describe, expect, it } from "vitest";
import {
  actionPathProblems,
  findInAction,
  findInWorkflow,
  findProblems,
  RUNNER_EXPRESSIONS,
} from "../workflow-guard.mjs";

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

  it("keeps a job that reads a secret off the runners a variable names", () => {
    const fork = "github.event.pull_request.head.repo.fork && '[\"ubuntu-latest\"]' || ";
    const runsOn = `    runs-on: \${{ fromJSON(${fork}vars.RUNNER_LABELS || '["ubuntu-latest"]') }}\n`;
    const secret = "    env:\n      TOKEN: ${{ secrets.API_TOKEN }}\n";
    expect(findInWorkflow("w.yml", job(runsOn + secret)).map((p) => [p.line, p.rule])).toEqual([
      [4, "secret-runner"],
    ]);
    // The secret before runs-on, and in the next job's scope only.
    const other = `  y:\n${runsOn}`;
    expect(findInWorkflow("w.yml", job(secret + runsOn)).map((p) => p.rule)).toEqual([
      "secret-runner",
    ]);
    expect(findInWorkflow("w.yml", job(`    runs-on: ubuntu-latest\n${secret}`) + other)).toEqual(
      [],
    );
  });

  it("lets GITHUB_TOKEN and a hosted runner through", () => {
    const fork = "github.event.pull_request.head.repo.fork && '[\"ubuntu-latest\"]' || ";
    const runsOn = `    runs-on: \${{ fromJSON(${fork}vars.RUNNER_LABELS || '["ubuntu-latest"]') }}\n`;
    const token = "    env:\n      GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}\n";
    expect(findInWorkflow("w.yml", job(runsOn + token))).toEqual([]);
  });

  it("rejects nohup, which exits on a launchd runner instead of starting the command", () => {
    const text = job("    steps:\n      - run: |\n          nohup pnpm exec cf dev > log 2>&1 &\n");
    expect(findInWorkflow("w.yml", text).map((p) => [p.line, p.rule])).toEqual([[6, "nohup"]]);
    const trap = job(
      "    steps:\n      - run: (trap '' HUP; exec pnpm exec cf dev) > log 2>&1 &\n",
    );
    expect(findInWorkflow("w.yml", trap)).toEqual([]);
  });

  it("rejects pull_request_target, which runs fork code with the repo's secrets", () => {
    const text = "on:\n  pull_request_target:\njobs: {}\n";
    expect(findInWorkflow("w.yml", text).map((p) => p.rule)).toEqual(["trigger"]);
  });

  it("keeps the toolchain install in the composite action, out of the workflows", () => {
    const text = job("    steps:\n      - run: |\n          rustup toolchain install\n");
    expect(findInWorkflow("w.yml", text).map((p) => [p.line, p.rule])).toEqual([
      [6, "rust-toolchain"],
    ]);
    const action = job("    steps:\n      - uses: ./.github/actions/rust-toolchain\n");
    expect(findInWorkflow("w.yml", action)).toEqual([]);
    // Other rustup commands are not the install.
    const component = job("    steps:\n      - run: rustup component add llvm-tools-preview\n");
    expect(findInWorkflow("w.yml", component)).toEqual([]);
  });

  it("rejects a fixed dev Worker port, which two jobs on one machine would fight over", () => {
    for (const host of ["127.0.0.1", "localhost"]) {
      const text = job(`    steps:\n      - run: curl -sf http://${host}:8787/health\n`);
      expect(findInWorkflow("w.yml", text).map((p) => [p.line, p.rule])).toEqual([
        [5, "fixed-port"],
      ]);
    }
    const free = job('    steps:\n      - run: curl -sf "$SPJALL_DEV_URL/health"\n');
    expect(findInWorkflow("w.yml", free)).toEqual([]);
    // The emulator's fixed address is not the host's port.
    const emulator = job("    steps:\n      - run: echo http://10.0.2.2:8787\n");
    expect(findInWorkflow("w.yml", emulator)).toEqual([]);
  });

  it("keeps the exclusive runner lane to android.yml", () => {
    const fork = "github.event.pull_request.head.repo.fork && '[\"ubuntu-latest\"]' || ";
    const runsOn = `    runs-on: \${{ fromJSON(${fork}vars.EXCLUSIVE_RUNNER_LABELS || '["ubuntu-latest"]') }}\n`;
    expect(findInWorkflow("w.yml", job(runsOn)).map((p) => [p.line, p.rule])).toEqual([
      [4, "exclusive-lane"],
    ]);
    expect(findInWorkflow(".github/workflows/android.yml", job(runsOn))).toEqual([]);
  });

  it("runs the toolchain action before anything that writes CARGO_HOME", () => {
    const action = "      - uses: ./.github/actions/rust-toolchain\n";
    const cache = `      - uses: Swatinem/rust-cache@${SHA} # v2.9.2\n`;
    const install = `      - uses: taiki-e/install-action@${SHA} # v2.87.29\n`;
    const cargo = "      - run: cargo install wasm-bindgen-cli --locked\n";
    for (const step of [cache, install, cargo]) {
      expect(
        findInWorkflow("w.yml", job(`    steps:\n${step}`)).map((p) => [p.line, p.rule]),
      ).toEqual([[5, "cargo-home"]]);
      expect(findInWorkflow("w.yml", job(`    steps:\n${action}${step}`))).toEqual([]);
    }
    // The action in one job does not cover the next one.
    const two = job(`    steps:\n${action}  y:\n    steps:\n${cache}`);
    expect(findInWorkflow("w.yml", two).map((p) => [p.line, p.rule])).toEqual([[8, "cargo-home"]]);
  });

  it("wants each runner variable's runs-on expression byte for byte", () => {
    for (const [variable, expression] of Object.entries(RUNNER_EXPRESSIONS)) {
      expect(findInWorkflow("w.yml", job(`    runs-on: ${expression}\n`))).toEqual(
        variable === "EXCLUSIVE_RUNNER_LABELS"
          ? [expect.objectContaining({ rule: "exclusive-lane" })]
          : [],
      );
    }
    // Still fork-safe, yet not the canonical text: an extra space, another hosted image.
    const spaced = RUNNER_EXPRESSIONS.RUNNER_LABELS?.replace("fromJSON(", "fromJSON( ") ?? "";
    const other =
      RUNNER_EXPRESSIONS.RUNNER_LABELS?.replaceAll("ubuntu-latest", "ubuntu-24.04") ?? "";
    for (const runsOn of [spaced, other]) {
      expect(findInWorkflow("w.yml", job(`    runs-on: ${runsOn}\n`)).map((p) => p.rule)).toEqual([
        "runner-expr",
      ]);
    }
    // A variable the guard does not know has no canonical form.
    const unknown =
      RUNNER_EXPRESSIONS.RUNNER_LABELS?.replaceAll("RUNNER_LABELS", "NEW_LABELS") ?? "";
    expect(findInWorkflow("w.yml", job(`    runs-on: ${unknown}\n`)).map((p) => p.rule)).toEqual([
      "runner-expr",
    ]);
  });

  it("counts core-artifact as the toolchain action, and walks the composite actions", () => {
    const cache = `      - uses: Swatinem/rust-cache@${SHA} # v2.9.2\n`;
    const artifact = "      - uses: ./.github/actions/core-artifact\n";
    expect(findInWorkflow("w.yml", job(`    steps:\n${artifact}${cache}`))).toEqual([]);
    const action = "runs:\n  using: composite\n  steps:\n    - uses: pnpm/action-setup@v6\n";
    expect(findInAction(".github/actions/x/action.yml", action).map((p) => p.rule)).toEqual([
      "pin",
    ]);
  });

  it("puts every local action a path-filtered workflow uses, through its actions too, in each path filter", () => {
    const uses = new Map([
      ["core-artifact", new Set(["rust-toolchain"])],
      ["rust-toolchain", new Set()],
    ]);
    const steps = "jobs:\n  x:\n    steps:\n      - uses: ./.github/actions/core-artifact\n";
    const filter = (/** @type {string[]} */ extra) =>
      ["    paths:", '      - "android/**"', ...extra.map((e) => `      - "${e}"`)].join("\n");
    const both = [".github/actions/core-artifact/**", ".github/actions/rust-toolchain/**"];
    const text = (/** @type {string[]} */ pr, /** @type {string[]} */ push) =>
      `on:\n  pull_request:\n${filter(pr)}\n  push:\n${filter(push)}\n${steps}`;
    expect(actionPathProblems("w.yml", text(both, both), uses)).toEqual([]);
    // The push filter misses the action core-artifact itself runs.
    expect(
      actionPathProblems("w.yml", text(both, [both[0] ?? ""]), uses).map((p) => [p.line, p.rule]),
    ).toEqual([[8, "action-paths"]]);
    // A workflow with no path filter runs on every change already.
    expect(actionPathProblems("w.yml", `on: push\n${steps}`, uses)).toEqual([]);
  });
});
