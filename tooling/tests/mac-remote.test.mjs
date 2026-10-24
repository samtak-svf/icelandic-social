// @ts-check
import { describe, expect, it } from "vitest";
import { parseArgs, sharedArgs, sharedScript } from "../mac-remote.mjs";

describe("parseArgs", () => {
  it("defaults to the iOS tests", () => {
    expect(parseArgs([]).command).toBe("ios/scripts/test.sh --prepare");
    expect(parseArgs([]).dir).toBe("spjall");
  });

  it("names the Android checks and emulator tests as a task", () => {
    expect(parseArgs(["android"]).command).toBe("android/scripts/test.sh --connected");
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

describe("sharedArgs", () => {
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
