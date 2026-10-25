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
});
