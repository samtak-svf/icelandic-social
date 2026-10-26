// A repeatable measurement of a social workload on D1 (issue #275), for the
// scope and community records (#267, #270): does one database hold it?
//
//   pnpm --filter spjall-spike-d1-workload measure            # prints the results
//   pnpm --filter spjall-spike-d1-workload measure --write    # and puts them in docs/d1-social-workload.md
//   pnpm --filter spjall-spike-d1-workload measure --accounts 2000   # a quicker, smaller seed
//
// It runs against a local D1 in workerd (wrangler's getPlatformProxy), the
// same SQLite build and the same authorizer as `cf dev`, in a throwaway
// directory. The social tables are hypothetical (model.ts): no
// migration holds them, because the records that would shape them are not
// yet accepted. Rows are generated inside SQLite (recursive CTEs), so seeding
// a few million rows does not cross the proxy one at a time.
//
// Runs under plain `node`; a spike package of its own, not part of the Worker (#283).

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPlatformProxy } from "wrangler";
import {
  ACCOUNTS_PER_COMMUNITY,
  ASSUMED_ACCOUNTS,
  ASSUMED_DAYS,
  D1_LIMIT_BYTES,
  DEFAULT_SEED_ACCOUNTS,
  ID_DIGITS,
  NOW,
  POST_CHARS,
  QUERIES,
  SCHEMA,
  type Seed,
  TABLES,
  VIEWERS,
  projectedRows,
  seedFor,
  seedStatements,
} from "./model.ts";

type Db = D1Database;
type Sample = { sqlMs: number; rowsRead: number };
type Community = { community_id: string; members: number };
/** What the reads and writes are aimed at, found in the seeded data. */
type Targets = { viewers: string[]; biggest: Community; median: Community; busyPost: string };

const fmt = (n: number, digits = 0) =>
  n.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
const mib = (bytes: number) => `${fmt(bytes / 1024 ** 2, 1)} MiB`;
const gib = (bytes: number) => `${fmt(bytes / 1024 ** 3, 2)} GiB`;
const sqlMs = (meta: D1Meta) => meta.timings?.sql_duration_ms ?? meta.duration;

async function sizeOf(db: Db): Promise<number> {
  return (await db.prepare("SELECT 1").run()).meta.size_after;
}

async function rowCount(db: Db, table: string): Promise<number> {
  const row = await db.prepare(`SELECT count(*) AS n FROM ${table}`).first<{ n: number }>();
  return row?.n ?? 0;
}

/** D1 refuses more bindings than the query names, so pass only up to its highest `?N`. */
function bindsFor(sql: string, binds: unknown[]): unknown[] {
  const used = [...sql.matchAll(/\?(\d+)/g)].map((m) => Number(m[1]));
  return binds.slice(0, Math.max(0, ...used));
}

async function timed(db: Db, sql: string, binds: unknown[]): Promise<Sample> {
  const { meta } = await db
    .prepare(sql)
    .bind(...bindsFor(sql, binds))
    .all();
  return { sqlMs: sqlMs(meta), rowsRead: meta.rows_read };
}

async function plan(db: Db, sql: string, binds: unknown[]): Promise<string[]> {
  const { results } = await db
    .prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .bind(...bindsFor(sql, binds))
    .all<{ detail: string }>();
  return results.map((r) => `  ${r.detail}`);
}

/** Viewers spread over popular and quiet accounts, the same on every run. */
function viewers(seed: Seed): string[] {
  const step = Math.max(1, Math.floor(seed.accounts / VIEWERS));
  return Array.from(
    { length: VIEWERS },
    (_, i) => `a${String(1 + i * step).padStart(ID_DIGITS, "0")}`,
  );
}

/** Seeds every table and reports its growth, projected to the assumptions. */
async function growth(db: Db, seed: Seed): Promise<string[]> {
  const statements = seedStatements(seed);
  const projected = projectedRows();
  const out = [
    `Seed: ${fmt(seed.accounts)} accounts, ${fmt(seed.communities)} communities, ${seed.days} days. ` +
      `Projection: ${fmt(ASSUMED_ACCOUNTS)} accounts over ${fmt(ASSUMED_DAYS)} days.`,
    "",
    "| Table (with its indexes) | Seed rows | Seed size | Bytes per row | Projected rows | Projected size |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
  ];
  let total = 0;
  for (const table of TABLES) {
    // The database's size before and after the table: its rows and its indexes.
    const before = await sizeOf(db);
    for (const sql of statements[table]) await db.prepare(sql).run();
    const rows = await rowCount(db, table);
    const bytes = (await sizeOf(db)) - before;
    const perRow = rows === 0 ? 0 : bytes / rows;
    const size = perRow * projected[table];
    total += size;
    process.stderr.write(`seeded ${table}: ${fmt(rows)} rows\n`);
    out.push(
      `| ${table} | ${fmt(rows)} | ${mib(bytes)} | ${fmt(perRow)} | ${fmt(projected[table])} | ${gib(size)} |`,
    );
  }
  const perYear = total / (ASSUMED_DAYS / 365);
  out.push(
    `| **Total** | | ${mib(await sizeOf(db))} | | | **${gib(total)}** (${fmt((100 * total) / D1_LIMIT_BYTES, 1)}% of 10 GiB) |`,
    "",
    `At the assumed rates the database grows by about ${gib(perYear)} a year ` +
      `and reaches 10 GiB after about ${fmt(D1_LIMIT_BYTES / perYear, 1)} years.`,
    "",
  );
  return out;
}

async function targets(db: Db, seed: Seed): Promise<Targets> {
  const sizes = `SELECT community_id, count(*) AS members FROM community_members GROUP BY community_id`;
  const biggest = await db.prepare(`${sizes} ORDER BY members DESC LIMIT 1`).first<Community>();
  const median = await db
    .prepare(
      `${sizes} ORDER BY members LIMIT 1
       OFFSET (SELECT count(DISTINCT community_id) FROM community_members) / 2`,
    )
    .first<Community>();
  const busy = await db
    .prepare("SELECT post_id FROM comments GROUP BY post_id ORDER BY count(*) DESC LIMIT 1")
    .first<{ post_id: string }>();
  if (!biggest || !median || !busy) throw new Error("the seed made no communities or comments");
  return { viewers: viewers(seed), biggest, median, busyPost: busy.post_id };
}

type Run = { label: string; sql: string; community: string; plan: boolean };

function runs(t: Targets): Run[] {
  return Object.entries(QUERIES).flatMap(([name, sql]): Run[] =>
    name === "community page"
      ? [
          {
            label: `${name} (biggest community)`,
            sql,
            community: t.biggest.community_id,
            plan: true,
          },
          {
            label: `${name} (median community)`,
            sql,
            community: t.median.community_id,
            plan: false,
          },
        ]
      : [{ label: name, sql, community: "", plan: true }],
  );
}

/** Every read by every sampled viewer, and the first viewer's query plans. */
async function reads(db: Db, t: Targets): Promise<{ table: string[]; plans: string[] }> {
  const table = [
    `Communities: the biggest has ${fmt(t.biggest.members)} members, the median ${fmt(t.median.members)}. ` +
      `Times are SQLite's own (D1's \`sql_duration_ms\`, no network) over ${VIEWERS} viewers.`,
    "",
    "| Read | Median ms | Slowest ms | Median rows read | Most rows read |",
    "| --- | ---: | ---: | ---: | ---: |",
  ];
  const plans: string[] = [];
  let slowest = { label: "", ms: 0 };
  for (const run of runs(t)) {
    const binds = (viewer: string) => [viewer, NOW, run.community, t.busyPost];
    const samples: Sample[] = [];
    for (const viewer of t.viewers) samples.push(await timed(db, run.sql, binds(viewer)));
    const ms = samples.map((s) => s.sqlMs).sort((a, b) => a - b);
    const rows = samples.map((s) => s.rowsRead).sort((a, b) => a - b);
    const mid = Math.floor(samples.length / 2);
    const worst = ms.at(-1) ?? 0;
    if (worst > slowest.ms) slowest = { label: run.label, ms: worst };
    table.push(
      `| ${run.label} | ${fmt(ms[mid] ?? 0, 1)} | ${fmt(worst, 1)} | ${fmt(rows[mid] ?? 0)} | ${fmt(rows.at(-1) ?? 0)} |`,
    );
    if (run.plan)
      plans.push(`${run.label}:`, ...(await plan(db, run.sql, binds(t.viewers[0] ?? ""))));
  }
  table.push("", `Slowest read: ${slowest.label}, ${fmt(slowest.ms, 1)} ms.`, "");
  return { table, plans };
}

/** A burst of posts, one at a time and batched, and a fan-out to members. */
async function writes(db: Db, t: Targets): Promise<string[]> {
  // D1 has one writer, so a burst is serial whatever the callers do.
  const burst = 1_000;
  const author = t.viewers[1] ?? "";
  const post = (i: number) =>
    db
      .prepare("INSERT INTO posts VALUES (?1, ?2, ?3, ?4, ?5)")
      .bind(
        `q${String(i).padStart(ID_DIGITS, "0")}`,
        t.biggest.community_id,
        author,
        "x".repeat(POST_CHARS),
        NOW + i,
      );
  let started = performance.now();
  let serialSql = 0;
  for (let i = 0; i < burst; i++) serialSql += sqlMs((await post(i).run()).meta);
  const serialMs = performance.now() - started;
  started = performance.now();
  const batched = await db.batch(Array.from({ length: burst }, (_, i) => post(burst + i)));
  const batchMs = performance.now() - started;
  const batchSql = batched.reduce((sum, r) => sum + sqlMs(r.meta), 0);

  // Fan-out: one post in a community written as a row per member, against
  // nothing written (members read the community's posts when they look).
  const fanOut = async (c: Community, which: string) => {
    const { meta } = await db
      .prepare(
        `INSERT INTO notifications (account_id, kind, subject_id, actor_account_id, created_at)
         SELECT account_id, 'post', ?2, ?3, ?4 FROM community_members WHERE community_id = ?1`,
      )
      .bind(c.community_id, "q0", author, NOW)
      .run();
    return `| Fan-out of one post to the ${which} community (${fmt(c.members)} members) | ${fmt(meta.rows_written)} | ${fmt(sqlMs(meta), 1)} | |`;
  };
  return [
    "Rows written is D1's own count, which includes index entries.",
    "",
    "| Write | Rows written | SQL ms | Wall ms, through the local proxy |",
    "| --- | ---: | ---: | ---: |",
    `| ${fmt(burst)} posts, one statement each | ${fmt(burst)} | ${fmt(serialSql)} | ${fmt(serialMs)} |`,
    `| ${fmt(burst)} posts in one \`batch\` | ${fmt(burst)} | ${fmt(batchSql)} | ${fmt(batchMs)} |`,
    await fanOut(t.biggest, "biggest"),
    await fanOut(t.median, "median"),
  ];
}

async function measure(accounts: number): Promise<string> {
  const seed = seedFor(accounts);
  const dir = mkdtempSync(join(tmpdir(), "spjall-d1-workload-"));
  writeFileSync(
    join(dir, "wrangler.json"),
    JSON.stringify({
      name: "d1-workload",
      compatibility_date: "2026-09-01",
      d1_databases: [
        {
          binding: "DB",
          database_name: "workload",
          database_id: "00000000-0000-4000-8000-000000000000",
        },
      ],
    }),
  );
  const proxy = await getPlatformProxy<{ DB: Db }>({
    configPath: join(dir, "wrangler.json"),
    persist: { path: join(dir, "state") },
  });
  const db = proxy.env.DB;
  try {
    await db.exec(SCHEMA.replace(/--[^\n]*\n/g, "\n").replace(/\s*\n\s*/g, " "));
    const sized = await growth(db, seed);
    const t = await targets(db, seed);
    const read = await reads(db, t);
    const written = await writes(db, t);
    return [
      ...sized,
      ...read.table,
      ...written,
      "",
      "Query plans, for the first viewer:",
      "",
      "```text",
      ...read.plans,
      "```",
    ].join("\n");
  } finally {
    await proxy.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
}

const START = "<!-- results:start -->";
const END = "<!-- results:end -->";

/** Puts the results between the report's markers. */
function writeInto(file: string, results: string) {
  const text = readFileSync(file, "utf8");
  const from = text.indexOf(START);
  const to = text.indexOf(END);
  if (from === -1 || to < from) throw new Error(`${file} has no ${START} … ${END} block`);
  writeFileSync(file, `${text.slice(0, from + START.length)}\n\n${results}\n\n${text.slice(to)}`);
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const at = args.indexOf("--accounts");
  const accounts = at === -1 ? DEFAULT_SEED_ACCOUNTS : Number(args[at + 1]);
  if (!Number.isInteger(accounts) || accounts < ACCOUNTS_PER_COMMUNITY) {
    console.error(`--accounts takes a whole number of at least ${ACCOUNTS_PER_COMMUNITY}`);
    process.exit(2);
  }
  const results = await measure(accounts);
  process.stdout.write(`${results}\n`);
  if (args.includes("--write"))
    writeInto(new URL("../../docs/d1-social-workload.md", import.meta.url).pathname, results);
}
