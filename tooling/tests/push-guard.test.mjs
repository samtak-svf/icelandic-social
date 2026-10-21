// @ts-check
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT } from "../lib/repo.mjs";
import { pushesToMain } from "../push-guard.mjs";

const SHA = "a".repeat(40);
const ZERO = "0".repeat(40);

/**
 * @param {string} stdin
 * @returns {number} the guard's exit status
 */
function run(stdin) {
  try {
    execFileSync("node", [join(ROOT, "tooling/push-guard.mjs")], { input: stdin, stdio: "pipe" });
    return 0;
  } catch (error) {
    return /** @type {{ status: number }} */ (error).status;
  }
}

describe("push-guard", () => {
  it("refuses an update or a delete of main, whatever is checked out", () => {
    expect(run(`refs/heads/feature ${SHA} refs/heads/main ${ZERO}\n`)).toBe(1);
    expect(run(`(delete) ${ZERO} refs/heads/main ${SHA}\n`)).toBe(1);
  });

  it("lets a branch, a branch delete and a tag through", () => {
    expect(run(`refs/heads/feature ${SHA} refs/heads/feature ${ZERO}\n`)).toBe(0);
    expect(run(`(delete) ${ZERO} refs/heads/merged ${SHA}\n`)).toBe(0);
    expect(run(`refs/tags/core-v1.0.0 ${SHA} refs/tags/core-v1.0.0 ${ZERO}\n`)).toBe(0);
    expect(run("")).toBe(0);
  });

  it("names only the lines that touch main", () => {
    const stdin = [
      `refs/heads/a ${SHA} refs/heads/a ${ZERO}`,
      `refs/heads/b ${SHA} refs/heads/main ${ZERO}`,
      `refs/heads/c ${SHA} refs/heads/main-notes ${ZERO}`,
    ].join("\n");
    expect(pushesToMain(stdin)).toEqual([`refs/heads/b ${SHA} refs/heads/main ${ZERO}`]);
  });
});
