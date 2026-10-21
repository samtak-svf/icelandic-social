// @ts-check
import { describe, expect, it } from "vitest";
import { check, staticImports } from "../preload-check.mjs";

/** @param {Record<string, string>} files */
const reader = (files) => (/** @type {string} */ href) => files[href];

// Built chunks as rolldown writes them: minified static imports, and a
// dynamic import the router resolves later.
const FILES = {
  "/assets/index-a.js":
    'import{a as e}from"./helper-b.js";import"./side-c.js";e(()=>import("./route-d.js"));',
  "/assets/helper-b.js": 'import{t as n}from"./deep-e.js";export{n as a};',
  "/assets/side-c.js": "console.log(1);",
  "/assets/route-d.js": 'import{a}from"./helper-b.js";export default a;',
  "/assets/deep-e.js": "export const t=1;",
};

/** @param {string[]} root @param {string[]} [route] */
const manifest = (root, route = ["/assets/route-d.js"]) => ({
  routes: {
    __root__: { children: ["/"], preloads: root },
    "/": { preloads: route },
  },
});

describe("preload-check", () => {
  it("reads static imports, not dynamic ones", () => {
    expect(staticImports(FILES["/assets/index-a.js"])).toEqual(["./helper-b.js", "./side-c.js"]);
  });

  it("fails a module two levels down that the page does not preload", () => {
    // Start's own list: the entry and its direct imports.
    const problems = check(
      manifest(["/assets/index-a.js", "/assets/helper-b.js", "/assets/side-c.js"]),
      reader(FILES),
    );
    expect(problems).toEqual([
      "/: /assets/deep-e.js is imported by /assets/helper-b.js but not preloaded",
    ]);
  });

  it("passes when the whole closure is preloaded, across the route chain", () => {
    const root = [
      "/assets/index-a.js",
      "/assets/helper-b.js",
      "/assets/side-c.js",
      "/assets/deep-e.js",
    ];
    expect(check(manifest(root), reader(FILES))).toEqual([]);
  });

  it("fails a preload that is not in the build", () => {
    expect(check(manifest(["/assets/gone.js"], []), reader(FILES))).toEqual([
      "/: /assets/gone.js is preloaded but not in the build",
    ]);
  });
});
