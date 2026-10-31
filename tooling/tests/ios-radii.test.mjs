// @ts-check
// Every corner radius in the iOS source comes from `BrandTokens.Radius`. A number typed at a call site
// is a second place where the scale is defined (decision 0122). A test of the Swift source text only.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT } from "../lib/repo.mjs";

/** A radius written as a number: `cornerRadius: 12`, `topLeadingRadius: 8`, `let radius: CGFloat = 18`. */
const LITERAL = [
  /\b\w*[cC]ornerRadius:\s*\d/,
  /\b\w*Radius:\s*\d/,
  /\b(?:let|var)\s+\w*[rR]adius\b[^=\n]*=\s*\d/,
];

/**
 * Literals with no token, each with its reason. The key is the file and the trimmed line.
 * @type {{ file: string; line: string; reason: string }[]}
 */
const EXCEPTIONS = [
  {
    file: "ios/App/Conversation/Bubble.swift",
    line: "private static let tail: CGFloat = 5",
    reason: "The bubble's tail corner is smaller than any role; it has no token.",
  },
  {
    file: "ios/App/Conversation/SharedPost.swift",
    line: ".clipShape(RoundedRectangle(cornerRadius: 4))",
    reason: "A 14 pt avatar in a shared post header; no token has this value.",
  },
];

/** @param {string} dir @returns {string[]} */
function swiftFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return swiftFiles(path);
    return e.name.endsWith(".swift") ? [path] : [];
  });
}

/**
 * @param {string} text
 * @param {string} file repo-relative path
 * @returns {string[]} `file:line: text` for each literal radius not on the exception list
 */
export function literalRadii(text, file) {
  return text.split("\n").flatMap((raw, i) => {
    const line = raw.trim();
    if (line.startsWith("//")) return [];
    if (!LITERAL.some((re) => re.test(line))) return [];
    if (EXCEPTIONS.some((e) => e.file === file && e.line === line)) return [];
    return [`${file}:${i + 1}: ${line}`];
  });
}

describe("iOS radii", () => {
  it("reads every radius from BrandTokens.Radius", () => {
    const root = join(ROOT, "ios/App");
    const found = swiftFiles(root).flatMap((path) =>
      literalRadii(readFileSync(path, "utf8"), relative(ROOT, path)),
    );
    expect(found).toEqual([]);
  });

  it("fails on a planted literal, in the forms the app uses", () => {
    const planted = [
      ".background(.red, in: RoundedRectangle(cornerRadius: 12))",
      "UnevenRoundedRectangle(topLeadingRadius: 8)",
      "private static let radius: CGFloat = 18",
    ].join("\n");
    expect(literalRadii(planted, "ios/App/X.swift")).toHaveLength(3);
  });

  it("allows tokens, computed radii and comments", () => {
    const text = [
      ".background(.red, in: RoundedRectangle(cornerRadius: BrandTokens.Radius.card))",
      "RoundedRectangle(cornerRadius: size * 0.28)",
      "// cornerRadius: 12 in prose",
    ].join("\n");
    expect(literalRadii(text, "ios/App/X.swift")).toEqual([]);
  });

  it("keeps each exception alive", () => {
    for (const e of EXCEPTIONS) {
      expect(readFileSync(join(ROOT, e.file), "utf8")).toContain(e.line);
    }
  });
});
