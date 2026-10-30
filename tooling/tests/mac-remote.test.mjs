// @ts-check
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { copyChanged, parseArgs, sharedArgs, sharedScript } from "../mac-remote.mjs";
import { tempDir } from "./helpers.mjs";

describe("parseArgs", () => {
  it("defaults to the iOS tests", () => {
    expect(parseArgs([]).command).toBe("ios/scripts/test.sh --prepare");
    expect(parseArgs([]).dir).toBeUndefined();
  });

  it("names the Android checks and emulator tests as a task", () => {
    expect(parseArgs(["android"]).command).toBe(
      "android/scripts/test.sh && android/scripts/test.sh --connected",
    );
  });

  it("names the web e2e as a task", () => {
    expect(parseArgs(["web"]).command).toBe("CI=1 web/scripts/e2e.sh --prepare");
  });

  it("takes a host, a directory and a command after --", () => {
    expect(parseArgs(["--host", "mac2", "--dir", "w", "--", "swift", "--version"])).toEqual({
      host: "mac2",
      dir: "w",
      command: "swift --version",
    });
  });

  it("refuses an unknown task, a flag with no value and an empty command", () => {
    expect(() => parseArgs(["windows"])).toThrow(/unknown argument windows/);
    expect(() => parseArgs(["--host"])).toThrow(/--host needs a value/);
    expect(() => parseArgs(["--"])).toThrow(/-- needs a command/);
  });
});

describe("record", () => {
  it("records on the Mac and pulls the images into the given directory", () => {
    const options = parseArgs(["record"]);
    expect(options.command).toBe("android/scripts/test.sh --record");
    expect(sharedArgs(options, "/src/repo", "/tmp/in")).toEqual([
      "--repo",
      "/src/repo",
      "--host",
      "samtak-mac",
      "--pull",
      "android/app/src/test/screenshots:/tmp/in",
      "--",
      options.command,
    ]);
  });

  it("copies what differs, adds what is new and leaves what the run did not produce", () => {
    const from = join(tempDir("mac-remote-from-"), "s");
    const to = join(tempDir("mac-remote-to-"), "s");
    mkdirSync(from);
    mkdirSync(to);
    writeFileSync(join(from, "same.png"), "a");
    writeFileSync(join(to, "same.png"), "a");
    writeFileSync(join(from, "moved.png"), "new");
    writeFileSync(join(to, "moved.png"), "old");
    writeFileSync(join(from, "added.png"), "x");
    writeFileSync(join(to, "kept.png"), "k");

    expect(copyChanged(from, to)).toEqual(["added.png", "moved.png"]);
    expect(readFileSync(join(to, "moved.png"), "utf8")).toBe("new");
    expect(readFileSync(join(to, "added.png"), "utf8")).toBe("x");
    expect(readFileSync(join(to, "kept.png"), "utf8")).toBe("k");
    expect(copyChanged(from, to)).toEqual([]);
  });
});

describe("sharedArgs", () => {
  it("forwards no --dir when none was given, so the shared script picks the per-worktree default", () => {
    const args = sharedArgs(parseArgs(["android"]), "/src/repo");
    expect(args).not.toContain("--dir");
    expect(args).toEqual([
      "--repo",
      "/src/repo",
      "--host",
      "samtak-mac",
      "--",
      "android/scripts/test.sh && android/scripts/test.sh --connected",
    ]);
  });

  it("forwards --dir x when the user gave one", () => {
    const args = sharedArgs(parseArgs(["--dir", "x"]), "/src/repo");
    expect(args.slice(args.indexOf("--dir"), args.indexOf("--dir") + 2)).toEqual(["--dir", "x"]);
  });

  it("hands the shared script this checkout, the host, the directory and the command", () => {
    expect(sharedArgs({ host: "mac2", dir: "w", command: "true" }, "/src/repo")).toEqual([
      "--repo",
      "/src/repo",
      "--host",
      "mac2",
      "--dir",
      "w",
      "--",
      "true",
    ]);
  });
});

describe("sharedScript", () => {
  it("takes MAC_REMOTE_SCRIPT, else the agent-config checkout", () => {
    expect(sharedScript({ MAC_REMOTE_SCRIPT: "/x/mac-remote.mjs" })).toBe("/x/mac-remote.mjs");
    expect(sharedScript({})).toMatch(/agent-config\/scripts\/mac-remote\.mjs$/);
  });
});
