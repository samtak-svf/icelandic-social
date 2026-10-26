// @ts-check
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  findInSource,
  findViolations,
  liveTables,
  moduleOf,
  OWNERS,
  RAW,
  READS,
} from "../module-guard.mjs";
import { ROOT } from "../lib/repo.mjs";
import { copyRepo, initRepo } from "./helpers.mjs";

const RULES = {
  owners: { accounts: "identity", media: "messaging" },
  reads: [{ module: "profiles", table: "accounts" }],
};
const rules = (/** @type {string} */ file, /** @type {string} */ source) =>
  findInSource(file, source, RULES).map((v) => `${v.rule}:${v.line}`);

const PROFILES = "backend/src/modules/profiles/photos.ts";

describe("module-guard", () => {
  it("passes on the repo as it is", () => {
    expect(findViolations().violations).toEqual([]);
  });

  it("knows a file's module", () => {
    expect(moduleOf("backend/src/identity/accounts.ts")).toBe("identity");
    expect(moduleOf("backend/src/modules/messaging/do/inbox.ts")).toBe("messaging");
    expect(moduleOf("backend/src/app.ts")).toBeNull();
    expect(moduleOf("backend/src/env/index.ts")).toBeNull();
  });

  it("fails on a deep import into another module, from a module or shared code", () => {
    expect(rules(PROFILES, 'import { putMedia } from "../messaging/media.ts";')).toEqual([
      "deep-import:1",
    ]);
    expect(rules("backend/src/app.ts", '\nimport { me } from "./identity/accounts.ts";')).toEqual([
      "deep-import:2",
    ]);
    expect(rules("backend/src/app.ts", 'export { me } from "./identity/accounts.ts";')).toEqual([
      "deep-import:1",
    ]);
    expect(
      rules("backend/src/app.ts", 'const m = await import("./identity/accounts.ts");'),
    ).toEqual(["deep-import:1"]);
    expect(rules(PROFILES, 'import {\n  a,\n  b,\n} from "../../identity/blocks.ts";')).toEqual([
      "deep-import:1",
    ]);
  });

  it("fails on an import of the composition root, except from the entries that compose it", () => {
    const app = 'import type { AppEnv } from "../../app.ts";';
    expect(rules(PROFILES, app)).toEqual(["app-import:1"]);
    expect(rules("backend/src/errors.ts", 'import type { AppEnv } from "./app.ts";')).toEqual([
      "app-import:1",
    ]);
    expect(rules("backend/src/api/health.ts", 'export type { AppEnv } from "../app.ts";')).toEqual([
      "app-import:1",
    ]);
    expect(rules(PROFILES, 'import type { AppEnv } from "../../http.ts";')).toEqual([]);
    expect(rules("backend/src/worker.ts", 'import { createApp } from "./app.ts";')).toEqual([]);
    expect(rules("backend/src/index.ts", 'import { createApp } from "./app.ts";')).toEqual([]);
  });

  it("passes an import through an entry, and any import inside a module", () => {
    expect(rules(PROFILES, 'import { block } from "../../identity/index.ts";')).toEqual([]);
    expect(
      rules("backend/src/index.ts", 'export { Inbox } from "./modules/messaging/objects.ts";'),
    ).toEqual([]);
    expect(rules(PROFILES, 'import { profile } from "./profiles.ts";')).toEqual([]);
    expect(rules(PROFILES, 'import { log } from "../../log.ts";')).toEqual([]);
  });

  it("ignores an import a comment or a string names", () => {
    expect(rules(PROFILES, '// import { x } from "../messaging/media.ts";')).toEqual([]);
    expect(rules(PROFILES, "const s = 'import { x } from \"../messaging/media.ts\"';")).toEqual([]);
  });

  it("fails on a write to another module's table", () => {
    for (const sql of [
      "UPDATE accounts SET photo_version = ?",
      "UPDATE OR IGNORE accounts SET x = 1",
      "INSERT INTO accounts (account_id) VALUES (?)",
      "INSERT OR REPLACE INTO accounts VALUES (?)",
      "DELETE FROM accounts WHERE account_id = ?",
    ]) {
      expect(rules(PROFILES, `db.prepare("${sql}");`), sql).toEqual(["foreign-write:1"]);
    }
    expect(rules(PROFILES, "\ndb.prepare(`\n  DELETE FROM media WHERE x = ${y}`);")).toEqual([
      "foreign-write:3",
    ]);
  });

  it("passes a write to the module's own table", () => {
    expect(rules("backend/src/identity/accounts.ts", '"DELETE FROM accounts WHERE a = ?"')).toEqual(
      [],
    );
    expect(
      rules("backend/src/modules/messaging/media.ts", '"INSERT INTO media VALUES (?)"'),
    ).toEqual([]);
  });

  it("fails on a read of another module's table unless READS names it", () => {
    expect(rules(PROFILES, '"SELECT 1 FROM accounts WHERE a = ?"')).toEqual([]);
    expect(rules(PROFILES, '"SELECT 1 FROM media m JOIN accounts a"')).toEqual(["foreign-read:1"]);
    expect(
      rules("backend/src/modules/messaging/rosters.ts", '"SELECT * FROM x JOIN accounts a"'),
    ).toEqual(["foreign-read:1"]);
  });

  it("fails on a bare read of a table RAW names, outside the files it names", () => {
    const raw = {
      accounts: { view: "live_accounts", files: ["backend/src/identity/accounts.ts"] },
    };
    const found = (/** @type {string} */ file, /** @type {string} */ source) =>
      findInSource(file, source, { ...RULES, raw }).map((v) => `${v.rule}:${v.line}`);
    expect(found(PROFILES, '"SELECT 1 FROM accounts a"')).toEqual(["raw-read:1"]);
    expect(found(PROFILES, '"SELECT 1 FROM media m JOIN accounts a"')).toEqual([
      "foreign-read:1",
      "raw-read:1",
    ]);
    expect(found("backend/src/identity/accounts.ts", '"SELECT 1 FROM accounts"')).toEqual([]);
    expect(found("backend/src/identity/sessions.ts", '"SELECT 1 FROM accounts"')).toEqual([
      "raw-read:1",
    ]);
    expect(found(PROFILES, '"SELECT 1 FROM live_accounts a"')).toEqual([]);
    // A delete writes the table; the write rule decides it.
    expect(found("backend/src/identity/sessions.ts", '"DELETE FROM accounts"')).toEqual([]);
  });

  it("names only files that exist in RAW, each reading its table bare", () => {
    for (const { files } of Object.values(RAW)) {
      for (const file of files) expect(existsSync(join(ROOT, file)), file).toBe(true);
    }
  });

  it("fails on shared code that touches a table", () => {
    expect(rules("backend/src/app.ts", '"SELECT 1 FROM accounts"')).toEqual(["outside-module:1"]);
    expect(rules("backend/src/app.ts", '"DELETE FROM media"')).toEqual(["outside-module:1"]);
  });

  it("ignores SQL in comments, prose and tables it does not know", () => {
    expect(rules(PROFILES, "// UPDATE accounts SET x = 1")).toEqual([]);
    expect(rules(PROFILES, 'log("removed from accounts")')).toEqual([]);
    expect(rules(PROFILES, '"DELETE FROM roster WHERE x = 1"')).toEqual([]);
  });

  it("follows the migrations: created, dropped and renamed tables", () => {
    expect(
      liveTables([
        { name: "0001.sql", sql: "CREATE TABLE a (x);\nCREATE TABLE IF NOT EXISTS b (x);" },
        { name: "0002.sql", sql: "-- CREATE TABLE ghost (x);\nDROP TABLE IF EXISTS a;" },
        { name: "0003.sql", sql: "ALTER TABLE b RENAME TO c;" },
      ]),
    ).toEqual(["c"]);
  });

  it("owns exactly the tables the migrations leave", () => {
    const root = copyRepo(["backend/migrations"]);
    initRepo(root);
    expect(findViolations(root, { owners: OWNERS, reads: [] }).violations).toEqual([]);
    const extra = join(root, "backend/migrations/9999_extra.sql");
    writeFileSync(extra, "CREATE TABLE bulletins (bulletin_id TEXT PRIMARY KEY);\n");
    expect(
      findViolations(root, { owners: OWNERS, reads: [] }).violations.map(
        (v) => `${v.rule}:${v.message}`,
      ),
    ).toEqual([
      `unowned-table:bulletins has no owner; add it to OWNERS in tooling/module-guard.mjs`,
    ]);
  });

  it("needs every read it allows, and names only tables that exist", () => {
    for (const read of READS) {
      const reads = READS.filter((r) => r !== read);
      const found = findViolations(undefined, { owners: OWNERS, reads }).violations;
      expect(
        found.some(
          (v) =>
            v.rule === "foreign-read" &&
            v.message.startsWith(`${read.module} reads ${read.table},`),
        ),
        `${read.module} reading ${read.table} is unused`,
      ).toBe(true);
    }
    const stale = [...READS, { module: "news", table: "accounts" }];
    expect(
      findViolations(undefined, { owners: OWNERS, reads: stale }).violations.map((v) => v.rule),
    ).toEqual(["stale-read"]);
  });

  it("scans the files of a checkout, in its own modules", () => {
    const root = copyRepo(["backend/migrations"]);
    const file = join(root, PROFILES);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(
      file,
      'import { putMedia } from "../messaging/media.ts";\nconst s = "UPDATE devices SET x = 1";\n',
    );
    initRepo(root);
    expect(
      findViolations(root, { owners: OWNERS, reads: [] }).violations.map(
        (v) => `${v.rule}:${v.line}`,
      ),
    ).toEqual(["deep-import:1", "foreign-write:2"]);
  });
});
