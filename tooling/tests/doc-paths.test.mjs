// @ts-check
// A document that cites a path which has since moved misleads the reader who
// trusts it most (#279). Every backticked repo path in AGENTS.md and docs/**/*.md
// must exist, unless the decision record that cites it is superseded or
// amended (its paths are history) or the path is on the short historical list.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GIT_ENV, readJson, ROOT } from "../lib/repo.mjs";

/** Top-level entries a citation may start with. */
const TOP = [
  "backend",
  "web",
  "android",
  "ios",
  "core",
  "tooling",
  "api",
  "brand",
  "identifiers",
  "docs",
  "spikes",
  ".github",
];

/**
 * The repo paths a Markdown text cites in backticks, outside fenced code
 * blocks, without a `:line` suffix. Globs and placeholders are not paths.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function citedPaths(text) {
  /** @type {Set<string>} */
  const found = new Set();
  let fenced = false;
  for (const line of text.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    for (const match of line.matchAll(/`([^`\n]+)`/g)) {
      const raw = (match[1] ?? "").replace(/:\d+(?:-\d+)?$/, "");
      if (/[*<{\s]/.test(raw) || !raw.includes("/")) continue;
      const first = raw.split("/")[0] ?? "";
      if (raw.includes("NNNN")) continue; // a template, not a path
      if (TOP.includes(first) && /^[\w.@-]+(?:\/[\w.@-]+)*\/?$/.test(raw)) found.add(raw);
    }
  }
  return [...found];
}

/**
 * A decision record whose own Status says it was amended or superseded keeps
 * its paths as written: the record is history.
 *
 * @param {string} text
 */
export function isHistorical(text) {
  const status = /^- Status: (.*)$/m.exec(text)?.[1] ?? "";
  return /\b(amended|superseded)\b/i.test(status);
}

/**
 * @typedef {{ path: string, file: string, reason: string }} Exemption
 * @param {{ file: string, text: string }[]} docs
 * @param {(path: string) => boolean} exists
 * @param {Exemption[]} [exemptions]
 * @returns {string[]} problems
 */
export function docPathProblems(docs, exists, exemptions = []) {
  /** @type {string[]} */
  const problems = [];
  const used = new Set();
  for (const { file, text } of docs) {
    if (isHistorical(text)) continue;
    for (const path of citedPaths(text)) {
      if (exists(path)) continue;
      const index = exemptions.findIndex((e) => e.path === path && e.file === file);
      if (index >= 0) used.add(index);
      else problems.push(`${file} cites ${path}, which does not exist`);
    }
  }
  exemptions.forEach((e, index) => {
    if (!e.reason?.trim()) problems.push(`doc-paths.historical.json: ${e.path} has no reason`);
    if (!used.has(index)) {
      problems.push(`doc-paths.historical.json: ${e.path} in ${e.file} no longer needs its entry`);
    }
  });
  return problems;
}

/** @param {string} dir repo-relative */
function markdownUnder(dir) {
  /** @type {string[]} */
  const out = [];
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...markdownUnder(rel));
    else if (entry.name.endsWith(".md")) out.push(rel);
  }
  return out;
}

/**
 * A path a fresh clone lacks on purpose (built or fetched, gitignored) counts
 * as existing.
 * @param {string} path
 */
function onDisk(path) {
  if (existsSync(join(ROOT, path))) return true;
  try {
    execFileSync("git", ["check-ignore", "-q", path], { cwd: ROOT, env: GIT_ENV });
    return true;
  } catch {
    return false;
  }
}

describe("doc paths", () => {
  it("finds backticked repo paths outside code fences, without :line or globs", () => {
    const text = [
      "See `backend/src/a.ts:12` and `docs/x.md`, not `backend/src/*.ts`, `foo/bar.ts`",
      "or `core/{a,b}`, `tooling/<name>.mjs`, `pnpm check`.",
      "```",
      "`core/inside/fence.rs`",
      "```",
      "A dir: `web/src/`.",
    ].join("\n");
    expect(citedPaths(text).sort()).toEqual(["backend/src/a.ts", "docs/x.md", "web/src/"]);
  });

  it("fails on a missing path, and spares an amended record and a listed exception", () => {
    const docs = [
      { file: "docs/a.md", text: "Run `core/web-spike/run.sh`." },
      { file: "docs/b.md", text: "- Status: accepted; amended by 0002\n\n`core/gone.rs`" },
    ];
    expect(docPathProblems(docs, () => false)).toEqual([
      "docs/a.md cites core/web-spike/run.sh, which does not exist",
    ]);
    const listed = [{ path: "core/web-spike/run.sh", file: "docs/a.md", reason: "history" }];
    expect(docPathProblems(docs, () => false, listed)).toEqual([]);
  });

  it("fails an exception that no longer matches, or has no reason", () => {
    const docs = [{ file: "docs/a.md", text: "`core/here.rs`" }];
    const stale = [{ path: "core/here.rs", file: "docs/a.md", reason: "" }];
    expect(docPathProblems(docs, () => true, stale)).toEqual([
      "doc-paths.historical.json: core/here.rs has no reason",
      "doc-paths.historical.json: core/here.rs in docs/a.md no longer needs its entry",
    ]);
  });

  it("holds for AGENTS.md and every document under docs/", () => {
    const files = ["AGENTS.md", ...markdownUnder("docs")];
    const docs = files.map((file) => ({ file, text: readFileSync(join(ROOT, file), "utf8") }));
    const exemptions = readJson("tooling/doc-paths.historical.json");
    expect(docPathProblems(docs, onDisk, exemptions)).toEqual([]);
  });
});
