// @ts-check
// Core DTO drift guard (#267).
//
// `core/ffi` and `core/wasm` mirror the client's types for the platforms. A
// field added to a client type must not go missing in a mirror without
// anyone choosing that, so every `impl From<X> for Y` in `core/ffi/src` and
// `core/wasm/src/dto.rs` converts its parameter exhaustively:
//
// 1. A struct is destructured by name, every field listed
//    (`let Foo { a, b, c } = value;`), and a field the mirror drops is bound
//    as `field: _` with a comment saying why. Reading `value.field` or
//    destructuring with `..` would compile after a field is added and leave
//    the mirror quietly short; naming every field makes it a compile error.
// 2. A `match` on the parameter has an arm per variant and no `_ =>` arm, for
//    the same reason.
//
// A source that is not ours to enumerate (a foreign, non-exhaustive error
// type) is a named entry in EXEMPT with its reason. Comments and strings are
// blanked first, so a sentence about `value.field` is not a read.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib/repo.mjs";

/** The files scanned: every ffi source and the wasm DTO view. */
const DIRS = ["core/ffi/src"];
const FILES = ["core/wasm/src/dto.rs"];

/**
 * Conversions whose source is a foreign, non-exhaustive or open type, keyed
 * by `file::From<Source> for Target`, each with its reason.
 * @type {Record<string, string>}
 */
export const EXEMPT = {};

/**
 * @typedef {{ file: string, line: number, rule: string, message: string }} Violation
 */

/**
 * Blank comments and string and char literals, keeping offsets and newlines.
 *
 * @param {string} source
 */
export function stripRust(source) {
  let out = "";
  let i = 0;
  const blank = (/** @type {string} */ text) => text.replace(/[^\n]/g, " ");
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    if (two === "//") {
      const end = source.indexOf("\n", i);
      const stop = end === -1 ? source.length : end;
      out += blank(source.slice(i, stop));
      i = stop;
    } else if (two === "/*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      out += blank(source.slice(i, stop));
      i = stop;
    } else if (source[i] === '"') {
      let j = i + 1;
      while (j < source.length && source[j] !== '"') j += source[j] === "\\" ? 2 : 1;
      out += blank(source.slice(i, j + 1));
      i = j + 1;
    } else if (source[i] === "'") {
      // A char literal, not a lifetime: 'x' or '\n' closes within a few bytes.
      const char = /^'(?:\\[^']*|[^\\'])'/.exec(source.slice(i, i + 12));
      if (char) {
        out += blank(char[0]);
        i += char[0].length;
      } else {
        out += source[i];
        i += 1;
      }
    } else {
      out += source[i];
      i += 1;
    }
  }
  return out;
}

/**
 * @param {string} text
 * @param {number} offset
 */
function lineAt(text, offset) {
  return text.slice(0, offset).split("\n").length;
}

/**
 * The offset just past the brace that closes the one at `open`.
 *
 * @param {string} code
 * @param {number} open
 */
function closeOf(code, open) {
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === "{") depth += 1;
    else if (code[i] === "}") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return code.length;
}

/**
 * The violations inside one conversion body, as offsets into it.
 *
 * @param {string} body
 * @param {string} param name of the `from` parameter
 * @returns {{ at: number, rule: string, message: string }[]}
 */
function inBody(body, param) {
  /** @type {{ at: number, rule: string, message: string }[]} */
  const found = [];

  // A field read: `value.field` or `value.0`, not a method call. The closure
  // parameters of the body count too: `.map(|d| Out { x: d.x })` is the same
  // copy one level down.
  const names = new Set([param]);
  for (const c of body.matchAll(/\|\s*(\(?[\w\s,&]+\)?)\s*\|/g)) {
    for (const id of (c[1] ?? "").match(/[a-z_]\w*/g) ?? []) names.add(id);
  }
  for (const name of names) {
    const read = new RegExp(`(?<![\\w.])${name}\\s*\\.(\\w+)(?!\\w|\\s*\\(|\\s*::)`, "g");
    for (let r = read.exec(body); r; r = read.exec(body)) {
      found.push({
        at: r.index,
        rule: "field-read",
        message: `reads \`${name}.${r[1]}\`; destructure the source by name`,
      });
    }
  }

  // A rest pattern in a destructuring of the parameter.
  const rest = new RegExp(
    `let\\s+[\\w:]+\\s*(?:\\{[^;]*?\\.\\.\\s*\\}|\\([^;]*?\\.\\.\\s*\\))\\s*=\\s*&?${param}\\b`,
    "g",
  );
  for (let r = rest.exec(body); r; r = rest.exec(body)) {
    found.push({
      at: r.index,
      rule: "rest-pattern",
      message: "destructures with `..`; list every field, `x: _` for a dropped one",
    });
  }

  // A wildcard arm in a match on the parameter.
  const scrutinee = new RegExp(`match\\s+&?${param}\\b[^{]*\\{`, "g");
  for (let r = scrutinee.exec(body); r; r = scrutinee.exec(body)) {
    const armsOpen = r.index + r[0].length - 1;
    const arms = body.slice(armsOpen, closeOf(body, armsOpen));
    for (const w of arms.matchAll(/(?<!\w)_\s*(?:if\s[^=]*)?=>/g)) {
      found.push({
        at: armsOpen + (w.index ?? 0),
        rule: "wildcard-arm",
        message: "a `_ =>` arm hides a new variant; name each one",
      });
    }
  }
  return found;
}

/**
 * Every violation in one Rust source.
 *
 * @param {string} file path shown in the report
 * @param {string} source
 * @param {Record<string, string>} [exempt]
 * @returns {Violation[]}
 */
export function findInSource(file, source, exempt = EXEMPT) {
  const code = stripRust(source);
  /** @type {Violation[]} */
  const found = [];
  const header = /impl\s+From<([^{]*?)>\s+for\s+([\w:]+)\s*\{/g;
  for (let m = header.exec(code); m; m = header.exec(code)) {
    const key = `${file}::From<${(m[1] ?? "").replace(/\s+/g, " ")}> for ${m[2]}`;
    if (key in exempt) continue;
    const open = m.index + m[0].length - 1;
    const body = code.slice(open, closeOf(code, open));
    const param = /fn\s+from\s*\(\s*(?:mut\s+)?(\w+)\s*:/.exec(body)?.[1];
    if (!param) continue;
    for (const v of inBody(body, param)) {
      found.push({
        file,
        line: lineAt(code, open + v.at),
        rule: v.rule,
        message: `${key}: ${v.message}`,
      });
    }
  }
  return found;
}

/** The scanned files, repo-relative. */
function sources() {
  const files = [...FILES];
  for (const dir of DIRS) {
    for (const entry of readdirSync(join(ROOT, dir), { recursive: true })) {
      if (String(entry).endsWith(".rs")) files.push(`${dir}/${String(entry)}`);
    }
  }
  return files.sort();
}

/**
 * @param {string} [root]
 * @returns {{ violations: Violation[], scanned: number }}
 */
export function findViolations(root = ROOT) {
  const files = sources();
  /** @type {Violation[]} */
  const violations = [];
  for (const file of files) {
    violations.push(...findInSource(file, readFileSync(join(root, file), "utf8")));
  }
  return { violations, scanned: files.length };
}

function main() {
  const { violations, scanned } = findViolations();
  if (scanned === 0) {
    console.error("core-dto-guard: scanned no files");
    process.exit(2);
  }
  for (const v of violations) {
    console.error(`::error file=${v.file},line=${v.line}::${v.rule}: ${v.message}`);
  }
  if (violations.length > 0) {
    console.error(`core-dto-guard: ${violations.length} violation(s)`);
    process.exit(1);
  }
  console.log(`core-dto-guard: ${scanned} files, every From converts exhaustively`);
}

if (import.meta.main) main();
