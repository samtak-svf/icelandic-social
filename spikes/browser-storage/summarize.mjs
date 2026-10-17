// Prints results/raw.json as ranges (min–max over the runs) per browser,
// the form docs/browser-storage.md reports them in.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const raw = JSON.parse(readFileSync(join(import.meta.dirname, "results", "raw.json"), "utf8"));

/** @type {[string, (r: any) => unknown][]} */
const ROWS = [
  ["A cipher", (r) => r.a.open.cipher],
  ["A fill N (ms)", (r) => r.a.fill?.ms],
  ["B fill N (ms)", (r) => r.b.fill.ms],
  ["A on disk (KiB)", (r) => r.disk.a / 1024],
  ["B on disk (KiB)", (r) => r.disk.b / 1024],
  ["A estimate() (KiB)", (r) => r.a.usage / 1024],
  ["B estimate() (KiB)", (r) => r.b.usage / 1024],
  ["A db file (KiB)", (r) => r.a.raw?.bytes / 1024],
  ["A file plaintext (via VFS)", (r) => r.a.raw?.marker || r.a.raw?.plainHeader],
  ["B record plaintext", (r) => r.b.raw.marker],
  ["profile files with plaintext", (r) => r.disk.plaintext.length],
  ["control: scan finds plain IDB", (r) => r.control.length > 0],
  ["stored CryptoKey bytes on disk", (r) => r.keyResidue.stored.length > 0],
  ["… after deleteDatabase", (r) => r.keyResidue.afterDelete.length > 0],
  ["… after a further restart", (r) => r.keyResidue.afterRestart.length > 0],
  ["… after Clear-Site-Data instead", (r) => r.keyResidue.afterClear.length > 0],
  ["A cold: wasm init (ms)", (r) => r.coldA.open.initMs],
  ["A cold: VFS install (ms)", (r) => r.coldA.open.vfsMs],
  ["A cold: open + key (ms)", (r) => r.coldA.open.openMs + r.coldA.open.keyMs],
  ["A cold: first 50 (ms)", (r) => r.coldA.latest?.ms],
  ["A cold: wall (ms)", (r) => r.coldA.wallMs],
  ["B cold: open + key (ms)", (r) => r.coldB.open.totalMs],
  ["B cold: first 50 (ms)", (r) => r.coldB.latest.ms],
  ["B cold: wall (ms)", (r) => r.coldB.wallMs],
  ["reload count A / B", (r) => `${r.reload.a} / ${r.reload.b}`],
  ["2nd tab opens A", (r) => (r.secondTab.a.second.ok ? "opened" : r.secondTab.a.second.error)],
  [
    "2nd tab A fails after (ms)",
    (r) => (r.secondTab.a.second.ok ? undefined : r.secondTab.a.second.ms),
  ],
  ["1st tab A after 2nd tried", (r) => r.secondTab.a.countInFirst],
  ["2nd tab B write seen in 1st", (r) => r.secondTab.b.countInFirst === raw.n + 1],
  ["wipe A (ms)", (r) => r.wipe.a.filesMs + r.wipe.a.keyMs],
  ["wipe B (ms)", (r) => r.wipe.b.ms],
  ["left after wipe", (r) => JSON.stringify([r.wipe.left.opfs, r.wipe.left.dbs])],
  ["estimate() after wipe (KiB)", (r) => r.wipe.left.usage / 1024],
  ["on disk after wipe (KiB)", (r) => r.wipe.disk.bytes / 1024],
  ["on disk after Clear-Site-Data (KiB)", (r) => r.clearSiteData.onDisk.bytes / 1024],
  ["Clear-Site-Data response (ms)", (r) => r.clearSiteData.ms],
  [
    "after Clear-Site-Data A / B",
    (r) =>
      `${r.clearSiteData.a.count} rows, new key ${r.clearSiteData.a.keyCreated} / ${r.clearSiteData.b.count} rows, new key ${r.clearSiteData.b.keyCreated}`,
  ],
  [
    "wipe A held by tab",
    (r) =>
      `key ${JSON.stringify(r.blockedWipe.a.whileHeld.key)}; files ${r.blockedWipe.a.whileHeld.files}`,
  ],
  ["A lock freed after tab close (ms)", (r) => r.blockedWipe.a.afterHolderClosed.released.waitedMs],
  ["A orphan file dropped", (r) => r.blockedWipe.a.afterHolderClosed.released.orphan],
  ["wipe B held by tab", (r) => JSON.stringify(r.blockedWipe.b.whileHeld.result)],
  ["wipe B after holder closed (ms)", (r) => r.blockedWipe.b.afterHolderClosed.ms],
  ["persist()", (r) => r.persist.granted],
  ["quota (MiB)", (r) => r.storage.quota / 2 ** 20],
  [
    "Clear-Site-Data leaves",
    (r) => JSON.stringify([r.clearSiteData.after.opfs, r.clearSiteData.after.dbs]),
  ],
];

/** @param {unknown[]} xs */
function range(xs) {
  if (xs.every((x) => typeof x === "number")) {
    const ns = /** @type {number[]} */ (xs);
    const lo = Math.min(...ns);
    const hi = Math.max(...ns);
    const f = (/** @type {number} */ n) =>
      n >= 100 || Number.isInteger(n) ? n.toFixed(0) : n.toFixed(1);
    return f(lo) === f(hi) ? f(lo) : `${f(lo)}–${f(hi)}`;
  }
  return [...new Set(xs.map(String))].join(" | ");
}

const browsers = [...new Set(raw.runs.map((/** @type {any} */ r) => r.browser))];
console.log(`N = ${raw.n}, ${raw.runs.length} runs, ${raw.at}\n`);
console.log(`| | ${browsers.join(" | ")} |`);
console.log(`|---|${browsers.map(() => "---").join("|")}|`);
for (const [label, get] of ROWS) {
  const cells = browsers.map((b) => {
    const got = [];
    for (const run of raw.runs.filter((/** @type {any} */ x) => x.browser === b)) {
      try {
        const v = get(run);
        if (v !== undefined && !Number.isNaN(v)) got.push(v);
      } catch {
        // a run that stopped before this step
      }
    }
    return got.length ? range(got) : "n/a";
  });
  console.log(`| ${label} | ${cells.join(" | ")} |`);
}
for (const r of raw.runs.filter((/** @type {any} */ x) => x.error))
  console.log(`\n${r.browser} run ${r.run}: ${r.error}`);
