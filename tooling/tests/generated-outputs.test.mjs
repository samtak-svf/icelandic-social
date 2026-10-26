// @ts-check
// A generated output earns its place by having a consumer (decision 0097). The
// table names every generated client or contract file in the repo and the code
// that must read it; an output nobody reads is dead weight that CI keeps
// current, so the test fails until the output or its emitter is removed.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT } from "../lib/repo.mjs";

/**
 * @typedef {object} Output
 * @property {string} output the generated file or directory
 * @property {string[]} consumerDirs where a consumer lives (files or directories)
 * @property {RegExp} reference what a consumer's text must contain
 * @property {string[]} [skip] path fragments that do not count as a consumer
 */

/** @type {Output[]} */
const OUTPUTS = [
  {
    output: "api/openapi.json",
    consumerDirs: ["tooling/web-api.mjs", "backend/test/api/contract.test.ts"],
    reference: /openapi\.json/,
  },
  {
    output: "web/src/generated/api.ts",
    consumerDirs: ["web/src"],
    reference: /from "[./]+\/generated\/api\.ts"/,
    skip: ["web/src/generated/"],
  },
];

/**
 * @param {string} path absolute
 * @returns {string[]} absolute paths of the files under it
 */
function filesUnder(path) {
  if (!existsSync(path)) return [];
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path).flatMap((name) =>
    name === "node_modules" || name === "build" ? [] : filesUnder(join(path, name)),
  );
}

describe("generated outputs", () => {
  it.each(OUTPUTS)("$output exists", ({ output }) => {
    expect(existsSync(join(ROOT, output))).toBe(true);
  });

  it.each(OUTPUTS)("$output has a consumer", ({ output, consumerDirs, reference, skip = [] }) => {
    const consumers = consumerDirs
      .flatMap((dir) => filesUnder(join(ROOT, dir)))
      .filter((file) => !skip.some((fragment) => file.includes(fragment)))
      .filter((file) => reference.test(readFileSync(file, "utf8")));
    expect(consumers, `nothing under ${consumerDirs.join(", ")} reads ${output}`).not.toEqual([]);
  });
});
