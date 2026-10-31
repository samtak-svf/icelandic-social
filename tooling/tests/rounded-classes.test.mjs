// @ts-check
// Every `rounded-*` class in the web source must name a radius token, because
// the theme clears Tailwind's own scale and a class with no token generates no
// CSS: the element renders square, silently.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { unknownRoundedClasses } from "../lib/rounded-classes.mjs";
import { brandNames, readJson, ROOT } from "../lib/repo.mjs";

const BRAND = brandNames()[0] ?? "";
const TOKENS = Object.keys(readJson(`brand/${BRAND}/tokens.json`).radius).filter(
  (k) => !k.startsWith("$"),
);

/** @param {string} dir @returns {string[]} */
function sources(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return e.name === "generated" ? [] : sources(path);
    return /\.(tsx?|css)$/.test(e.name) ? [path] : [];
  });
}

describe("rounded classes", () => {
  it("names a radius token in every file of web/src", () => {
    const found = sources(join(ROOT, "web/src")).flatMap((path) =>
      unknownRoundedClasses(readFileSync(path, "utf8"), TOKENS).map((c) => `${path}: ${c}`),
    );
    expect(found).toEqual([]);
  });

  it("fails on a class with no token, directional forms included", () => {
    const text = `<a className="rounded-xl p-2 rounded-t-3xl md:rounded-b-sm rounded">`;
    expect(unknownRoundedClasses(text, TOKENS)).toEqual([
      "rounded-xl",
      "rounded-t-3xl",
      "rounded-b-sm",
      "rounded",
    ]);
  });

  it("allows tokens, none, full and arbitrary values", () => {
    const text = `x rounded-md rounded-t-card medium:rounded-none rounded-full rounded-[3px] rounded-tl-pill-lg`;
    expect(unknownRoundedClasses(text, TOKENS)).toEqual([]);
  });

  it("does not read comments that merely contain the word", () => {
    const text = "// rounded down\n/** rounded-xl in prose */\nconst a = 1; // rounded up";
    expect(unknownRoundedClasses(text, TOKENS)).toEqual([]);
  });
});
