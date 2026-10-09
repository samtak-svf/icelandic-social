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

/**
 * What a Status may say after `accepted`: nothing, or a first clause that
 * starts with one of these. A status is a claim about the code, so the words
 * are few and each one can be checked against it; "to be built" and the like
 * drift silently once the code lands.
 */
const STATES = [
  /^implemented\b/,
  /^designed, not yet implemented\b/,
  /^deferred\b/,
  /^(?:[a-z ]+ )?amended by\b/,
];

/**
 * @param {string} status
 * @returns {boolean}
 */
function statusIsKnown(status) {
  const rest = /^accepted(?:$|[;.] (.*)$)/.exec(status);
  if (!rest) return false;
  const clause = rest[1];
  return clause === undefined || STATES.some((state) => state.test(clause));
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

  it("knows the states a status may claim, and no others", () => {
    expect(statusIsKnown("accepted")).toBe(true);
    expect(statusIsKnown("accepted; implemented in the core (#58)")).toBe(true);
    expect(statusIsKnown("accepted; designed, not yet implemented")).toBe(true);
    expect(statusIsKnown("accepted; deferred beyond v1 (0009)")).toBe(true);
    expect(statusIsKnown("accepted; registration amended by 0019")).toBe(true);
    expect(statusIsKnown("accepted; to be built in the backend")).toBe(false);
    expect(statusIsKnown("accepted. The apps reach the server")).toBe(false);
    expect(statusIsKnown("proposed")).toBe(false);
  });

  it.each(records)("%s has its title, header block and decision", (file) => {
    const text = readFileSync(join(DIR, file), "utf8");
    expect(text.split("\n")[0]).toMatch(new RegExp(`^# ${file.slice(0, 4)}\\. \\S`));
    const header = headerOf(text);
    expect(header.get("Status")).toMatch(/^accepted\b/);
    expect(statusIsKnown(header.get("Status") ?? ""), header.get("Status")).toBe(true);
    expect(header.get("Date")).toMatch(/^\d{4}-\d{2}-\d{2}\b/);
    expect(header.get("Decided by")).toMatch(/^\S/);
    expect(header.get("Decided by")).not.toMatch(/\bagent\b/i);
    expect(text).toMatch(/^## Decision$/m);
  });
});
