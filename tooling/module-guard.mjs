// @ts-check
// Module guard for the Worker (#274).
//
// The Worker is split into modules: `backend/src/identity/` and each
// `backend/src/modules/<name>/`. Everything else under `backend/src/` is
// shared: the app, the env seam, the contract, logging, errors.
//
// 1. Code outside a module imports it only through its entry: `index.ts`, or
//    `objects.ts`, which exports its Durable Object classes for the Worker's
//    entry (they import cloudflare:workers, which Node cannot load).
// 2. Every D1 table has one owning module (OWNERS). Only that module's SQL
//    writes it: INSERT, UPDATE, DELETE or REPLACE.
// 3. A module reads another's table only where READS names the pair and
//    says why. Anything else goes through the owner's entry.
// 4. Shared code touches no table at all.
// 5. Every table the migrations leave standing has an owner, so a new table
//    is assigned when it is created.
// 6. A table with a view of its live rows (RAW) is read bare only in the
//    files RAW names; everything else reads the view, so a deleted row
//    cannot leak through a query that forgot the filter (decision 0070).
//
// SQL is found in string literals, imports in code with comments blanked
// (tooling/lib/source.mjs). Tests are not scanned: they set up rows directly.

import { readdirSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { ROOT, visibleFiles } from "./lib/repo.mjs";
import { lineOf, stringsOf, stripCommentsAndStrings } from "./lib/source.mjs";

const SRC = "backend/src/";
const MIGRATIONS = "backend/migrations";
const ENTRIES = ["index.ts", "objects.ts"];

/** Each D1 table and the one module that writes it. */
export const OWNERS = {
  accounts: "identity",
  blocks: "identity",
  devices: "identity",
  device_link_requests: "identity",
  identities: "identity",
  invites: "identity",
  // A device's KeyPackages live and die with it: revoking, merging and
  // deleting drop them in the device's own batch (decisions 0019, 0029).
  key_packages: "identity",
  sessions: "identity",
  conversation_members: "messaging",
  conversation_rosters: "messaging",
  media: "messaging",
  communities: "communities",
  live_communities: "communities",
  community_members: "communities",
  community_join_requests: "communities",
  community_invitations: "communities",
  community_bans: "communities",
  community_reads: "communities",
  community_pins: "communities",
  post_index: "social",
  social_media: "social",
  space_authors: "social",
  platform_moderators: "moderation",
  reports: "moderation",
  moderation_log: "moderation",
  jobs: "jobs",
  notifications: "notifications",
  history_transfers: "history",
  history_transfer_parts: "history",
};

/** The reads of another module's table, each with its reason. */
export const READS = [
  {
    module: "messaging",
    table: "accounts",
    why: "a roster copy leaves out accounts already deleted",
  },
  {
    module: "profiles",
    table: "accounts",
    why: "a profile is an account's name, mark and photo version",
  },
  {
    module: "profiles",
    table: "devices",
    why: "the directory lists only accounts with an active device (decision 0036)",
  },
  {
    module: "profiles",
    table: "blocks",
    why: "the directory and photos are withheld across a block (decisions 0036, 0039)",
  },
  {
    module: "communities",
    table: "post_index",
    why: "a moderator's count of the anonymous posts that wait for approval (decision 0091)",
  },
  {
    module: "moderation",
    table: "post_index",
    why: "the log and a report never name the author of an anonymous post (decision 0091)",
  },
  {
    module: "communities",
    table: "accounts",
    why: "only a verified account creates a community, and members are listed by name (decision 0063)",
  },
  {
    module: "social",
    table: "accounts",
    why: "a post and a comment show their author's name and mark (decision 0063)",
  },
  {
    module: "social",
    table: "community_members",
    why: "the feed reads the posts of the caller's communities in one query (#275)",
  },
  {
    module: "social",
    table: "live_communities",
    why: "the feed reads only live communities, and ends at the oldest of the caller's",
  },
  {
    module: "communities",
    table: "platform_moderators",
    why: "a standing says whether the viewer is a platform moderator, who reads and moderates every community (decision 0066)",
  },
  {
    module: "communities",
    table: "reports",
    why: "a standing tells a moderator how many open reports wait in the community (decision 0079)",
  },
  {
    module: "notifications",
    table: "accounts",
    why: "a notification is written only for an account that still exists",
  },
  {
    module: "notifications",
    table: "live_communities",
    why: "a notification is written and shown only for a community that is not deleted",
  },
];

/**
 * The tables read through a view of their live rows, and the only files that
 * read them bare: the owner's queries that must see deleted rows too.
 */
export const RAW = {
  communities: {
    view: "live_communities",
    files: [
      "backend/src/modules/communities/communities.ts",
      "backend/src/modules/communities/lifecycle.ts",
    ],
  },
};

const WRITE =
  /\b(?:INSERT(?:\s+OR\s+[A-Z]+)?\s+INTO|REPLACE\s+INTO|UPDATE(?:\s+OR\s+[A-Z]+)?|DELETE\s+FROM)\s+([a-z_][a-z0-9_]*)/g;
const READ = /\b(DELETE\s+)?FROM\s+([a-z_][a-z0-9_]*)|\bJOIN\s+([a-z_][a-z0-9_]*)/g;
const IMPORT =
  /\b(?:import|export)\b[^;]*?\bfrom\s*(["'])(\.{1,2}\/[^"']+)\1|\bimport\s*\(?\s*(["'])(\.{1,2}\/[^"']+)\3/g;

/**
 * @typedef {{ file: string, line: number, rule: string, message: string }} Violation
 * @typedef {{ view: string, files: string[] }} Raw
 * @typedef {{
 *   owners: Record<string, string>,
 *   reads: { module: string, table: string }[],
 *   raw?: Record<string, Raw>,
 * }} Rules
 */

/**
 * The module a file belongs to, or null for shared code.
 *
 * @param {string} file repo-relative path
 */
export function moduleOf(file) {
  if (file.startsWith(`${SRC}identity/`)) return "identity";
  const match = /^backend\/src\/modules\/([^/]+)\//.exec(file);
  return match?.[1] ?? null;
}

/** @param {string} module */
function rootOf(module) {
  return module === "identity" ? `${SRC}identity/` : `${SRC}modules/${module}/`;
}

/**
 * @typedef {(offset: number, rule: string, message: string) => void} Add
 */

/**
 * @param {string} file
 * @param {string | null} module
 * @param {string} source
 * @param {Add} add
 */
function checkImports(file, module, source, add) {
  const code = stripCommentsAndStrings(source);
  for (const match of source.matchAll(IMPORT)) {
    // The keyword must be code, not a comment or a string that mentions it.
    if (code[match.index] !== source[match.index]) continue;
    const target = posix.normalize(posix.join(posix.dirname(file), match[2] ?? match[4] ?? ""));
    const into = moduleOf(target);
    if (!into || into === module) continue;
    if (!ENTRIES.some((entry) => target === `${rootOf(into)}${entry}`)) {
      add(
        match.index,
        "deep-import",
        `imports ${target}; outside ${into} import ${rootOf(into)}index.ts`,
      );
    }
  }
}

/**
 * A read of a table RAW names, outside the files allowed to read it bare.
 *
 * @param {string} file
 * @param {string} table
 * @param {number} at
 * @param {NonNullable<Rules["raw"]>} raw
 * @param {Add} add
 */
function checkRaw(file, table, at, raw, add) {
  const bare = Object.hasOwn(raw, table) ? raw[table] : undefined;
  if (bare && !bare.files.includes(file)) {
    add(at, "raw-read", `reads ${table} bare; read ${bare.view}, which leaves out deleted rows`);
  }
}

/**
 * The SQL in one string literal.
 *
 * @param {string} file
 * @param {string | null} module
 * @param {{ text: string, offset: number }} literal
 * @param {Rules} rules
 * @param {Add} add
 */
function checkSql(file, module, { text, offset }, { owners, reads, raw = {} }, add) {
  const owner = (/** @type {string} */ table) =>
    Object.hasOwn(owners, table) && owners[table] !== module ? owners[table] : undefined;
  for (const match of text.matchAll(WRITE)) {
    const table = match[1] ?? "";
    const own = owner(table);
    if (!own) continue;
    add(
      offset + match.index,
      module ? "foreign-write" : "outside-module",
      module
        ? `${module} writes ${table}, which ${own} owns; call ${own} instead`
        : `shared code writes ${table}; move the SQL into ${own}`,
    );
  }
  for (const match of text.matchAll(READ)) {
    const table = match[2] ?? match[3] ?? "";
    if (!match[1]) checkRaw(file, table, offset + match.index, raw, add);
    const own = owner(table);
    // DELETE FROM is a write, reported above.
    if (match[1] || !own) continue;
    if (!module) {
      add(
        offset + match.index,
        "outside-module",
        `shared code reads ${table}; move the SQL into ${own}`,
      );
    } else if (!reads.some((r) => r.module === module && r.table === table)) {
      add(
        offset + match.index,
        "foreign-read",
        `${module} reads ${table}, which ${own} owns; add it to READS with a reason, or ask ${own}`,
      );
    }
  }
}

/**
 * @param {string} file repo-relative path
 * @param {string} source
 * @param {Rules} [rules]
 * @returns {Violation[]}
 */
export function findInSource(file, source, rules = { owners: OWNERS, reads: READS, raw: RAW }) {
  const module = moduleOf(file);
  /** @type {Violation[]} */
  const found = [];
  /** @type {Add} */
  const add = (offset, rule, message) =>
    found.push({ file, line: lineOf(source, offset), rule, message });
  checkImports(file, module, source, add);
  for (const literal of stringsOf(source)) checkSql(file, module, literal, rules, add);
  return found;
}

/**
 * The tables the migrations leave standing, in order of creation.
 *
 * @param {{ name: string, sql: string }[]} migrations sorted by name
 */
export function liveTables(migrations) {
  /** @type {Set<string>} */
  const tables = new Set();
  const statement =
    /\b(CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?|DROP\s+TABLE(?:\s+IF\s+EXISTS)?)\s+([a-z_][a-z0-9_]*)|\bALTER\s+TABLE\s+([a-z_][a-z0-9_]*)\s+RENAME\s+TO\s+([a-z_][a-z0-9_]*)/gi;
  for (const { sql } of migrations) {
    const code = sql.replace(/--[^\n]*/g, "");
    for (const match of code.matchAll(statement)) {
      const [, verb = "", name = "", from, to = ""] = match;
      if (from) {
        tables.delete(from);
        tables.add(to);
      } else if (/^CREATE/i.test(verb)) {
        tables.add(name);
      } else {
        tables.delete(name);
      }
    }
  }
  return [...tables];
}

/**
 * @param {string} [root]
 * @param {Rules} [rules]
 * @returns {{ files: number, violations: Violation[] }}
 */
export function findViolations(root = ROOT, rules = { owners: OWNERS, reads: READS, raw: RAW }) {
  const files = visibleFiles(root).filter((f) => f.startsWith(SRC) && /\.[cm]?[jt]s$/.test(f));
  const violations = files.flatMap((file) =>
    findInSource(file, readFileSync(join(root, file), "utf8"), rules),
  );
  const migrations = readdirSync(join(root, MIGRATIONS))
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(root, MIGRATIONS, name), "utf8") }));
  for (const table of liveTables(migrations)) {
    if (!Object.hasOwn(rules.owners, table)) {
      violations.push({
        file: MIGRATIONS,
        line: 1,
        rule: "unowned-table",
        message: `${table} has no owner; add it to OWNERS in tooling/module-guard.mjs`,
      });
    }
  }
  const modules = new Set(files.map(moduleOf).filter(Boolean));
  for (const r of rules.reads) {
    if (!modules.has(r.module) || !Object.hasOwn(rules.owners, r.table)) {
      violations.push({
        file: "tooling/module-guard.mjs",
        line: 1,
        rule: "stale-read",
        message: `READS names ${r.module} reading ${r.table}, and one of them no longer exists`,
      });
    }
  }
  return { files: files.length, violations };
}

function main() {
  const { files, violations } = findViolations();
  if (violations.length === 0) {
    console.log(`✓ module boundaries intact in ${files} file(s) under ${SRC}`);
    return;
  }
  for (const v of violations) {
    console.error(`::error file=${v.file},line=${v.line}::${v.rule}: ${v.message}`);
  }
  console.error(`
${violations.length} module boundary violation(s). A module is imported
through its index.ts, writes only the tables it owns, and reads another's
only where tooling/module-guard.mjs READS says why, and reads a table RAW
names through its view. Shared code under ${SRC} touches no table.`);
  process.exit(1);
}

if (import.meta.main) main();
