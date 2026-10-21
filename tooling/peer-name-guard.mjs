// @ts-check
// Peer name guard: the public repo names no other messenger app.
//
// The project is compared against established messengers often, and the
// comparison is useful, but in a public repository a rival's name reads as a
// claim about that product. So the rule (AGENTS.md § Public repository) is that
// files, commit messages and PR text say "an established messenger", and the
// named comparison lives only in the gitignored private/comparison/.
//
// The names are kept as SHA-256 hashes in tooling/peer-names.json, so the
// guard does not itself spell out what it bans. Three lists:
//
//   anywhere  matched in every text file, in any case and inside identifiers;
//   proper    words that are also plain English or our own identifiers (we
//             have a `Signal` type), matched only capitalised, in prose (a .md
//             file, a commit message, a PR's title and body), outside backticks;
//   hosts     a label of a URL host, in any file.
//
// `node tooling/peer-name-guard.mjs`                every visible file
// `node tooling/peer-name-guard.mjs --staged`       staged files (pre-commit)
// `node tooling/peer-name-guard.mjs --message <f>`  a commit message (commit-msg)
// `node tooling/peer-name-guard.mjs --range A..B`   the messages of a commit range
// `node tooling/peer-name-guard.mjs --stdin`        prose on stdin (a PR's title and body)
// `node tooling/peer-name-guard.mjs --hash <name>`  the hash to add for a new name

import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { git, readJson, ROOT, stagedFiles, visibleFiles } from "./lib/repo.mjs";

/** @typedef {{ anywhere: string[], proper: string[], hosts: string[] }} NameList */
/** @typedef {{ where: string, line: number, word: string }} Hit */

const BINARY = /\.(png|jpe?g|gif|webp|ico|pdf|woff2?|ttf|otf|zip|jar|keystore|p8|p12)$/i;
const SKIPPED = [/(^|\/)pnpm-lock\.yaml$/, /(^|\/)node_modules\//, /^tooling\/peer-names\.json$/];
const PROSE = /\.(md|mdx|txt)$/i;
const URL_HOST = /\bhttps?:\/\/([^/\s)>\]"'`]+)/gi;

/** @param {string} word */
export function hash(word) {
  return createHash("sha256").update(word.toLowerCase()).digest("hex");
}

/**
 * Report enough to find the word, never the word itself: a CI log is public.
 *
 * @param {string} word
 */
function redact(word) {
  return `${word.slice(0, 2)}${"•".repeat(Math.max(0, word.length - 2))}`;
}

/**
 * Words of a line: each run of letters, plus its camelCase parts, so a name
 * buried in an identifier is found either way.
 *
 * @param {string} line
 */
function tokens(line) {
  const runs = line.match(/\p{L}+/gu) ?? [];
  return runs.flatMap((run) => [
    run,
    ...(run.replace(/(\p{Ll})(\p{Lu})/gu, "$1 $2").match(/\p{L}+/gu) ?? []).filter(
      (part) => part !== run,
    ),
  ]);
}

/**
 * @param {string} text
 * @param {boolean} prose
 * @param {NameList} names
 * @returns {Array<{ line: number, word: string }>}
 */
export function namesInText(text, prose, names) {
  const anywhere = new Set(names.anywhere);
  const proper = new Set(names.proper);
  const hosts = new Set(names.hosts);
  /** @type {Array<{ line: number, word: string }>} */
  const found = [];
  text.split("\n").forEach((line, i) => {
    const at = (/** @type {string} */ word) => found.push({ line: i + 1, word: redact(word) });
    for (const word of tokens(line)) if (anywhere.has(hash(word))) at(word);
    if (prose) {
      const outsideCode = line.replace(/`[^`]*`/g, " ").replace(URL_HOST, " ");
      for (const word of outsideCode.match(/\p{L}+/gu) ?? []) {
        if (/^\p{Lu}/u.test(word) && proper.has(hash(word))) at(word);
      }
    }
    for (const m of line.matchAll(URL_HOST)) {
      const label = (m[1] ?? "").split(".").find((part) => hosts.has(hash(part)));
      if (label) at(label);
    }
  });
  return found;
}

/**
 * @param {string[]} files repo-relative
 * @param {NameList} names
 * @param {string} [root]
 * @returns {Hit[]}
 */
export function namesInFiles(files, names, root = ROOT) {
  /** @type {Hit[]} */
  const hits = [];
  for (const file of files) {
    if (BINARY.test(file) || SKIPPED.some((re) => re.test(file))) continue;
    const path = join(root, file);
    let text;
    try {
      if (statSync(path).size > 2 * 1024 * 1024) continue;
      text = readFileSync(path, "utf8");
    } catch {
      continue; // deleted since it was listed
    }
    if (text.includes("\0")) continue;
    for (const { line, word } of namesInText(text, PROSE.test(file), names)) {
      hits.push({ where: file, line, word });
    }
  }
  return hits;
}

/**
 * Commit messages in a range, each read as prose.
 *
 * @param {string} range `base..head`
 * @param {NameList} names
 * @returns {Hit[]}
 */
function namesInRange(range, names) {
  /** @type {Hit[]} */
  const hits = [];
  for (const sha of git(["rev-list", range]).split("\n").filter(Boolean)) {
    const message = git(["log", "-1", "--format=%B", sha]);
    for (const { line, word } of namesInText(message, true, names)) {
      hits.push({ where: `commit ${sha.slice(0, 7)}`, line, word });
    }
  }
  return hits;
}

/** @param {string} flag */
function argAfter(flag) {
  const i = process.argv.indexOf(flag);
  const value = i === -1 ? undefined : process.argv[i + 1];
  if (i !== -1 && !value) throw new Error(`${flag} needs a value`);
  return value;
}

function main() {
  const word = argAfter("--hash");
  if (word) {
    console.log(hash(word));
    return;
  }
  /** @type {NameList} */
  const names = readJson("tooling/peer-names.json");
  const message = argAfter("--message");
  const range = argAfter("--range");
  /** @type {Hit[]} */
  let hits;
  let scope;
  if (message) {
    scope = "the commit message";
    hits = namesInText(readFileSync(message, "utf8"), true, names).map((h) => ({
      where: "commit message",
      ...h,
    }));
  } else if (range) {
    scope = `the messages of ${range}`;
    hits = namesInRange(range, names);
  } else if (process.argv.includes("--stdin")) {
    scope = "the text on stdin";
    hits = namesInText(readFileSync(0, "utf8"), true, names).map((h) => ({
      where: "stdin",
      ...h,
    }));
  } else {
    const staged = process.argv.includes("--staged");
    const files = staged ? stagedFiles() : visibleFiles();
    scope = `${files.length} ${staged ? "staged" : "visible"} file(s)`;
    hits = namesInFiles(files, names);
  }
  if (hits.length === 0) {
    console.log(`✓ no other messenger named in ${scope}`);
    return;
  }
  for (const h of hits)
    console.error(`::error::${h.where}:${h.line} names another messenger (${h.word})`);
  console.error(`
${hits.length} name(s) of another messenger. This repository is public and names
none (AGENTS.md § Public repository): write "an established messenger". The
named comparison belongs in the gitignored private/comparison/.`);
  process.exit(1);
}

if (import.meta.main) main();
