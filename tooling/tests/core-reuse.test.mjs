// @ts-check
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { artifactName, pick } from "../core-reuse.mjs";
import { copyRepo, git, initRepo } from "./helpers.mjs";

const INPUTS = ["core/rust-toolchain.toml", "core/artifact.lock.json", "identifiers"];

/** A committed copy of what the key reads, plus core.yml. */
function fixture() {
  const root = copyRepo(INPUTS);
  mkdirSync(join(root, ".github/workflows"), { recursive: true });
  writeFileSync(join(root, ".github/workflows/core.yml"), "name: core\n");
  writeFileSync(join(root, "core/lib.rs"), "fn main() {}\n");
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
  git(root, ["commit", "-q", "-am", path]);
}

describe("artifactName", () => {
  it("is stable for the same inputs and names its platform", () => {
    const root = fixture();
    const name = artifactName("android", { root });
    expect(name).toMatch(/^core-android-[0-9a-f]{40}$/);
    expect(artifactName("android", { root })).toBe(name);
  });

  it("changes with the core tree, the identifiers and the workflow, and nothing else", () => {
    const root = fixture();
    const first = artifactName("android", { root });
    commit(root, "README.md", "still outside\n");
    expect(artifactName("android", { root })).toBe(first);

    commit(root, "core/lib.rs", "fn main() { println!() }\n");
    const second = artifactName("android", { root });
    expect(second).not.toBe(first);

    commit(root, ".github/workflows/core.yml", "name: core\n# a changed build step\n");
    const third = artifactName("android", { root });
    expect(third).not.toBe(second);

    commit(root, "identifiers/ids.json", '{"changed": true}\n');
    expect(artifactName("android", { root })).not.toBe(third);
  });

  it("reads the committed tree, so an uncommitted edit cannot borrow an old zip's name", () => {
    const root = fixture();
    const first = artifactName("android", { root });
    writeFileSync(join(root, "core/lib.rs"), "fn main() { dirty() }\n");
    expect(artifactName("android", { root })).toBe(first);
  });

  it("keys iOS on the Xcode version and refuses without one", () => {
    const root = fixture();
    expect(() => artifactName("ios", { root })).toThrow(/Xcode/);
    const a = artifactName("ios", { root, xcode: "Xcode 26.0 Build version 17A324" });
    const b = artifactName("ios", { root, xcode: "Xcode 26.1 Build version 17B55" });
    expect(a).toMatch(/^core-ios-[0-9a-f]{40}$/);
    expect(a).not.toBe(b);
  });

  it("refuses a platform it does not know", () => {
    expect(() => artifactName(/** @type {any} */ ("windows"), { root: fixture() })).toThrow();
  });
});

describe("pick", () => {
  const REPO = 101;
  const NAME = `core-android-${"a".repeat(40)}`;
  /**
   * @param {number} id
   * @param {Partial<{ name: string, expired: boolean, created_at: string, head: number }>} [over]
   */
  const artifact = (id, over = {}) => ({
    id,
    name: over.name ?? NAME,
    expired: over.expired ?? false,
    created_at: over.created_at ?? "2026-10-01T00:00:00Z",
    workflow_run: { id: id * 10, repository_id: REPO, head_repository_id: over.head ?? REPO },
  });

  it("takes the newest live artifact of this repo with exactly that name", () => {
    const found = pick(
      [
        artifact(1, { created_at: "2026-10-01T00:00:00Z" }),
        artifact(2, { created_at: "2026-10-03T00:00:00Z" }),
        artifact(3, { created_at: "2026-10-02T00:00:00Z" }),
      ],
      NAME,
      REPO,
    );
    expect(found).toEqual({ artifactId: 2, runId: 20 });
  });

  it("never takes a fork's run, whose workflow ran the fork's own code", () => {
    expect(pick([artifact(1, { head: 999 })], NAME, REPO)).toBeNull();
  });

  it("skips an expired artifact and one whose name only starts the same", () => {
    expect(
      pick([artifact(1, { expired: true }), artifact(2, { name: `${NAME}-x` })], NAME, REPO),
    ).toBeNull();
  });
});
