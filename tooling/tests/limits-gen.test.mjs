// @ts-check
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readJson, ROOT } from "../lib/repo.mjs";
import { kotlin, outputs, parse, rust, stale, swift, typescript } from "../limits-gen.mjs";

/** @type {import("../limits-gen.mjs").Limit} */
const LIMIT = { name: "postBodyChars", unit: "chars", value: 5000, doc: "A post's text." };

/** @type {import("../limits-gen.mjs").Limit} */
const BYTES = { name: "mediaBytes", unit: "bytes", value: 26214400, doc: "A file." };

describe("limits-gen", () => {
  it("every committed file matches api/limits.json", () => {
    const wanted = outputs(parse(readJson("api/limits.json")));
    for (const [path, text] of Object.entries(wanted)) {
      expect(readFileSync(join(ROOT, path), "utf8"), path).toBe(text);
    }
  });

  it("finds a changed file and a missing one, and only those", () => {
    const wanted = { a: "1", b: "2", c: "3" };
    const read = (/** @type {string} */ path) => ({ a: "1", b: "changed" })[path] ?? null;
    expect(stale(wanted, read)).toEqual(["b", "c"]);
    expect(stale(wanted, (path) => wanted[/** @type {"a"} */ (path)])).toEqual([]);
  });

  it("gives each language the number and the right integer", () => {
    expect(typescript([LIMIT])).toContain("postBodyChars: 5000,");
    expect(rust([LIMIT, BYTES])).toContain("pub const POST_BODY_CHARS: usize = 5_000;");
    expect(rust([LIMIT, BYTES])).toContain("pub const MEDIA_BYTES: u64 = 26_214_400;");
    expect(kotlin([LIMIT, BYTES])).toContain("const val POST_BODY_CHARS = 5_000\n");
    expect(kotlin([LIMIT, BYTES])).toContain("const val MEDIA_BYTES = 26_214_400L\n");
    expect(swift([LIMIT])).toContain("nonisolated static let postBodyChars = 5_000\n");
  });

  it("refuses a source that would generate something wrong", () => {
    expect(() => parse({ limits: [] })).toThrow(/no limits/);
    expect(() => parse({ limits: [LIMIT, LIMIT] })).toThrow(/twice/);
    expect(() => parse({ limits: [{ ...LIMIT, name: "post_body" }] })).toThrow(/camel/);
    expect(() => parse({ limits: [{ ...LIMIT, unit: "words" }] })).toThrow(/unit/);
    expect(() => parse({ limits: [{ ...LIMIT, value: 1.5 }] })).toThrow(/whole/);
    expect(() => parse({ limits: [{ ...LIMIT, value: 0 }] })).toThrow(/whole/);
    expect(() => parse({ limits: [{ ...LIMIT, doc: "" }] })).toThrow(/says nothing/);
  });
});
