// @ts-check
// Leak samples are BUILT from the brand's own stems at runtime: a literal
// sample in this file would be a leak the guard (rightly) reports.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isLeakWord, leaksInFiles, leaksInIds, loadBrands, words } from "../brand-leak-guard.mjs";
import { readJson } from "../lib/repo.mjs";
import { copyRepo } from "./helpers.mjs";

const brands = loadBrands();
const brand = brands[0];
if (!brand) throw new Error("no brand to test against");
const stem = brand.leakTerms.stems[0] ?? "";
const Stem = stem.charAt(0).toUpperCase() + stem.slice(1);

describe("words", () => {
  it("splits camelCase, PascalCase and acronyms", () => {
    expect(words("fooBarBaz HTTPServer snake_case")).toEqual([
      "foo",
      "bar",
      "baz",
      "http",
      "server",
      "snake",
      "case",
    ]);
  });
});

describe("brand-leak-guard", () => {
  it("passes the repo as committed", () => {
    expect(leaksInIds(readJson("identifiers/ids.json"), brands)).toEqual([]);
  });

  it("catches inflected and verb forms of the name", () => {
    for (const ending of ["", "a", "i", "ið", "sins"]) {
      expect(isLeakWord(`${stem}${ending}`, brand.leakTerms)).toBe(true);
    }
  });

  it("lets through words that only share the stem", () => {
    for (const prefix of brand.leakTerms.allowPrefixes) {
      expect(isLeakWord(`${prefix}i`, brand.leakTerms)).toBe(false);
    }
  });

  it("catches the name in a Kotlin class and a Swift string", () => {
    const root = copyRepo(["brand"]);
    mkdirSync(join(root, "android"), { recursive: true });
    mkdirSync(join(root, "ios"), { recursive: true });
    writeFileSync(join(root, "android/Theme.kt"), `object ${Stem}Theme\n`);
    writeFileSync(join(root, "ios/Copy.swift"), `let title = "Nýtt ${stem}"\n`);
    const leaks = leaksInFiles(["android/Theme.kt", "ios/Copy.swift"], brands, root);
    expect(leaks.map((l) => `${l.file}:${l.line}`)).toEqual([
      "android/Theme.kt:1",
      "ios/Copy.swift:1",
    ]);
  });

  it("allows the name inside its own brand directory and its allowPaths", () => {
    const root = copyRepo(["brand"]);
    mkdirSync(join(root, "docs"), { recursive: true });
    writeFileSync(join(root, "docs/naming.md"), `${Stem}\n`);
    const files = [`brand/${brand.name}/brand.json`, "docs/naming.md"];
    expect(leaksInFiles(files, brands, root)).toEqual([]);
  });

  it("catches the stem buried in a frozen id", () => {
    const ids = { cloudflare: { worker: `${stem}api` } };
    expect(leaksInIds(ids, brands).join()).toContain("/cloudflare/worker");
  });
});
