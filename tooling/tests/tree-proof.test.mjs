// @ts-check
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pick } from "../core-reuse.mjs";
import { ROOT } from "../lib/repo.mjs";
import { proofName, pushPaths } from "../tree-proof.mjs";
import { treeProofProblems } from "../workflow-guard.mjs";
import { git, initRepo, tempDir } from "./helpers.mjs";

const WORKFLOW = `name: app
on:
  pull_request:
    paths:
      - "app/**"
      - "tooling/floor.*"
      - ".github/workflows/app.yml"
  push:
    branches: [main]
    paths:
      - "app/**"
      - "tooling/floor.*"
      - ".github/workflows/app.yml"
    tags: ["v*"]
  schedule:
    - cron: "23 4 * * *"

jobs:
  build:
    runs-on: ubuntu-latest
`;

/** A committed repository with one workflow that filters on app/. */
function fixture() {
  const root = tempDir("tree-proof-");
  mkdirSync(join(root, ".github/workflows"), { recursive: true });
  mkdirSync(join(root, "app"));
  mkdirSync(join(root, "tooling"));
  writeFileSync(join(root, ".github/workflows/app.yml"), WORKFLOW);
  writeFileSync(join(root, "app/a.txt"), "a\n");
  writeFileSync(join(root, "app/b.txt"), "b\n");
  writeFileSync(join(root, "tooling/floor.json"), "{}\n");
  writeFileSync(join(root, "README.md"), "outside\n");
  initRepo(root);
  return root;
}

/**
 * @param {string} root
 * @param {string} path
 * @param {string} text
 */
function commit(root, path, text) {
  writeFileSync(join(root, path), text);
  git(root, ["add", path]);
  git(root, ["commit", "-q", "-m", path]);
}

describe("pushPaths", () => {
  it("reads the push filter and stops at the next trigger", () => {
    expect(pushPaths(WORKFLOW)).toEqual(["app/**", "tooling/floor.*", ".github/workflows/app.yml"]);
  });

  it("is empty for a push with no filter", () => {
    expect(pushPaths("on:\n  pull_request:\n  push:\n    branches: [main]\n\njobs:\n")).toEqual([]);
  });

  it("refuses a workflow that has no push", () => {
    expect(() => pushPaths("on:\n  pull_request:\n")).toThrow(/no push trigger/);
  });
});

describe("proofName", () => {
  it("moves with a file under the filter, its glob and the workflow, and with nothing else", () => {
    const root = fixture();
    const first = proofName("app", root);
    expect(first).toMatch(/^tree-proof-app-[0-9a-f]{40}$/);

    commit(root, "README.md", "changed\n");
    expect(proofName("app", root)).toBe(first);

    commit(root, "app/a.txt", "a2\n");
    const second = proofName("app", root);
    expect(second).not.toBe(first);

    commit(root, "tooling/floor.json", '{"x":1}\n');
    const third = proofName("app", root);
    expect(third).not.toBe(second);

    commit(root, ".github/workflows/app.yml", `${WORKFLOW}# changed\n`);
    expect(proofName("app", root)).not.toBe(third);
  });

  it("does not move for a file a job generates and never adds", () => {
    const root = fixture();
    const first = proofName("app", root);
    writeFileSync(join(root, "app/generated.txt"), "out\n");
    writeFileSync(join(root, "app/a.txt"), "edited in the job\n");
    expect(proofName("app", root)).toBe(first);
  });

  it("names the whole tree when the workflow has no filter", () => {
    const root = fixture();
    writeFileSync(
      join(root, ".github/workflows/all.yml"),
      "on:\n  pull_request:\n  push:\n    branches: [main]\n",
    );
    git(root, ["add", "."]);
    git(root, ["commit", "-q", "-m", "all"]);
    const first = proofName("all", root);
    commit(root, "README.md", "changed\n");
    expect(proofName("all", root)).not.toBe(first);
  });

  it("refuses a filter that selects nothing, which would give every commit one name", () => {
    const root = fixture();
    commit(root, ".github/workflows/app.yml", 'on:\n  push:\n    paths:\n      - "gone/**"\n');
    git(root, ["rm", "-q", ".github/workflows/app.yml", "--cached"]);
    expect(() => proofName("app", root)).toThrow(/selects no file/);
  });
});

describe("the drill: what a merge finds", () => {
  /** @param {string} name @param {number} repo */
  const marker = (name, repo) => ({
    id: 1,
    name,
    expired: false,
    created_at: "2026-10-30T12:00:00Z",
    workflow_run: { id: 77, head_repository_id: repo },
  });

  /** Two PRs off one main, each tested as the merge with the main it saw. */
  function twoPrs() {
    const root = fixture();
    git(root, ["branch", "-M", "main"]);
    git(root, ["checkout", "-q", "-b", "pr-a"]);
    commit(root, "app/a.txt", "a from A\n");
    const testedA = proofName("app", root);
    git(root, ["checkout", "-q", "main"]);
    git(root, ["checkout", "-q", "-b", "pr-b"]);
    commit(root, "app/b.txt", "b from B\n");
    const testedB = proofName("app", root);
    return { root, markers: [marker(testedA, 1), marker(testedB, 1)] };
  }

  /**
   * @param {string} root
   * @param {string} branch
   */
  function squash(root, branch) {
    git(root, ["checkout", "-q", "main"]);
    git(root, ["merge", "-q", "--squash", branch]);
    git(root, ["commit", "-q", "-m", `merge ${branch}`]);
  }

  it("a merge landing the tree its PR tested finds the marker and starts nothing", () => {
    const { root, markers } = twoPrs();
    squash(root, "pr-a");
    expect(pick(markers, proofName("app", root), 1)).toMatchObject({ runId: 77 });
  });

  it("a merge combining two PRs finds no marker and runs in full", () => {
    const { root, markers } = twoPrs();
    squash(root, "pr-a");
    squash(root, "pr-b");
    expect(pick(markers, proofName("app", root), 1)).toBeNull();
  });

  it("a merge past a change outside the filter still finds the marker", () => {
    const { root, markers } = twoPrs();
    git(root, ["checkout", "-q", "main"]);
    commit(root, "README.md", "docs moved on\n");
    squash(root, "pr-a");
    expect(pick(markers, proofName("app", root), 1)).toMatchObject({ runId: 77 });
  });

  it("a fork's marker of the same tree counts for nothing", () => {
    const { root, markers } = twoPrs();
    squash(root, "pr-a");
    const forged = markers.map((found) => ({
      ...found,
      workflow_run: { id: 77, head_repository_id: 2 },
    }));
    expect(pick(forged, proofName("app", root), 1)).toBeNull();
  });
});

describe("rule 12", () => {
  const OPEN = "${{ !cancelled() && needs.gate.outputs.run != 'false' }}";
  /** @param {{ condition?: string, proofNeeds?: string, proofIf?: string, proof?: boolean }} [over] */
  const workflow = ({ condition = OPEN, proofNeeds = "[a, b]", proofIf, proof = true } = {}) => {
    const results = proofIf ?? "needs.a.result == 'success' && needs.b.result == 'success'";
    return `jobs:
  gate:
    permissions:
      actions: read
    uses: ./.github/workflows/tree-proof.yml
  a:
    needs: gate
    if: ${condition}
  b:
    needs: gate
    if: ${OPEN}
${proof ? `  proof:\n    needs: ${proofNeeds}\n    if: \${{ ${results} }}\n` : ""}`;
  };
  const rules = (/** @type {string} */ text) =>
    treeProofProblems("w.yml", text).map((problem) => problem.message);

  it("passes a gated workflow whose proof waits on every skippable job", () => {
    expect(rules(workflow())).toEqual([]);
    expect(rules("jobs:\n  a:\n    runs-on: x\n")).toEqual([]);
  });

  it("refuses a gated job a failed gate would skip", () => {
    const [message] = rules(workflow({ condition: "needs.gate.outputs.run == 'true'" }));
    expect(message).toMatch(/must run unless the gate says so/);
  });

  it("refuses a proof that would vouch for a job it never waited for", () => {
    expect(rules(workflow({ proofNeeds: "[a]" }))[0]).toMatch(/proof must need b/);
    expect(rules(workflow({ proofIf: "needs.a.result == 'success'" }))[0]).toMatch(
      /needs\.b\.result == 'success'/,
    );
  });

  it("refuses a gate with no proof, which could never skip anything", () => {
    expect(rules(workflow({ proof: false }))[0]).toMatch(/needs a proof job/);
  });

  it("refuses a call of the file that does not grant what its gate job asks", () => {
    const call = (/** @type {string} */ grant) =>
      `jobs:\n  proof:\n${grant}    uses: ./.github/workflows/tree-proof.yml\n`;
    expect(treeProofProblems("w.yml", call("")).map((p) => p.message)).toEqual([
      "proof calls tree-proof.yml and must grant actions: read",
    ]);
    expect(treeProofProblems("w.yml", call("    permissions:\n      actions: read\n"))).toEqual([]);
  });

  it("holds the filters of the real workflows: a PR runs on everything a push looks for", () => {
    for (const name of ["android", "ios", "core", "web", "backend", "interop", "rename-drill"]) {
      const text = readFileSync(join(ROOT, `.github/workflows/${name}.yml`), "utf8");
      const pull = text.split(/^ {2}push:/m)[0]?.split(/^ {2}pull_request:/m)[1] ?? "";
      const listed = [...pull.matchAll(/^\s+-\s+"([^"]+)"/gm)].map((match) => match[1]);
      expect(listed.length, name).toBeGreaterThan(0);
      expect(listed, name).toEqual(expect.arrayContaining(pushPaths(text)));
    }
  });
});
