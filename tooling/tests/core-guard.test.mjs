// @ts-check
import { describe, expect, it } from "vitest";
import { cargoCalls, findProblems, lockProblems } from "../core-guard.mjs";

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

  it("accepts the unpublished and the published shape", () => {
    expect(lockProblems(unpublished())).toEqual([]);
    expect(lockProblems(published())).toEqual([]);
  });

  it("rejects pins without a version", () => {
    const lock = { ...unpublished(), artifacts: published().artifacts };
    expect(lockProblems(lock)).toEqual(["artifacts are pinned but version is null"]);
  });

  it("rejects a bad version, checksum, file name or base URL", () => {
    const lock = published();
    lock.version = "v0.1";
    lock.artifacts.android.sha256 = "A".repeat(64);
    lock.artifacts.ios.sha256 = "a".repeat(63);
    lock.artifacts.ios.file = "core.zip";
    lock.baseUrl = "http://artifacts.example.org/";
    expect(lockProblems(lock)).toEqual([
      'version must be null or X.Y.Z, not "v0.1"',
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

  it("rejects unknown keys", () => {
    expect(lockProblems({ ...unpublished(), latest: true })).toEqual([
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
