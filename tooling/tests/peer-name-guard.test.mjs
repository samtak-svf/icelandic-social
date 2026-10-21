// @ts-check
// The guard is tested against invented names, so this file names no real
// messenger: the real list is only hashes, and a literal sample here would be
// exactly what the guard (rightly) reports.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hash, namesInFiles, namesInText } from "../peer-name-guard.mjs";
import { readJson } from "../lib/repo.mjs";
import { tempDir } from "./helpers.mjs";

/** @type {import("../peer-name-guard.mjs").NameList} */
const NAMES = {
  anywhere: [hash("zorbchat")],
  proper: [hash("beacon")],
  hosts: [hash("zorbchat"), hash("beacon")],
};

describe("peer-name-guard", () => {
  it("finds an anywhere-name in any case, inside an identifier, redacted", () => {
    const found = namesInText("use Zorbchat\nclass ZorbchatClient\nZORBCHAT", false, NAMES);
    expect(found.map((f) => f.line)).toEqual([1, 2, 3]);
    expect(found[0]?.word).toBe("Zo••••••");
  });

  it("finds a capitalised proper name in prose", () => {
    expect(namesInText("Beacon and others do this.", true, NAMES)).toHaveLength(1);
  });

  it("leaves a proper name alone in code, lowercase, or in backticks", () => {
    expect(namesInText("sealed interface Beacon", false, NAMES)).toEqual([]);
    expect(namesInText("a beacon in the dark", true, NAMES)).toEqual([]);
    expect(namesInText("the `Beacon` type", true, NAMES)).toEqual([]);
  });

  it("finds a name in a URL host, in prose and code alike", () => {
    expect(namesInText("see https://support.beacon.org/x", false, NAMES)).toHaveLength(1);
    expect(namesInText("(https://beacon.org/blog)", true, NAMES)).toHaveLength(1);
  });

  it("reads .md files as prose and skips its own list", () => {
    const dir = tempDir("spjall-peer-");
    writeFileSync(join(dir, "a.md"), "Beacon does it.\n");
    writeFileSync(join(dir, "a.kt"), "val s: Beacon\n");
    const hits = namesInFiles(["a.md", "a.kt"], NAMES, dir);
    expect(hits).toEqual([{ where: "a.md", line: 1, word: "Be••••" }]);
  });

  it("keeps the real list as SHA-256 hashes only", () => {
    /** @type {Record<string, unknown>} */
    const list = readJson("tooling/peer-names.json");
    for (const key of ["anywhere", "proper", "hosts"]) {
      const values = /** @type {string[]} */ (list[key]);
      expect(values.length).toBeGreaterThan(0);
      for (const v of values) expect(v).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});
