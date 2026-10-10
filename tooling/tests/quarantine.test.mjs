// @ts-check
import { describe, expect, it } from "vitest";
import { checkQuarantine, findAllSkips, findSkips } from "../quarantine.mjs";
import { readJson } from "../lib/repo.mjs";

// Built at runtime so this file holds no skip marker of its own.
const SKIP = ["it", "skip"].join(".");
const IGNORE = ["#[", "ignore", "]"].join("");

const flaky = { file: "a.test.ts", name: "reconnects", issue: "#7", until: "2026-10-20" };

describe("quarantine", () => {
  it("passes on the repo as it is", () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(
      checkQuarantine(readJson("tooling/quarantine.json").tests, findAllSkips(), today),
    ).toEqual([]);
  });

  it("finds a skip in each language, with the test's name", () => {
    const found = [
      ...findSkips("a.test.ts", `${SKIP}("reconnects", async () => {});`),
      ...findSkips("b.test.mjs", `describe.${"todo"}('later')`),
      ...findSkips("c.rs", `#[test]\n${IGNORE}\nfn writes_it() {}`),
      ...findSkips("D.kt", `@${"Ignore"}\n@Test\nfun \`signs in\`() {}`),
      ...findSkips("E.swift", `func testUpload() throws {\n  throw ${"XCTSkip"}("sim")\n}`),
    ].map((s) => s.name);
    expect(found).toEqual(["reconnects", "later", "writes_it", "signs in", "testUpload"]);
  });

  it("fails on a skip with no entry, and on an entry with no skip", () => {
    const skip = { file: "a.test.ts", name: "reconnects", line: 3 };
    expect(checkQuarantine([], [skip], "2026-10-10").join()).toContain("without a");
    expect(checkQuarantine([flaky], [], "2026-10-10").join()).toContain("no skip marker left");
    expect(checkQuarantine([flaky], [skip], "2026-10-10")).toEqual([]);
  });

  it("ends a quarantine on its date, and refuses one longer than 14 days", () => {
    const skip = { file: "a.test.ts", name: "reconnects", line: 3 };
    expect(checkQuarantine([flaky], [skip], "2026-10-20")).toEqual([]);
    expect(checkQuarantine([flaky], [skip], "2026-10-21").join()).toContain("ended 2026-10-20");
    expect(checkQuarantine([flaky], [skip], "2026-10-05").join()).toContain("more than 14 days");
    const open = { file: flaky.file, name: flaky.name };
    expect(checkQuarantine([open], [skip], "2026-10-10").join()).toMatch(/issue.*until/s);
  });

  it("keeps a permanent entry to a reason alone", () => {
    const skip = { file: "c.rs", name: "writes_it", line: 2 };
    const fixture = { file: "c.rs", name: "writes_it", reason: "writes the fixture by hand" };
    expect(checkQuarantine([fixture], [skip], "2026-10-10")).toEqual([]);
    expect(
      checkQuarantine([{ ...fixture, until: "2026-10-11" }], [skip], "2026-10-10").join(),
    ).toContain("neither issue nor until");
  });
});
