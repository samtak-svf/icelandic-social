// @ts-check
// The Android app reads every corner radius from the generated tokens
// (`BrandTokens.Radius`). A numeric radius constant or a literal
// `RoundedCornerShape(<n>.dp)` in the app source is a second place where the
// scale is defined, so it fails here unless it is a named exception.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT } from "../lib/repo.mjs";

const SOURCE = join(ROOT, "android/app/src/main/kotlin");

/** Radii that have no token, each with the reason. Keyed by `<path under SOURCE>: <hit>`. */
const EXCEPTIONS = new Map([
  [
    "samtak/spjall/conversation/Bubble.kt: const val TAIL_RADIUS = 5",
    "the message tail's corner is not a role in the design scale, so no token exists",
  ],
]);

const RADIUS_CONST = /const\s+val\s+\w*RADIUS\w*\s*(?::\s*Int\s*)?=\s*\d+/g;
const LITERAL_SHAPE = /RoundedCornerShape\(\s*\d+(?:\.\d+)?\s*\.dp\s*\)/g;

/** @param {string} text @returns {string[]} */
export function literalRadii(text) {
  return [...(text.match(RADIUS_CONST) ?? []), ...(text.match(LITERAL_SHAPE) ?? [])].map((hit) =>
    hit.replace(/\s+/g, " "),
  );
}

/** @param {string} dir @returns {string[]} */
function kotlinFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return kotlinFiles(path);
    return e.name.endsWith(".kt") ? [path] : [];
  });
}

describe("android radii", () => {
  it("reads every radius from BrandTokens.Radius, apart from named exceptions", () => {
    const found = kotlinFiles(SOURCE).flatMap((path) =>
      literalRadii(readFileSync(path, "utf8")).map((hit) => `${relative(SOURCE, path)}: ${hit}`),
    );
    expect(found.filter((hit) => !EXCEPTIONS.has(hit))).toEqual([]);
  });

  it("keeps no exception that no longer matches a line", () => {
    const found = new Set(
      kotlinFiles(SOURCE).flatMap((path) =>
        literalRadii(readFileSync(path, "utf8")).map((hit) => `${relative(SOURCE, path)}: ${hit}`),
      ),
    );
    expect([...EXCEPTIONS.keys()].filter((key) => !found.has(key))).toEqual([]);
  });

  it("fails on a planted constant or literal shape", () => {
    const planted = [
      "private const val CARD_RADIUS = 14",
      "internal const val PILL_RADIUS: Int = 26",
      "x.background(c, RoundedCornerShape(12.dp))",
      "  .RoundedCornerShape( 8.5.dp )",
    ].join("\n");
    expect(literalRadii(planted)).toHaveLength(4);
  });

  it("allows a token and a non-radius constant", () => {
    const text = "RoundedCornerShape(Radius.CARD_DP.dp)\nprivate const val PILL = 52";
    expect(literalRadii(text)).toEqual([]);
  });
});
