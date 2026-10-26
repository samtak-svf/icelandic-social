// @ts-check
import { describe, expect, it } from "vitest";
import { check, countLines, isCounted, lineCap, measure } from "../line-count.mjs";

describe("line-count", () => {
  it("reuses the TypeScript cap", () => {
    expect(lineCap()).toBe(400);
  });

  it("counts lines like wc -l, with or without a final newline", () => {
    expect(countLines("")).toBe(0);
    expect(countLines("a\nb\n")).toBe(2);
    expect(countLines("a\nb")).toBe(2);
  });

  it("counts Kotlin, Swift and Rust outside generated directories", () => {
    expect(isCounted("a/b.kt")).toBe(true);
    expect(isCounted("a/b.swift")).toBe(true);
    expect(isCounted("a/b.rs")).toBe(true);
    expect(isCounted("a/b.ts")).toBe(false);
    expect(isCounted("ios/Generated/b.swift")).toBe(false);
    expect(isCounted("android/core/brand/generated/b.kt")).toBe(false);
  });

  it("passes files within the cap and listed files at their count", () => {
    expect(check({ "a.rs": 400, "b.rs": 500 }, { "b.rs": 500 }, 400)).toEqual([]);
  });

  it("fails an unlisted file over the cap", () => {
    expect(check({ "a.rs": 401 }, {}, 400)).toEqual([expect.stringContaining("a.rs: 401 lines")]);
  });

  it("fails a listed file that grew", () => {
    expect(check({ "a.rs": 501 }, { "a.rs": 500 }, 400)).toEqual([
      expect.stringContaining("it may only shrink"),
    ]);
  });

  it("fails a listed maximum above the real count", () => {
    expect(check({ "a.rs": 450 }, { "a.rs": 500 }, 400)).toEqual([
      expect.stringContaining("lower the entry to 450"),
    ]);
  });

  it("fails a listed file now within the cap", () => {
    expect(check({ "a.rs": 400 }, { "a.rs": 500 }, 400)).toEqual([
      expect.stringContaining("remove it from"),
    ]);
  });

  it("fails a listed file that is gone", () => {
    expect(check({}, { "gone.rs": 500 }, 400)).toEqual([expect.stringContaining("gone.rs")]);
  });

  it("measures something in this repository", () => {
    expect(Object.keys(measure()).length).toBeGreaterThan(50);
  });
});
