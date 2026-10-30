// The feed of decision 0116 measured at its stated size (issue #373): friendships,
// walls and the adaptive window, for a heavy, a median and a light viewer.
//
//   pnpm --filter spjall-spike-d1-workload measure:feed            # prints the results
//   pnpm --filter spjall-spike-d1-workload measure:feed --write    # and puts them in docs/d1-social-workload.md
//   pnpm --filter spjall-spike-d1-workload measure:feed --accounts 10000   # a smaller seed
//
// The engine is the one measure.ts uses: a local D1 in workerd (wrangler's
// getPlatformProxy), so rows read is D1's own `rows_read` and milliseconds are D1's
// `sql_duration_ms` (SQLite, no network). The database lives under
// $HOME/.cache/spjall-spike, not in git, and is deleted when the run ends.
//
// The schema is the real one where a migration holds it (post_index and its two indexes,
// blocks, community_members) and the one the records name where none does yet
// (friendships and person_snoozes 0114, walls and post_index.audience 0115).

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getPlatformProxy } from "wrangler";
import { ID_DIGITS, NOW } from "./model.ts";

type Db = D1Database;
type Sample = { sqlMs: number; rowsRead: number; rows: number };

const DEFAULT_ACCOUNTS = 100_000;
const ACCOUNTS_PER_COMMUNITY = 50;
const MEMBERSHIPS_PER_ACCOUNT = 8;
const FRIENDS_PER_ACCOUNT = 50;
const POSTS_PER_ACCOUNT_PER_DAY = 0.2;
const COMMUNITY_POST_SHARE = 0.7;
/** The longest window the feed ever reads, so the seed holds exactly that much. */
const SEED_DAYS = 30;
const DAY_MS = 86_400_000;
const PAGE = 30;
/** Windows of 0116, and the statements one request may spend on them. */
const WINDOWS_DAYS = [1, 4, 16, 30] as const;
const STATEMENTS_PER_REQUEST = 3;
const REPEATS = 20;

/**
 * The three viewers, whose sources are set exactly and not left to the random seed.
 * Friends are accounts from `friendsFrom`, communities are `c1…cN` from `communitiesFrom`.
 */
const VIEWERS = [
  { name: "heavy", account: 1, friends: 500, communities: 50, snoozes: 5, blocks: 5 },
  { name: "median", account: 2, friends: 50, communities: 8, snoozes: 1, blocks: 1 },
  { name: "light", account: 3, friends: 3, communities: 0, snoozes: 0, blocks: 0 },
] as const;
/** Account numbers the viewers' friends, snoozed and blocked accounts are drawn from. */
const friendsFrom = (account: number) => 1_000 * account;
const BLOCKS_FROM = 9_000;
const MIN_ACCOUNTS = 10_000;

const id = (prefix: string, n: string | number) => `printf('${prefix}%0${ID_DIGITS}d', ${n})`;
const below = (n: number | string) => `(abs(random()) % (${n}))`;
const seq = (n: number) =>
  `WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < ${n})`;
const idOf = (prefix: string, n: number) => `${prefix}${String(n).padStart(ID_DIGITS, "0")}`;

const SCHEMA = [
  `CREATE TABLE accounts (account_id TEXT PRIMARY KEY, created_at INTEGER NOT NULL) STRICT`,
  // kind and deleted_at stand for 0115's column and the live_communities view.
  `CREATE TABLE communities (community_id TEXT PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'community',
     deleted_at INTEGER) STRICT`,
  `CREATE TABLE community_members (
     community_id TEXT NOT NULL REFERENCES communities (community_id),
     account_id TEXT NOT NULL REFERENCES accounts (account_id),
     PRIMARY KEY (community_id, account_id)) STRICT`,
  `CREATE INDEX community_members_by_account ON community_members (account_id)`,
  // 0114: two directed rows per friendship.
  `CREATE TABLE friendships (
     account_id TEXT NOT NULL REFERENCES accounts (account_id),
     friend_id TEXT NOT NULL REFERENCES accounts (account_id),
     since INTEGER NOT NULL,
     PRIMARY KEY (account_id, friend_id)) STRICT, WITHOUT ROWID`,
  // 0115.
  `CREATE TABLE walls (account_id TEXT PRIMARY KEY REFERENCES accounts (account_id),
     community_id TEXT NOT NULL REFERENCES communities (community_id)) STRICT`,
  // 0114.
  `CREATE TABLE person_snoozes (
     account_id TEXT NOT NULL REFERENCES accounts (account_id),
     target_id TEXT NOT NULL REFERENCES accounts (account_id),
     until INTEGER NOT NULL,
     PRIMARY KEY (account_id, target_id)) STRICT`,
  `CREATE TABLE blocks (
     blocker_account_id TEXT NOT NULL REFERENCES accounts (account_id),
     blocked_account_id TEXT NOT NULL REFERENCES accounts (account_id),
     created_at INTEGER NOT NULL,
     PRIMARY KEY (blocker_account_id, blocked_account_id)) STRICT`,
  `CREATE INDEX blocks_by_blocked ON blocks (blocked_account_id)`,
  // backend/migrations/0015_social.sql plus 0115's audience column.
  `CREATE TABLE post_index (
     post_id TEXT PRIMARY KEY,
     community_id TEXT NOT NULL REFERENCES communities (community_id),
     author_id TEXT NOT NULL REFERENCES accounts (account_id),
     created_at INTEGER NOT NULL,
     state TEXT NOT NULL DEFAULT 'visible' CHECK (state IN ('visible', 'hidden', 'removed')),
     audience TEXT) STRICT`,
  `CREATE INDEX posts_by_community ON post_index (community_id, created_at)`,
  `CREATE INDEX posts_by_author ON post_index (author_id)`,
];

/** The three sources of 0116 in one window: `?1` viewer, `?2` before, `?3` width in ms, `?4` now. */
const FEED = `
SELECT p.post_id, p.community_id, p.author_id, p.created_at FROM (
    SELECT m.community_id FROM community_members m
      JOIN communities c ON c.community_id = m.community_id AND c.deleted_at IS NULL AND c.kind = 'community'
     WHERE m.account_id = ?1
    UNION ALL
    SELECT w.community_id FROM friendships f JOIN walls w ON w.account_id = f.friend_id
     WHERE f.account_id = ?1
    UNION ALL
    SELECT w.community_id FROM walls w WHERE w.account_id = ?1
  ) s
  JOIN post_index p ON p.community_id = s.community_id
   AND p.created_at < ?2 AND p.created_at >= ?2 - ?3
 WHERE p.state = 'visible'
   AND NOT EXISTS (SELECT 1 FROM blocks
        WHERE (blocker_account_id = ?1 AND blocked_account_id = p.author_id)
           OR (blocker_account_id = p.author_id AND blocked_account_id = ?1))
   AND NOT EXISTS (SELECT 1 FROM person_snoozes z
        WHERE z.account_id = ?1 AND z.target_id = p.author_id AND z.until > ?4)
 ORDER BY p.created_at DESC, p.post_id DESC LIMIT ${PAGE + 1}`;

const fmt = (n: number, digits = 0) =>
  n.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
const sqlMs = (meta: D1Meta) => meta.timings?.sql_duration_ms ?? meta.duration;

async function seed(db: Db, accounts: number) {
  const communities = Math.max(1, Math.round(accounts / ACCOUNTS_PER_COMMUNITY));
  const perDay = accounts * POSTS_PER_ACCOUNT_PER_DAY;
  const communityPosts = Math.round(perDay * COMMUNITY_POST_SHARE * SEED_DAYS);
  const wallPosts = Math.round(perDay * (1 - COMMUNITY_POST_SHARE) * SEED_DAYS);
  const time = `${NOW} - ${below(SEED_DAYS * DAY_MS)}`;
  const step = async (what: string, sql: string) => {
    const started = performance.now();
    await db.prepare(sql).run();
    process.stderr.write(`seeded ${what} in ${fmt((performance.now() - started) / 1000, 1)} s\n`);
  };
  await step(
    "accounts",
    `INSERT INTO accounts ${seq(accounts)} SELECT ${id("a", "n")}, ${time} FROM seq`,
  );
  await step(
    "communities",
    `INSERT INTO communities ${seq(communities)} SELECT ${id("c", "n")}, 'community', NULL FROM seq`,
  );
  await step(
    "wall communities",
    `INSERT INTO communities ${seq(accounts)} SELECT ${id("w", "n")}, 'wall', NULL FROM seq`,
  );
  await step(
    "walls",
    `INSERT INTO walls ${seq(accounts)} SELECT ${id("a", "n")}, ${id("w", "n")} FROM seq`,
  );
  await step(
    "community_members",
    `INSERT OR IGNORE INTO community_members ${seq(accounts * MEMBERSHIPS_PER_ACCOUNT)}
     SELECT ${id("c", `1 + ${below(communities)}`)}, ${id("a", `1 + (n - 1) % ${accounts}`)} FROM seq`,
  );
  // Half as many pairs as friendships per account, each written in both directions, in chunks
  // (one statement of five million rows stops workerd). MATERIALIZED, so both directions agree.
  const pairs = (accounts * FRIENDS_PER_ACCOUNT) / 2;
  const chunk = 25_000;
  const started = performance.now();
  for (let done = 0; done < pairs; done += chunk) {
    const size = Math.min(chunk, pairs - done);
    await db
      .prepare(
        `INSERT OR IGNORE INTO friendships ${seq(size)},
           pairs AS MATERIALIZED (SELECT ${id("a", `1 + (${done} + n - 1) % ${accounts}`)} AS a,
                                         ${id("a", `1 + (${done} + n + ${below(accounts - 1)}) % ${accounts}`)} AS b FROM seq)
         SELECT a, b, ${time} FROM pairs UNION ALL SELECT b, a, ${time} FROM pairs`,
      )
      .run();
  }
  process.stderr.write(`seeded friendships in ${fmt((performance.now() - started) / 1000, 1)} s\n`);
  // Posts in chunks too: the host is shared, and one statement of this size has stopped workerd.
  for (let done = 0; done < communityPosts; done += chunk) {
    const size = Math.min(chunk, communityPosts - done);
    await db
      .prepare(
        `INSERT INTO post_index ${seq(size)}
         SELECT ${id("p", `${done} + n`)}, ${id("c", "1 + c")}, ${id("a", "1 + a")}, ${time}, 'visible', NULL
           FROM (SELECT n, ${below(communities)} AS c, ${below(accounts)} AS a FROM seq)`,
      )
      .run();
  }
  await step(
    "wall post_index",
    `INSERT INTO post_index ${seq(wallPosts)}
     SELECT ${id("p", `${communityPosts} + n`)}, ${id("w", "1 + k")}, ${id("a", "1 + k")}, ${time}, 'visible',
            CASE WHEN ${below(10)} < 8 THEN 'friends' ELSE 'everyone' END
       FROM (SELECT n, ${below(accounts)} AS k FROM seq)`,
  );
  // The three viewers: replace their random sources with exactly the ones named above.
  for (const v of VIEWERS) {
    const me = idOf("a", v.account);
    const first = friendsFrom(v.account);
    await db.batch([
      db.prepare("DELETE FROM friendships WHERE account_id = ?1 OR friend_id = ?1").bind(me),
      db.prepare("DELETE FROM community_members WHERE account_id = ?1").bind(me),
      db
        .prepare(
          `INSERT INTO friendships ${seq(v.friends)}, f AS (SELECT ${id("a", `${first} + n`)} AS f FROM seq)
           SELECT ?1, f, ${NOW} FROM f UNION ALL SELECT f, ?1, ${NOW} FROM f`,
        )
        .bind(me),
      ...(v.communities === 0
        ? []
        : [
            db
              .prepare(
                `INSERT INTO community_members ${seq(v.communities)}
                 SELECT ${id("c", `${v.account * 60} + n`)}, ?1 FROM seq`,
              )
              .bind(me),
          ]),
      ...(v.snoozes === 0
        ? []
        : [
            db
              .prepare(
                `INSERT INTO person_snoozes ${seq(v.snoozes)}
                 SELECT ?1, ${id("a", `${first} + n`)}, ${NOW + DAY_MS} FROM seq`,
              )
              .bind(me),
          ]),
      ...(v.blocks === 0
        ? []
        : [
            db
              .prepare(
                `INSERT INTO blocks ${seq(v.blocks)}
                 SELECT ?1, ${id("a", `${BLOCKS_FROM} + n`)}, ${NOW} FROM seq`,
              )
              .bind(me),
          ]),
    ]);
  }
}

async function counts(db: Db, tables: string[]): Promise<string[]> {
  const out = ["| Table | Rows |", "| --- | ---: |"];
  for (const table of tables) {
    const row = await db.prepare(`SELECT count(*) AS n FROM ${table}`).first<{ n: number }>();
    out.push(`| ${table} | ${fmt(row?.n ?? 0)} |`);
  }
  return out;
}

async function run(db: Db, viewer: string, widthDays: number): Promise<Sample> {
  const { results, meta } = await db
    .prepare(FEED)
    .bind(viewer, NOW, widthDays * DAY_MS, NOW)
    .all();
  return { sqlMs: sqlMs(meta), rowsRead: meta.rows_read, rows: results.length };
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** One viewer's page: widen through the windows until a page fills, `STATEMENTS_PER_REQUEST` to a request. */
async function page(db: Db, viewer: string) {
  const steps: Sample[] = [];
  let widths = 0;
  for (const days of WINDOWS_DAYS) {
    widths = days;
    const sample = await run(db, viewer, days);
    steps.push(sample);
    if (sample.rows > PAGE) break;
  }
  return {
    widthDays: widths,
    statements: steps.length,
    requests: Math.ceil(steps.length / STATEMENTS_PER_REQUEST),
    rowsRead: steps.reduce((s, x) => s + x.rowsRead, 0),
    rows: steps.at(-1)?.rows ?? 0,
    sqlMs: steps.reduce((s, x) => s + x.sqlMs, 0),
  };
}

async function measure(db: Db, accounts: number): Promise<string> {
  const out = [
    `Seed: ${fmt(accounts)} accounts, ${fmt(Math.round(accounts / ACCOUNTS_PER_COMMUNITY))} communities, ` +
      `${SEED_DAYS} days of posts. Engine: local D1 in workerd (\`getPlatformProxy\`), rows read is D1's \`rows_read\`, ` +
      `milliseconds are D1's \`sql_duration_ms\` (SQLite, no network), the mean of ${REPEATS} runs.`,
    "",
    ...(await counts(db, [
      "accounts",
      "communities",
      "community_members",
      "friendships",
      "walls",
      "person_snoozes",
      "blocks",
      "post_index",
    ])),
    "",
    "| Viewer | Friends | Communities | Snoozed | Blocked |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...VIEWERS.map(
      (v) => `| ${v.name} | ${v.friends} | ${v.communities} | ${v.snoozes} | ${v.blocks} |`,
    ),
    "",
    "Every window, alone (a statement reading the whole window, 31 rows at most returned):",
    "",
    "| Viewer | Window | Rows read | ms | Rows returned |",
    "| --- | ---: | ---: | ---: | ---: |",
  ];
  for (const v of VIEWERS) {
    for (const days of WINDOWS_DAYS) {
      const samples: Sample[] = [];
      for (let i = 0; i < REPEATS; i++) samples.push(await run(db, idOf("a", v.account), days));
      out.push(
        `| ${v.name} | ${days} d | ${fmt(samples[0]?.rowsRead ?? 0)} | ${fmt(mean(samples.map((s) => s.sqlMs)), 2)} | ${samples[0]?.rows} |`,
      );
    }
  }
  out.push(
    "",
    `A page, widening from 1 day until it fills (${PAGE} posts and one more), ${STATEMENTS_PER_REQUEST} statements to a request:`,
    "",
    "| Viewer | Window reached | Statements | Requests | Rows read per page | ms per page | Rows returned |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
  );
  for (const v of VIEWERS) {
    const pages = [];
    for (let i = 0; i < REPEATS; i++) pages.push(await page(db, idOf("a", v.account)));
    const first = pages[0];
    if (!first) throw new Error("no page measured");
    out.push(
      `| ${v.name} | ${first.widthDays} d | ${first.statements} | ${first.requests} | ${fmt(first.rowsRead)} | ${fmt(mean(pages.map((p) => p.sqlMs)), 2)} | ${first.rows} |`,
    );
  }
  const plan = await db
    .prepare(`EXPLAIN QUERY PLAN ${FEED}`)
    .bind(idOf("a", 1), NOW, DAY_MS, NOW)
    .all<{ detail: string }>();
  out.push("", "Query plan, heavy viewer, one window:", "", "```text");
  for (const r of plan.results) out.push(r.detail);
  out.push("```");
  return out.join("\n");
}

async function main(accounts: number): Promise<string> {
  const cache = join(homedir(), ".cache", "spjall-spike");
  mkdirSync(cache, { recursive: true });
  const dir = mkdtempSync(join(cache, "feed-"));
  writeFileSync(
    join(dir, "wrangler.json"),
    JSON.stringify({
      name: "d1-feed",
      compatibility_date: "2026-09-01",
      d1_databases: [
        {
          binding: "DB",
          database_name: "feed",
          database_id: "00000000-0000-4000-8000-000000000000",
        },
      ],
    }),
  );
  const proxy = await getPlatformProxy<{ DB: Db }>({
    configPath: join(dir, "wrangler.json"),
    persist: { path: join(dir, "state") },
  });
  try {
    const db = proxy.env.DB;
    for (const sql of SCHEMA) await db.exec(sql.replace(/\s*\n\s*/g, " "));
    await seed(db, accounts);
    return await measure(db, accounts);
  } finally {
    await proxy.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
}

const START = "<!-- feed:start -->";
const END = "<!-- feed:end -->";

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
  const accounts = at === -1 ? DEFAULT_ACCOUNTS : Number(args[at + 1]);
  if (!Number.isInteger(accounts) || accounts < MIN_ACCOUNTS) {
    console.error(`--accounts takes a whole number of at least ${fmt(MIN_ACCOUNTS)}`);
    process.exit(2);
  }
  // workerd on a shared host sometimes dies mid-seed ("fetch failed", no message of its own):
  // start again from an empty database rather than report a half-seeded one.
  let results = "";
  for (let attempt = 1; ; attempt++) {
    try {
      results = await main(accounts);
      break;
    } catch (error) {
      if (attempt === 3 || !(error instanceof TypeError)) throw error;
      process.stderr.write(`attempt ${attempt} lost its database connection, starting again\n`);
    }
  }
  process.stdout.write(`${results}\n`);
  if (args.includes("--write"))
    writeInto(new URL("../../docs/d1-social-workload.md", import.meta.url).pathname, results);
}
