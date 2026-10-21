// @ts-check
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT } from "../lib/repo.mjs";

// backend/public/_headers, which Vite copies into the static assets and
// Workers static assets applies: the hashed files under /assets/ are cached
// for good, and nothing else is, since a page or an unhashed file must change
// under the same URL.

/** @returns {Map<string, Map<string, string>>} path pattern to headers */
function rules() {
  const text = readFileSync(join(ROOT, "backend/public/_headers"), "utf8");
  /** @type {Map<string, Map<string, string>>} */
  const out = new Map();
  /** @type {Map<string, string> | undefined} */
  let current;
  for (const line of text.split("\n")) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    if (!/^\s/.test(line)) {
      current = new Map();
      out.set(line.trim(), current);
    } else {
      const [name = "", ...value] = line.trim().split(":");
      current?.set(name.trim().toLowerCase(), value.join(":").trim());
    }
  }
  return out;
}

describe("static asset headers", () => {
  it("caches the hashed files under /assets/ for a year, immutable", () => {
    const cache = rules().get("/assets/*")?.get("cache-control") ?? "";
    expect(cache).toMatch(/\bimmutable\b/);
    expect(Number(/max-age=(\d+)/.exec(cache)?.[1])).toBeGreaterThanOrEqual(31536000);
  });

  it("makes nothing outside /assets/ immutable", () => {
    for (const [pattern, headers] of rules()) {
      if (pattern === "/assets/*") continue;
      expect(headers.get("cache-control") ?? "", pattern).not.toMatch(/immutable/);
    }
  });
});
