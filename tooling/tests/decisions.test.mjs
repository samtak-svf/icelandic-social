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

/**
 * Who may be named as deciding: a person by name, the maintainer, or the overseer
 * on a named person's question or order and only with that person's right to
 * overturn it. A role that answers to nobody decides nothing.
 */
const DECIDERS = [
  /^(?!(?:The|Overseer|Claude|Agent)\b)\p{Lu}\p{L}+(?=[\s,(;.]|$)/u,
  /^the maintainer\b/,
  /^the overseer, on \p{Lu}.*; his to overturn$/u,
];

/**
 * @param {string} decider
 * @returns {boolean}
 */
function deciderIsKnown(decider) {
  return !/\bagent\b/i.test(decider) && DECIDERS.some((form) => form.test(decider));
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

  it("knows who may decide, and refuses an overseer nobody can overturn", () => {
    expect(deciderIsKnown("Ada")).toBe(true);
    expect(deciderIsKnown("Ada Lovelace (plan); the design is the overseer's")).toBe(true);
    expect(deciderIsKnown("Þór, approving the plan")).toBe(true);
    expect(deciderIsKnown("the maintainer, approving the plan")).toBe(true);
    expect(deciderIsKnown("the overseer, on Ada Lovelace's order; his to overturn")).toBe(true);
    expect(deciderIsKnown("the overseer")).toBe(false);
    expect(deciderIsKnown("The overseer, deciding alone")).toBe(false);
    expect(deciderIsKnown("the overseer, on Ada Lovelace's order")).toBe(false);
    expect(deciderIsKnown("the overseer, on the plan; his to overturn")).toBe(false);
    expect(deciderIsKnown("Overseer")).toBe(false);
    expect(deciderIsKnown("an agent")).toBe(false);
    expect(deciderIsKnown("Ada, through an agent")).toBe(false);
  });

  it.each(records)("%s has its title, header block and decision", (file) => {
    const text = readFileSync(join(DIR, file), "utf8");
    expect(text.split("\n")[0]).toMatch(new RegExp(`^# ${file.slice(0, 4)}\\. \\S`));
    const header = headerOf(text);
    expect(header.get("Status")).toMatch(/^accepted\b/);
    expect(statusIsKnown(header.get("Status") ?? ""), header.get("Status")).toBe(true);
    expect(header.get("Date")).toMatch(/^\d{4}-\d{2}-\d{2}\b/);
    expect(deciderIsKnown(header.get("Decided by") ?? ""), header.get("Decided by")).toBe(true);
    expect(text).toMatch(/^## Decision$/m);
  });
});
