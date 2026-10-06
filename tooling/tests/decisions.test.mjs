// @ts-check
// Every decision record opens the way AGENTS.md § Decision records says, so a
// reader can tell at a glance what is decided, when, and by whom.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT } from "../lib/repo.mjs";

const DIR = join(ROOT, "docs/decisions");
const records = readdirSync(DIR).filter((f) => f.endsWith(".md"));

/**
 * The `- Key: value` list under the title; an indented line continues the
 * item above it.
 *
 * @param {string} text
 * @returns {Map<string, string>}
 */
function headerOf(text) {
  /** @type {Map<string, string>} */
  const header = new Map();
  let last = "";
  for (const line of text.split("\n").slice(2)) {
    const item = /^- ([A-Z][A-Za-z ]+): (.*)$/.exec(line);
    if (item?.[1] && item[2] !== undefined) header.set((last = item[1]), item[2]);
    else if (/^\s+\S/.test(line) && last) header.set(last, `${header.get(last)} ${line.trim()}`);
    else break;
  }
  return header;
}

describe("decision records", () => {
  it("are numbered without gaps from 0001", () => {
    const numbers = records.map((f) => Number(f.slice(0, 4)));
    expect(numbers).toEqual(numbers.map((_, i) => i + 1));
    for (const f of records) expect(f).toMatch(/^\d{4}-[a-z0-9-]+\.md$/);
  });

  it("reads a header item that wraps onto the next line", () => {
    const header = headerOf("# 0001. T\n\n- Status: accepted; designed,\n  not built\n- Date: x\n");
    expect(header.get("Status")).toBe("accepted; designed, not built");
  });

  it.each(records)("%s has its title, header block and decision", (file) => {
    const text = readFileSync(join(DIR, file), "utf8");
    expect(text.split("\n")[0]).toMatch(new RegExp(`^# ${file.slice(0, 4)}\\. \\S`));
    const header = headerOf(text);
    expect(header.get("Status")).toMatch(/^accepted\b/);
    expect(header.get("Date")).toMatch(/^\d{4}-\d{2}-\d{2}\b/);
    expect(header.get("Decided by")).toMatch(/^\S/);
    expect(header.get("Decided by")).not.toMatch(/\bagent\b/i);
    expect(text).toMatch(/^## Decision$/m);
  });
});
