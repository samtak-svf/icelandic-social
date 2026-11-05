// @ts-check
import { spawnSync } from "node:child_process";
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT } from "../lib/repo.mjs";
import { detektFiles, kotlinFiles, touchesSwift } from "../native-lint.mjs";
import { tempDir } from "./helpers.mjs";

describe("file selection", () => {
  it("keeps hand-written Kotlin in the app and the core", () => {
    const files = [
      "android/app/src/main/kotlin/A.kt",
      "android/core/crypto/src/test/kotlin/B.kt",
      "android/app/build/generated/C.kt",
      "android/app/src/main/generated/D.kt",
      "android/build.gradle.kts",
      "android/build-logic/E.kt",
      "backend/src/F.ts",
    ];
    expect(kotlinFiles(files)).toEqual([
      "android/app/src/main/kotlin/A.kt",
      "android/core/crypto/src/test/kotlin/B.kt",
    ]);
  });

  it("gives detekt src/main and src/test only", () => {
    expect(
      detektFiles([
        "android/app/src/main/A.kt",
        "android/app/src/androidTest/B.kt",
        "android/app/src/test/C.kt",
      ]),
    ).toEqual(["android/app/src/main/A.kt", "android/app/src/test/C.kt"]);
  });

  it("asks for the Swift check on a Swift or format-config change in ios/", () => {
    expect(touchesSwift(["ios/App/X.swift"])).toBe(true);
    expect(touchesSwift(["ios/.swift-format"])).toBe(true);
    expect(touchesSwift(["ios/README.md", "App/X.swift"])).toBe(false);
  });
});

/**
 * Runs the guard on `files` with a PATH holding only the named stub tools.
 * @param {string[]} files
 * @param {Record<string, number>} tools tool name to the exit code its stub returns
 */
function guard(files, tools) {
  const bin = tempDir("native-lint-bin-");
  for (const [name, code] of Object.entries(tools)) {
    const path = join(bin, name);
    writeFileSync(path, `#!/bin/sh\necho "stub ${name} $*"\nexit ${code}\n`);
    chmodSync(path, 0o755);
  }
  const run = spawnSync(process.execPath, ["tooling/native-lint.mjs", "--files", ...files], {
    cwd: ROOT,
    encoding: "utf8",
    env: { PATH: bin },
  });
  return { status: run.status, out: run.stdout + run.stderr };
}

const KT = "android/app/src/main/kotlin/A.kt";

describe("native-lint", () => {
  it("runs both Kotlin tools on a changed file and counts the files", () => {
    const run = guard([KT], { ktlint: 0, detekt: 0 });
    expect(run.status).toBe(0);
    expect(run.out).toContain("ktlint over 1 Kotlin file(s)");
    expect(run.out).toContain("stub ktlint " + KT);
    expect(run.out).toContain("detekt over 1 Kotlin file(s)");
    expect(run.out).toContain("-c android/config/detekt.yml");
  });

  it("fails when ktlint reports a style error", () => {
    expect(guard([KT], { ktlint: 1, detekt: 0 }).status).toBe(1);
  });

  it("fails when detekt reports an issue, even after ktlint passed", () => {
    expect(guard([KT], { ktlint: 0, detekt: 1 }).status).toBe(1);
  });

  it("names the workflow and passes when the tools are absent", () => {
    const run = guard([KT, "ios/App/X.swift"], {});
    expect(run.status).toBe(0);
    expect(run.out).toContain("ktlint not installed; the android workflow checks them");
    expect(run.out).toContain("detekt not installed; the android workflow checks them");
    expect(run.out).toContain("swift-format not installed; the ios workflow checks it");
  });

  it("does not run detekt on an androidTest-only change", () => {
    const run = guard(["android/app/src/androidTest/kotlin/T.kt"], { ktlint: 0, detekt: 1 });
    expect(run.status).toBe(0);
    expect(run.out).toContain("detekt has no src/main or src/test file");
  });

  it("says so when nothing native changed", () => {
    const run = guard(["backend/src/a.ts"], { ktlint: 1 });
    expect(run.status).toBe(0);
    expect(run.out).toContain("nothing to check");
  });
});
