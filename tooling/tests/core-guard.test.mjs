// @ts-check
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cargoCalls, findProblems, lockProblems, webTypesProblems } from "../core-guard.mjs";

const SUM = "a".repeat(64);
const unpublished = () => ({
  version: null,
  androidNdk: "30.0.16248370",
  baseUrl: null,
  artifacts: {},
});
const published = () => ({
  version: "0.1.0",
  androidNdk: "30.0.16248370",
  baseUrl: "https://github.com/o/r/releases/download/core-v{version}",
  artifacts: {
    android: { file: "spjall-core-android.zip", sha256: SUM },
    ios: { file: "spjall-core-ios.zip", sha256: SUM },
  },
});

describe("core-guard", () => {
  it("passes on the repo as it is", () => {
    expect(findProblems()).toEqual({ lock: [], calls: [] });
  });

  it("accepts a published lock", () => {
    expect(lockProblems(published())).toEqual([]);
  });

  it("rejects an unpublished lock: the apps only fetch the core (decision 0013)", () => {
    expect(lockProblems(unpublished())).toEqual([
      "version must be X.Y.Z, not null",
      "a published version needs baseUrl, an https:// URL with {version} and no trailing slash",
      "a published version pins both android and ios; found none",
    ]);
  });

  it("rejects a bad version, checksum, file name or base URL", () => {
    const lock = published();
    lock.version = "v0.1";
    lock.artifacts.android.sha256 = "A".repeat(64);
    lock.artifacts.ios.sha256 = "a".repeat(63);
    lock.artifacts.ios.file = "core.zip";
    lock.baseUrl = "http://artifacts.example.org/";
    expect(lockProblems(lock)).toEqual([
      'version must be X.Y.Z, not "v0.1"',
      "a published version needs baseUrl, an https:// URL with {version} and no trailing slash",
      "artifacts.android.sha256 must be 64 lowercase hex characters",
      "artifacts.ios.file must be spjall-core-ios.zip",
      "artifacts.ios.sha256 must be 64 lowercase hex characters",
    ]);
  });

  it("requires {version} in a published base URL", () => {
    const lock = published();
    lock.baseUrl = "https://artifacts.example.org/core";
    expect(lockProblems(lock)).toEqual([
      "a published version needs baseUrl, an https:// URL with {version} and no trailing slash",
    ]);
  });

  it("requires both platforms once published", () => {
    const lock = published();
    delete (/** @type {any} */ (lock.artifacts).ios);
    expect(lockProblems(lock)).toEqual([
      "a published version pins both android and ios; found android",
    ]);
  });

  it("accepts a web artifact beside the two app ones, and checks its pin", () => {
    const lock = /** @type {any} */ (published());
    lock.artifacts.web = { file: "spjall-core-web.zip", sha256: SUM };
    expect(lockProblems(lock)).toEqual([]);
    lock.artifacts.web = { file: "spjall-core-web.zip", sha256: "xyz" };
    expect(lockProblems(lock)).toEqual([
      "artifacts.web.sha256 must be 64 lowercase hex characters",
    ]);
  });

  it("rejects an artifact for a platform that does not exist", () => {
    const lock = /** @type {any} */ (published());
    lock.artifacts.desktop = { file: "spjall-core-desktop.zip", sha256: SUM };
    expect(lockProblems(lock)).toEqual([
      "a published version pins both android and ios; found android,desktop,ios",
    ]);
  });

  it("rejects unknown keys", () => {
    expect(lockProblems({ ...published(), latest: true })).toEqual([
      "keys must be androidNdk, artifacts, baseUrl, version; found androidNdk,artifacts,baseUrl,latest,version",
    ]);
  });

  it("flags cargo run from Gradle", () => {
    const kts =
      'tasks.register<Exec>("core") {\n  commandLine("cargo", "xtask", "core", "android")\n}';
    expect(cargoCalls("android/core/crypto/build.gradle.kts", kts)).toEqual([
      { file: "android/core/crypto/build.gradle.kts", line: 2 },
    ]);
    expect(cargoCalls("android/build.gradle", 'exec { commandLine "cargo build" }')).toHaveLength(
      1,
    );
  });

  it("flags cargo run from an Xcode script phase", () => {
    const yml = "preBuildScripts:\n  - script: |\n      cd ../core && cargo xtask core ios";
    expect(cargoCalls("ios/project.yml", yml)).toEqual([{ file: "ios/project.yml", line: 3 }]);
  });

  it("allows a message telling a person to run cargo, and comments", () => {
    const kts = [
      "// built by cargo xtask core android",
      'error("run `cargo xtask core android` or `cargo xtask fetch android` first")',
    ].join("\n");
    expect(cargoCalls("android/core/crypto/build.gradle.kts", kts)).toEqual([]);
    expect(cargoCalls("ios/project.yml", "# filled by cargo xtask fetch ios")).toEqual([]);
  });

  it("ignores files that are not build files", () => {
    expect(cargoCalls("core/README.md", "cargo xtask core android")).toEqual([]);
  });
});

describe("web types", () => {
  /** @param {string | null} committed @param {string | null} built */
  const tree = (committed, built) => {
    const root = mkdtempSync(join(tmpdir(), "core-guard-"));
    mkdirSync(join(root, "web/src/generated"), { recursive: true });
    mkdirSync(join(root, "web/core"), { recursive: true });
    if (committed !== null) writeFileSync(join(root, "web/src/generated/core.d.ts"), committed);
    if (built !== null) writeFileSync(join(root, "web/core/spjall_wasm.d.ts"), built);
    return root;
  };

  it("passes when the committed declarations equal the built ones", () => {
    expect(webTypesProblems(tree("export {};\n", "export {};\n"))).toEqual([]);
  });

  it("fails when the committed declarations are stale", () => {
    const problems = webTypesProblems(tree("old\n", "new\n"));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/stale/);
    expect(problems[0]).toMatch(/cargo xtask core web/);
  });

  it("fails when they are missing", () => {
    expect(webTypesProblems(tree(null, null))).toEqual([
      expect.stringMatching(/web\/src\/generated\/core\.d\.ts is missing/),
    ]);
  });

  it("skips the comparison when nothing is built, unless the build is required", () => {
    const root = tree("export {};\n", null);
    expect(webTypesProblems(root)).toEqual([]);
    expect(webTypesProblems(root, { requireBuilt: true })).toEqual([
      expect.stringMatching(/web\/core\/spjall_wasm\.d\.ts is not built/),
    ]);
  });
});
