// @ts-check
// Leak samples are BUILT from the brand's own stems at runtime, as in
// brand-leak-guard.test.mjs: a literal sample here would be a real leak.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { leaksInFiles, loadBrands } from "../brand-leak-guard.mjs";
import { FIXTURE, FIXTURE_NAME, prepare, renameIn, scan, writeFixture } from "../rename-drill.mjs";
import { activeBrand, isOwned } from "../lib/brand-gen/paths.mjs";
import { copyRepo } from "./helpers.mjs";

const brand = loadBrands().find((b) => b.name === activeBrand());
if (!brand) throw new Error("no active brand to drill");
const stem = brand.leakTerms.stems[0] ?? "";
const Stem = stem.charAt(0).toUpperCase() + stem.slice(1);

/** The parts of the repo brand-gen reads and writes. */
function copyBrandTree() {
  return copyRepo([
    "brand",
    "identifiers",
    "android/core/brand/src",
    "ios/Generated",
    "backend/src/brand.gen.ts",
  ]);
}

/** @param {string} root */
function filesIn(root) {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(root.length + 1));
}

describe("renameIn", () => {
  it("replaces every inflected form and keeps the case of the first letter", () => {
    expect(renameIn(`${Stem} og nýtt ${stem}ið, ${stem}a`, brand.leakTerms)).toBe(
      `${FIXTURE_NAME} og nýtt ${FIXTURE_NAME.toLowerCase()}, ${FIXTURE_NAME.toLowerCase()}`,
    );
  });

  it("leaves words that only share the stem", () => {
    for (const prefix of brand.leakTerms.allowPrefixes) {
      expect(renameIn(`${prefix}i`, brand.leakTerms)).toBe(`${prefix}i`);
    }
  });
});

describe("prepare", () => {
  it("switches a copy of the repo to the fixture with nothing left behind", () => {
    const root = copyBrandTree();
    expect(prepare({ root, files: filesIn(root) })).toEqual([]);
    const strings = readFileSync(join(root, "backend/src/brand.gen.ts"), "utf8");
    expect(strings).toContain(FIXTURE_NAME);
  });

  it("catches a generated file the switch did not rewrite", () => {
    const root = copyBrandTree();
    writeFixture(brand.name, root);
    const owned = filesIn(root).filter(isOwned);
    const leaks = leaksInFiles(owned, loadBrands(root), root, FIXTURE);
    expect(leaks.map((l) => l.brand)).toContain(brand.name);
  });
});

describe("scan", () => {
  const brands = () => {
    const root = copyBrandTree();
    writeFixture(brand.name, root);
    return { root, brands: loadBrands(root) };
  };

  it("passes an artifact that names only the fixture", () => {
    const { root, brands: all } = brands();
    writeFileSync(join(root, "app.bin"), `\0\0${FIXTURE_NAME}\0`);
    expect(scan([join(root, "app.bin")], all)).toEqual([]);
  });

  it("fails an artifact that still names the brand, in UTF-8 or UTF-16", () => {
    const { root, brands: all } = brands();
    writeFileSync(join(root, "a.bin"), `${FIXTURE_NAME} ${Stem}`);
    writeFileSync(join(root, "b.bin"), Buffer.from(`${FIXTURE_NAME} ${Stem}`, "utf16le"));
    const problems = scan([join(root, "a.bin"), join(root, "b.bin")], all);
    expect(problems).toHaveLength(2);
    expect(problems.every((p) => p.includes(`brand ${brand.name}`))).toBe(true);
  });

  it("fails an artifact that never names the fixture, unless it ships no brand", () => {
    const { root, brands: all } = brands();
    writeFileSync(join(root, "worker.js"), "export default {};\n");
    expect(scan([join(root, "worker.js")], all)).toEqual([
      `${join(root, "worker.js")}: never names ${FIXTURE_NAME}, so it was not built from it`,
    ]);
    expect(scan([], all, [join(root, "worker.js")])).toEqual([]);
  });
});
