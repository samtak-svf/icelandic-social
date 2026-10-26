// @ts-check
// INDEX.md maps AGENTS.md sections to line ranges, and AGENTS.md grows. A range
// that points at the wrong text is worse than no index, because nothing about
// a wrong jump looks wrong (#279). This checks every row's range, the line count
// in the header, and that no `##`/`###` section lacks a row.
//
// Ported from agent-config's regen-claude-index.mjs; the hand-written
// descriptions are kept, only the numbers are derived.
//
//   node tooling/index-check.mjs           # exit 1, listing each stale range
//   node tooling/index-check.mjs --write   # rewrite the ranges in place

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib/repo.mjs";

const SOURCE = "AGENTS.md";

/**
 * @typedef {{ depth: number, text: string, line: number, end: number }} Head
 */

/**
 * The `##` and `###` headings outside code fences. A section runs to the line
 * before the next heading of any depth.
 * @param {string[]} lines
 * @returns {Head[]}
 */
function headings(lines) {
  /** @type {Head[]} */
  const heads = [];
  /** @type {string | null} */
  let fence = null;
  lines.forEach((text, i) => {
    const marker = /^\s*(```|~~~)/.exec(text)?.[1] ?? null;
    if (marker) {
      fence = fence === null ? marker : fence === marker ? null : fence;
      return;
    }
    if (fence !== null) return;
    const match = /^(#{2,3}) (.+)$/.exec(text);
    if (match)
      heads.push({
        depth: match[1]?.length ?? 2,
        text: (match[2] ?? "").trim(),
        line: i + 1,
        end: 0,
      });
  });
  heads.forEach((head, i) => {
    head.end = heads[i + 1] ? (heads[i + 1]?.line ?? 0) - 1 : lines.length;
  });
  return heads;
}

/** @param {string} s */
const norm = (s) => s.replace(/[`*_]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * The heading an INDEX label names. Labels are shortened by hand, so every
 * heading is scored and a unique best must win; a tie is no match.
 * @param {string} label
 * @param {Head[]} heads
 * @returns {Head | null}
 */
function findHead(label, heads) {
  const wanted = norm(label).replace(/^-\s*/, "");
  const scored = heads
    .map((head) => {
      const text = norm(head.text);
      let score = 0;
      if (wanted === text) score = 1000;
      else if (text.startsWith(wanted)) score = 500 + wanted.length;
      else if (wanted.startsWith(text)) score = 400 + text.length;
      else if (wanted.length > 8 && text.includes(wanted)) score = 200 + wanted.length;
      else if (text.length > 8 && wanted.includes(text)) score = 150 + text.length;
      return { head, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  const [best, second] = scored;
  if (!best || best.score === second?.score) return null;
  return best.head;
}

/**
 * Check INDEX.md against AGENTS.md and compute the corrected INDEX.md.
 * @param {string} agents
 * @param {string} index
 * @returns {{ problems: string[], fixed: string }}
 */
export function checkIndex(agents, index) {
  const lines = agents.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const heads = headings(lines);
  /** @type {string[]} */
  const problems = [];
  const labelled = new Set();

  const fixed = index
    .replace(
      /^\| \*\*(.+?)\*\*( +)\| (\d+-\d+)( +)\| (.*)\|$/gm,
      (row, /** @type {string} */ label, lpad, /** @type {string} */ range, rpad, desc) => {
        const head = findHead(label, heads);
        if (!head) {
          problems.push(`row "${label}" matches no heading in ${SOURCE}`);
          return row;
        }
        labelled.add(head.line);
        const fresh = `${head.line}-${head.end}`;
        if (fresh === range) return row;
        problems.push(`"${label}": INDEX.md says ${range}, ${SOURCE} has ${fresh}`);
        // Keep the cell's width when it fits, so the table stays formatted.
        const pad = " ".repeat(Math.max(1, range.length + rpad.length - fresh.length));
        return `| **${label}**${lpad}| ${fresh}${pad}| ${desc}|`;
      },
    )
    .replace(new RegExp(`${SOURCE.replace(".", "\\.")} \\((\\d+) lines\\)`), (whole, count) => {
      if (Number(count) === lines.length) return whole;
      problems.push(`header says ${SOURCE} has ${count} lines, it has ${lines.length}`);
      return `${SOURCE} (${lines.length} lines)`;
    });

  for (const head of heads) {
    if (!labelled.has(head.line)) {
      problems.push(`section "${head.text}" (line ${head.line}) has no row in INDEX.md`);
    }
  }
  return { problems, fixed };
}

function main() {
  const agents = readFileSync(join(ROOT, SOURCE), "utf8");
  const index = readFileSync(join(ROOT, "INDEX.md"), "utf8");
  const { problems, fixed } = checkIndex(agents, index);
  if (problems.length === 0) {
    console.log("✓ INDEX.md ranges match AGENTS.md");
    return;
  }
  if (process.argv.includes("--write")) {
    writeFileSync(join(ROOT, "INDEX.md"), fixed);
    for (const problem of problems) console.log(`  fixed: ${problem}`);
    const unfixable = problems.filter((p) => /no row|matches no heading/.test(p));
    if (unfixable.length > 0) {
      console.error("index-check: write a row (or fix the label) by hand for the items above");
      process.exit(1);
    }
    return;
  }
  console.error("index-check: INDEX.md is stale (fix: node tooling/index-check.mjs --write):");
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

if (import.meta.main) main();
