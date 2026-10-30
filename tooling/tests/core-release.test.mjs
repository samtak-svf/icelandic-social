// @ts-check
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  coreVersion,
  lockFor,
  nextPatch,
  release,
  setGradleVersion,
  setXcodegenVersion,
} from "../core-release.mjs";
import { git, tempDir } from "./helpers.mjs";

const hex = (/** @type {string} */ digit) => digit.repeat(64);
const LOCK = {
  version: "0.1.0",
  androidNdk: "30.0.16248370",
  baseUrl: "https://example.invalid/core-v{version}",
  artifacts: {
    android: { file: "spjall-core-android.zip", sha256: hex("0") },
    ios: { file: "spjall-core-ios.zip", sha256: hex("0") },
    web: { file: "spjall-core-web.zip", sha256: hex("0") },
  },
};
const ASSETS = [
  { name: "spjall-core-android.zip", digest: `sha256:${hex("a")}` },
  { name: "spjall-core-android.zip.sha256", digest: `sha256:${hex("f")}` },
  { name: "spjall-core-ios.zip", digest: `sha256:${hex("b")}` },
  { name: "spjall-core-web.zip", digest: `sha256:${hex("c")}` },
];
const published = { release: () => ({ assets: ASSETS }), runs: () => [] };
const quiet = () => {};

/** @param {string} root @param {string} version */
const setCore = (root, version) => {
  writeFileSync(
    join(root, "core/Cargo.toml"),
    `[workspace]\nresolver = "3"\n\n[workspace.package]\nversion = "${version}"\nedition = "2024"\n`,
  );
};

/** A clone with an `origin` of its own, on main, holding what the command reads. */
function fixture(version = "0.2.0") {
  const dir = tempDir("core-release-");
  const origin = join(dir, "origin.git");
  const root = join(dir, "clone");
  mkdirSync(origin);
  git(origin, ["init", "-q", "--bare", "-b", "main"]);
  mkdirSync(root);
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "user.name", "Test"]);
  git(root, ["config", "user.email", "test@example.invalid"]);
  git(root, ["config", "core.hooksPath", "/dev/null"]);
  git(root, ["remote", "add", "origin", origin]);
  for (const path of ["core", "android/app", "ios"])
    mkdirSync(join(root, path), { recursive: true });
  setCore(root, version);
  writeFileSync(join(root, "core/artifact.lock.json"), `${JSON.stringify(LOCK, null, 2)}\n`);
  writeFileSync(join(root, "android/app/build.gradle.kts"), '        versionName = "1.2.3"\n');
  writeFileSync(join(root, "ios/project.yml"), '    MARKETING_VERSION: "1.2.3"\n');
  git(root, ["add", "."]);
  git(root, ["commit", "-q", "-m", "base"]);
  git(root, ["push", "-q", "origin", "main"]);
  return { root, origin };
}

/** @param {string} origin */
const tags = (origin) =>
  git(origin, ["for-each-ref", "--format=%(refname:short) %(objectname)", "refs/tags"]);

describe("the pure parts", () => {
  it("reads the workspace version, not a dependency's", () => {
    const toml = '[package]\nversion = "9.9.9"\n\n[workspace.package]\nversion = "0.51.0"\n';
    expect(coreVersion(toml)).toBe("0.51.0");
    expect(() => coreVersion('[package]\nversion = "9.9.9"\n')).toThrow("no version");
  });

  it("takes the next patch", () => {
    expect(nextPatch("0.19.0")).toBe("0.19.1");
  });

  it("writes the zip's digest, never the digest of its .sha256 file, and keeps the rest", () => {
    const next = lockFor(LOCK, "0.2.0", ASSETS);
    expect(next.version).toBe("0.2.0");
    expect(next.androidNdk).toBe(LOCK.androidNdk);
    expect(next.baseUrl).toBe(LOCK.baseUrl);
    expect(next.artifacts.android).toEqual({ file: "spjall-core-android.zip", sha256: hex("a") });
    expect(next.artifacts.web.sha256).toBe(hex("c"));
  });

  it("refuses a release short of a digest, which the lock could never verify", () => {
    expect(() => lockFor(LOCK, "0.2.0", ASSETS.slice(1))).toThrow("spjall-core-android.zip");
    const blank = ASSETS.map((asset) => ({ ...asset, digest: null }));
    expect(() => lockFor(LOCK, "0.2.0", blank)).toThrow("no SHA-256 digest");
  });

  it("refuses a file that does not hold exactly one version line", () => {
    expect(setGradleVersion('  versionName = "1.0.0"\n', "1.0.1")).toBe(
      '  versionName = "1.0.1"\n',
    );
    expect(setXcodegenVersion('  MARKETING_VERSION: "1.0.0"\n', "1.0.1")).toBe(
      '  MARKETING_VERSION: "1.0.1"\n',
    );
    expect(() => setGradleVersion("nothing here\n", "1.0.1")).toThrow("found 0");
    expect(() =>
      setXcodegenVersion('  MARKETING_VERSION: "1"\n  MARKETING_VERSION: "2"\n', "3.0.0"),
    ).toThrow("found 2");
  });
});

describe("release", () => {
  it("tags main, then leaves the lock and both app versions committed on a branch", async () => {
    const { root, origin } = fixture();
    const sha = git(root, ["rev-parse", "HEAD"]).trim();

    const done = await release({ version: "0.2.0", root, github: published, log: quiet });

    expect(done).toEqual({ branch: "feat/apps-core-0.2.0", app: "1.2.4", sha });
    expect(tags(origin).trim()).toBe(`core-v0.2.0 ${sha}`);
    expect(git(root, ["rev-parse", "--abbrev-ref", "HEAD"]).trim()).toBe(done.branch);
    expect(git(root, ["log", "-1", "--format=%s"]).trim()).toBe(
      "feat(apps): version 1.2.4 on core 0.2.0",
    );
    expect(
      git(root, ["show", "--name-only", "--format=", "HEAD"]).trim().split("\n").sort(),
    ).toEqual(["android/app/build.gradle.kts", "core/artifact.lock.json", "ios/project.yml"]);
    const lock = JSON.parse(readFileSync(join(root, "core/artifact.lock.json"), "utf8"));
    expect(lock.version).toBe("0.2.0");
    expect(lock.artifacts.ios.sha256).toBe(hex("b"));
    expect(readFileSync(join(root, "android/app/build.gradle.kts"), "utf8")).toContain('"1.2.4"');
    expect(readFileSync(join(root, "ios/project.yml"), "utf8")).toContain('"1.2.4"');
    // Unpushed: the branch waits for the apps' changes.
    expect(git(origin, ["for-each-ref", "refs/heads"])).not.toContain(done.branch);
  });

  it("takes the app version it is given", async () => {
    const { root } = fixture();
    const done = await release({
      version: "0.2.0",
      app: "2.0.0",
      root,
      github: published,
      log: quiet,
    });
    expect(done.app).toBe("2.0.0");
    expect(readFileSync(join(root, "ios/project.yml"), "utf8")).toContain('"2.0.0"');
  });

  it("refuses a version main does not hold, before any tag", async () => {
    const { root, origin } = fixture("0.1.9");
    await expect(
      release({ version: "0.2.0", root, github: published, log: quiet }),
    ).rejects.toThrow("says 0.1.9, not 0.2.0");
    expect(tags(origin)).toBe("");
  });

  it("refuses a dirty tree, before any tag", async () => {
    const { root, origin } = fixture();
    writeFileSync(join(root, "stray.txt"), "x");
    await expect(
      release({ version: "0.2.0", root, github: published, log: quiet }),
    ).rejects.toThrow("not clean");
    expect(tags(origin)).toBe("");
  });

  it("refuses a tag on a commit main does not hold", async () => {
    const { root, origin } = fixture();
    git(root, ["switch", "-q", "-c", "side"]);
    git(root, ["commit", "-q", "--allow-empty", "-m", "side"]);
    git(root, ["push", "-q", "origin", "HEAD:refs/tags/core-v0.2.0"]);
    git(root, ["switch", "-q", "main"]);
    const before = tags(origin);
    await expect(
      release({ version: "0.2.0", root, github: published, log: quiet }),
    ).rejects.toThrow("not on main");
    expect(tags(origin)).toBe(before);
  });

  it("refuses a tag whose commit holds another version", async () => {
    const { root } = fixture("0.1.9");
    git(root, ["push", "-q", "origin", "HEAD:refs/tags/core-v0.2.0"]);
    setCore(root, "0.2.0");
    git(root, ["add", "core/Cargo.toml"]);
    git(root, ["commit", "-q", "-m", "bump"]);
    git(root, ["push", "-q", "origin", "main"]);
    await expect(
      release({ version: "0.2.0", root, github: published, log: quiet }),
    ).rejects.toThrow("says 0.1.9");
  });

  it("keeps a tag where it is when main has moved on, and reads an annotated tag", async () => {
    const { root, origin } = fixture();
    const sha = git(root, ["rev-parse", "HEAD"]).trim();
    git(root, ["tag", "-a", "core-v0.2.0", "-m", "core"]);
    git(root, ["push", "-q", "origin", "core-v0.2.0"]);
    git(root, ["commit", "-q", "--allow-empty", "-m", "later"]);
    git(root, ["push", "-q", "origin", "main"]);
    const before = tags(origin);

    const done = await release({ version: "0.2.0", root, github: published, log: quiet });

    expect(done.sha).toBe(sha);
    expect(tags(origin)).toBe(before);
  });

  it("finishes after a failed run with no second tag, and a third run changes nothing", async () => {
    const { root, origin } = fixture();
    const failed = {
      release: () => null,
      runs: () => [{ status: "completed", conclusion: "failure", html_url: "https://run" }],
    };

    await expect(release({ version: "0.2.0", root, github: failed, log: quiet })).rejects.toThrow(
      "ended failure with no release: https://run",
    );
    const tagged = tags(origin);
    expect(tagged).toContain("core-v0.2.0");
    expect(git(root, ["rev-parse", "--abbrev-ref", "HEAD"]).trim()).toBe("main");

    await release({ version: "0.2.0", root, github: published, log: quiet });
    const head = git(root, ["rev-parse", "HEAD"]).trim();
    expect(tags(origin)).toBe(tagged);

    /** @type {string[]} */
    const lines = [];
    await release({ version: "0.2.0", root, github: published, log: (line) => lines.push(line) });
    expect(git(root, ["rev-parse", "HEAD"]).trim()).toBe(head);
    expect(tags(origin)).toBe(tagged);
    expect(lines.join("\n")).toContain("already holds");
  });

  it("waits for the run in progress, then goes on", async () => {
    const { root } = fixture();
    let polls = 0;
    const github = {
      release: () => (++polls < 3 ? null : { assets: ASSETS }),
      runs: () => [{ status: "in_progress", conclusion: null, html_url: "https://run" }],
    };
    /** @type {string[]} */
    const lines = [];
    await release({ version: "0.2.0", root, github, pollMs: 1, log: (line) => lines.push(line) });
    expect(polls).toBe(3);
    expect(lines.filter((line) => line.includes("in_progress"))).toHaveLength(1);
  });

  it("stops at its deadline when no release comes, and says how to go on", async () => {
    const { root } = fixture();
    const github = { release: () => null, runs: () => [] };
    await expect(
      release({ version: "0.2.0", root, github, pollMs: 1, timeoutMs: 0, log: quiet }),
    ).rejects.toThrow("run this command again");
  });
});
