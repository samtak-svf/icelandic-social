// @ts-check
import { describe, expect, it } from "vitest";
import { check, servedHashes, sri } from "../sri-check.mjs";

const bytes = (/** @type {string} */ s) => new TextEncoder().encode(s);
const FILES = new Map([
  ["/assets/main-a.js", bytes("console.log(1)")],
  ["/assets/app-b.css", bytes("body{}")],
]);
/** @param {Record<string, string>} map */
const bundle = (map) => `var integrity_default = ${JSON.stringify(map, null, 2)};`;
const served = (/** @type {Record<string, string>} */ map) => servedHashes(bundle(map));
const exact = Object.fromEntries([...FILES].map(([p, b]) => [p, sri(b)]));

describe("sri-check", () => {
  it("reads the map from the server bundle", () => {
    expect(Object.fromEntries(served(exact))).toEqual(exact);
  });

  it("passes when every file is served with its own hash", () => {
    expect(check(served(exact), FILES)).toEqual([]);
  });

  it("fails on a file served with no integrity", () => {
    const { "/assets/app-b.css": _, ...rest } = exact;
    expect(check(served(rest), FILES)).toEqual(["/assets/app-b.css is served with no integrity"]);
  });

  it("fails on a stale hash", () => {
    const stale = { ...exact, "/assets/main-a.js": sri(bytes("console.log(2)")) };
    expect(check(served(stale), FILES)).toEqual([
      "/assets/main-a.js: the served integrity is not the file's",
    ]);
  });

  it("fails on a hash for a file the build does not have", () => {
    const extra = { ...exact, "/assets/gone.js": sri(bytes("")) };
    expect(check(served(extra), FILES)).toEqual([
      "/assets/gone.js has an integrity but is not in the build",
    ]);
  });
});
