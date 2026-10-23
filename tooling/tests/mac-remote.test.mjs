// @ts-check
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseArgs, remoteScript, snapshot } from "../mac-remote.mjs";
import { git, initRepo, tempDir } from "./helpers.mjs";

/** A committed repo with an ignore file like ours, then edits on top. */
function fixture() {
  const root = tempDir("spjall-mac-remote-");
  writeFileSync(join(root, ".gitignore"), "private/\n.dev.vars\n");
  writeFileSync(join(root, "kept.txt"), "base\n");
  writeFileSync(join(root, "gone.txt"), "base\n");
  initRepo(root);
  return root;
}

/**
 * @param {string} root
 * @param {string} commit
 */
function files(root, commit) {
  return git(root, ["ls-tree", "-r", "--name-only", commit]).trim().split("\n").sort();
}

describe("snapshot", () => {
  it("carries edits, new files and deletions, and nothing ignored", () => {
    const root = fixture();
    writeFileSync(join(root, "kept.txt"), "edited\n");
    writeFileSync(join(root, "new.txt"), "new\n");
    git(root, ["rm", "-q", "gone.txt"]);
    mkdirSync(join(root, "private"));
    writeFileSync(join(root, "private/notes.md"), "secret\n");
    writeFileSync(join(root, ".dev.vars"), "TOKEN=x\n");

    const commit = snapshot(root);

    expect(files(root, commit)).toEqual([".gitignore", "kept.txt", "new.txt"]);
    expect(git(root, ["show", `${commit}:kept.txt`])).toBe("edited\n");
    expect(git(root, ["rev-parse", `${commit}^`]).trim()).toBe(
      git(root, ["rev-parse", "HEAD"]).trim(),
    );
  });

  it("leaves the caller's index and HEAD as they were", () => {
    const root = fixture();
    writeFileSync(join(root, "new.txt"), "new\n");
    const head = git(root, ["rev-parse", "HEAD"]);

    snapshot(root);

    expect(git(root, ["status", "--porcelain"])).toBe("?? new.txt\n");
    expect(git(root, ["rev-parse", "HEAD"])).toBe(head);
  });
});

describe("remoteScript", () => {
  it("checks the commit out exactly before the command", () => {
    expect(remoteScript("spjall", "abc123", "ios/scripts/test.sh --prepare")).toBe(
      "cd 'spjall' && git checkout -qf --detach abc123 && git clean -qfd && ios/scripts/test.sh --prepare",
    );
  });

  it("quotes a directory with a quote in it", () => {
    expect(remoteScript("it's", "abc123", "true")).toMatch(/^cd 'it'\\''s' && /);
  });
});

describe("parseArgs", () => {
  it("defaults to the iOS tests", () => {
    expect(parseArgs([]).command).toBe("ios/scripts/test.sh --prepare");
    expect(parseArgs([]).dir).toBe("spjall");
  });

  it("takes a host, a directory and a command after --", () => {
    expect(parseArgs(["--host", "mac2", "--dir", "w", "--", "swift", "--version"])).toEqual({
      host: "mac2",
      dir: "w",
      command: "swift --version",
    });
  });

  it("refuses an unknown task, a flag with no value and an empty command", () => {
    expect(() => parseArgs(["android"])).toThrow(/unknown argument android/);
    expect(() => parseArgs(["--host"])).toThrow(/--host needs a value/);
    expect(() => parseArgs(["--"])).toThrow(/-- needs a command/);
  });
});
