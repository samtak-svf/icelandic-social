// Drives page/ in Chromium, Firefox and WebKit with Playwright and records
// both stores: size, reload and restart, cold start, a second tab, wipe and
// Clear-Site-Data. Each run uses a fresh profile; results land in results/.
//
//   node measure.mjs [--browsers chromium,firefox,webkit] [--runs 3] [--n 10000]
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { parseArgs } from "node:util";
import { chromium, firefox, webkit } from "playwright";
import { serve } from "./server.mjs";

const { values } = parseArgs({
  options: {
    browsers: { type: "string", default: "chromium,firefox,webkit" },
    runs: { type: "string", default: "3" },
    n: { type: "string", default: "10000" },
    port: { type: "string", default: "8797" },
    keep: { type: "boolean", default: false },
    profiles: { type: "string" },
  },
});
const N = Number(values.n);
const MARKER = "PLAINTEXT-MARKER"; // as page/common.js writes it into every message
const ENGINES = { chromium, firefox, webkit };

// Where each engine keeps an origin's IndexedDB and OPFS inside a profile:
// Chromium Default/{File System,IndexedDB,WebStorage}, Firefox
// storage/default/<origin>, WebKit storage/<salted origin>/<same>/{FileSystem,IndexedDB}.
const ORIGIN_STORAGE =
  /^(Default\/(File System|IndexedDB|WebStorage)\/|storage\/default\/http\+\+\+|storage\/[^/]+\/[^/]+\/(FileSystem|IndexedDB)\/)/;

/** The files of this profile's origin storage. */
function originFiles(profile) {
  return readdirSync(profile, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath, e.name))
    .filter((f) => ORIGIN_STORAGE.test(relative(profile, f)));
}

/**
 * Bytes the origin's storage takes on disk (allocated blocks), and the files
 * in it that hold a message in the clear.
 */
function disk(profile) {
  const files = originFiles(profile);
  const bytes = files.reduce((n, f) => n + statSync(f).blocks * 512, 0);
  const plaintext = files
    .filter((f) => readFileSync(f).includes(MARKER))
    .map((f) => relative(profile, f));
  return { bytes, files: files.length, plaintext };
}

/** A fresh tab on the bench page in this context. */
async function tab(ctx, origin, path = "/") {
  const page = await ctx.newPage();
  await page.goto(origin + path);
  await page.waitForFunction(() => window.benchReady === true);
  return page;
}

const call = (page, fn, ...args) =>
  page.evaluate(([f, a]) => f.split(".").reduce((o, k) => o[k], window.bench)(...a), [fn, args]);

/**
 * Opens A, retrying while another (closing) tab still holds its handles:
 * how long a closed tab's lock outlives it.
 */
async function openA(page) {
  const t0 = Date.now();
  for (let attempts = 1; ; attempts++) {
    const r = await call(page, "a.open");
    if (r.ok) return { attempts, waitedMs: Date.now() - t0, orphan: r.orphan };
    if (Date.now() - t0 > 10_000) throw new Error(`a.open: ${r.error}`);
    await page.waitForTimeout(100);
  }
}

/** Opens the profile, runs the body on a first tab, closes it. */
async function session(engine, profile, origin, body) {
  const ctx = await engine.launchPersistentContext(profile, { headless: true });
  try {
    return await body(ctx, await tab(ctx, origin));
  } finally {
    await ctx.close();
  }
}

/** Store A fill, then a check that the file on disk is ciphertext. */
async function fillA(page) {
  const before = await call(page, "storage");
  const open = await call(page, "a.open");
  if (!open.ok) return { open };
  const fill = await call(page, "a.fill", 0, N);
  const raw = await call(page, "a.raw");
  return {
    open,
    fill,
    raw,
    count: await call(page, "a.count"),
    usage: (await call(page, "storage")).usage - before.usage,
  };
}

async function fillB(page) {
  const before = await call(page, "storage");
  const open = await call(page, "b.open");
  const fill = await call(page, "b.fill", 0, N);
  const raw = await call(page, "b.raw");
  return {
    open,
    fill,
    raw,
    count: await call(page, "b.count"),
    usage: (await call(page, "storage")).usage - before.usage,
  };
}

/** After a browser restart: open and the first 50 rows, as a user sees it. */
async function cold(page, store) {
  const t0 = Date.now();
  const open = await call(page, `${store}.open`);
  if (!open.ok) return { open };
  const latest = await call(page, `${store}.latest`);
  return { open, latest, wallMs: Date.now() - t0, count: await call(page, `${store}.count`) };
}

/** Reload the tab and count again. */
async function reload(page, store) {
  await page.reload();
  await page.waitForFunction(() => window.benchReady === true);
  const open = await call(page, `${store}.open`);
  return open.ok ? await call(page, `${store}.count`) : open;
}

/** A second tab opens each store while the first holds it. */
async function secondTab(ctx, origin, first) {
  const second = await tab(ctx, origin);
  const a = { second: await call(second, "a.open") };
  if (a.second.ok) a.second.count = await call(second, "a.count");
  a.countInFirst = await call(first, "a.count").catch((e) => String(e));
  await call(second, "b.open");
  await call(second, "b.fill", N, 1);
  const b = {
    countInFirst: await call(first, "b.count"),
    countInSecond: await call(second, "b.count"),
  };
  await call(second, "a.close");
  await call(second, "b.close");
  await second.close();
  return { a, b };
}

/**
 * Wipes while another tab holds the store: A's files from the page (the
 * holder keeps its sync access handles), B while the holder ignores
 * versionchange.
 */
async function blockedWipe(ctx, origin, first) {
  await openA(first);
  await call(first, "a.fill", 0, 100);
  await call(first, "a.close");
  const holderA = await tab(ctx, origin);
  await call(holderA, "a.open");
  const aWhileHeld = await call(first, "removeA");
  await holderA.close();
  const released = await openA(first);
  await call(first, "a.close");
  const aAfter = { released, ...(await call(first, "removeA")) };
  await call(first, "b.open");
  await call(first, "b.fill", 0, 100);
  await call(first, "b.close");
  const holder = await tab(ctx, origin);
  await call(holder, "b.open", { closeOnVersionChange: false });
  const whileHeld = await call(first, "deleteB", 2000);
  await holder.close();
  const after = await call(first, "deleteB", 5000);
  return {
    a: { whileHeld: aWhileHeld, afterHolderClosed: aAfter },
    b: { whileHeld, afterHolderClosed: after },
    left: await call(first, "leftovers"),
  };
}

/** Both stores with a little data, then the server's Clear-Site-Data. */
async function clearSiteData(ctx, origin, first, probe) {
  await openA(first);
  await call(first, "a.fill", 0, 100);
  await call(first, "a.close");
  await call(first, "b.open");
  await call(first, "b.fill", 0, 100);
  await call(first, "b.close");
  const before = await call(first, "leftovers");
  const t0 = Date.now();
  await first.goto(`${origin}/clear`);
  const ms = Date.now() - t0;
  const onDisk = probe();
  const page = await tab(ctx, origin);
  const after = await call(page, "leftovers");
  const a = await call(page, "a.open");
  const b = await call(page, "b.open");
  return {
    before,
    ms,
    onDisk,
    after,
    a: a.ok ? { keyCreated: a.keyCreated, count: await call(page, "a.count") } : a,
    b: { keyCreated: b.keyCreated, count: await call(page, "b.count") },
  };
}

async function wipes(ctx, origin, page) {
  await call(page, "a.open");
  const a = await call(page, "a.wipe");
  await call(page, "b.open");
  const b = await call(page, "b.wipe");
  return { a, b, left: await call(page, "leftovers") };
}

/** Files of the origin's storage that contain these bytes. */
function holding(profile, bytes) {
  return originFiles(profile)
    .filter((f) => readFileSync(f).includes(bytes))
    .map((f) => relative(profile, f));
}

/**
 * Whether a stored CryptoKey's raw bytes sit in the profile, and whether they
 * are still there after deleteDatabase and a browser restart.
 */
async function keyResidue(engine, profile, origin) {
  const hex = await session(engine, profile, origin, (_ctx, page) => call(page, "residue"));
  const bytes = Buffer.from(hex, "hex");
  const stored = holding(profile, bytes);
  await session(engine, profile, origin, (_ctx, page) => call(page, "dropResidue"));
  const afterDelete = holding(profile, bytes);
  await session(engine, profile, origin, (_ctx, page) => page.waitForTimeout(3000));
  const afterRestart = holding(profile, bytes);
  // The same with the server's Clear-Site-Data in place of deleteDatabase.
  const hex2 = await session(engine, profile, origin, (_ctx, page) => call(page, "residue"));
  await session(engine, profile, origin, (_ctx, page) => page.goto(`${origin}/clear`));
  const afterClear = holding(profile, Buffer.from(hex2, "hex"));
  return { stored, afterDelete, afterRestart, afterClear };
}

async function run(name, origin) {
  const profile = mkdtempSync(join(values.profiles ?? tmpdir(), `bs-${name}-`));
  const engine = ENGINES[name];
  const r = { browser: name };
  try {
    await session(engine, profile, origin, async (_ctx, page) => {
      r.userAgent = await page.evaluate(() => window.bench.userAgent);
      r.persist = await call(page, "persist");
      r.storage = await call(page, "storage");
    });
    const disk0 = disk(profile);
    r.a = await session(engine, profile, origin, (_ctx, page) => fillA(page));
    const disk1 = disk(profile);
    await session(engine, profile, origin, async (_ctx, page) => {
      r.coldA = await cold(page, "a");
      await call(page, "a.close");
      r.b = await fillB(page);
      await call(page, "b.close");
    });
    const disk2 = disk(profile);
    r.disk = {
      a: disk1.bytes - disk0.bytes,
      b: disk2.bytes - disk1.bytes,
      plaintext: [...disk1.plaintext, ...disk2.plaintext],
      files: [disk0.files, disk1.files, disk2.files],
    };
    await session(engine, profile, origin, async (ctx, page) => {
      r.coldB = await cold(page, "b");
      r.reload = { a: await reload(page, "a"), b: await reload(page, "b") };
      await call(page, "a.open");
      r.secondTab = await secondTab(ctx, origin, page);
      await call(page, "a.close");
      await call(page, "b.close");
      r.wipe = await wipes(ctx, origin, page);
    });
    r.wipe.disk = disk(profile);
    await session(engine, profile, origin, async (ctx, page) => {
      r.blockedWipe = await blockedWipe(ctx, origin, page);
      r.clearSiteData = await clearSiteData(ctx, origin, page, () => disk(profile));
    });
    // The control: unencrypted messages in IndexedDB, which the scan must find.
    await session(engine, profile, origin, (_ctx, page) => call(page, "control", 100));
    r.control = disk(profile).plaintext;
    r.keyResidue = await keyResidue(engine, profile, origin);
  } catch (e) {
    r.error = e instanceof Error ? e.message : String(e);
  } finally {
    if (values.keep) console.log("kept", profile);
    else rmSync(profile, { recursive: true, force: true });
  }
  return r;
}

const server = await serve(Number(values.port));
const out = join(import.meta.dirname, "results");
mkdirSync(out, { recursive: true });
const all = [];
for (const name of values.browsers.split(",")) {
  for (let i = 1; i <= Number(values.runs); i++) {
    const r = await run(name, server.origin);
    console.log(name, i, r.error ?? "ok");
    all.push({ run: i, ...r });
  }
}
server.close();
writeFileSync(
  join(out, "raw.json"),
  JSON.stringify({ n: N, at: new Date().toISOString(), runs: all }, null, 2) + "\n",
);
console.log("wrote results/raw.json");
