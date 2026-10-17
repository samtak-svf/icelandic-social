// The page side of the measurement. measure.mjs drives it through
// `window.bench`; every call returns plain data.
import {
  committed,
  containsMarker,
  deleteDb,
  done,
  errorText,
  message,
  open,
  openDb,
  seal,
  storeKey,
  unexportable,
} from "./common.js";

/** Store A runs in a worker; one worker per open, ended on close or wipe. */
function worker() {
  const w = new Worker("./a-worker.js", { type: "module" });
  let next = 0;
  /** @type {Map<number, { resolve: (v: unknown) => void, reject: (e: Error) => void }>} */
  const waiting = new Map();
  w.onmessage = (ev) => {
    const p = waiting.get(ev.data.id);
    waiting.delete(ev.data.id);
    if (ev.data.ok) p?.resolve(ev.data.result);
    else p?.reject(new Error(ev.data.error));
  };
  return {
    call(op, args) {
      const id = next++;
      w.postMessage({ id, op, args });
      return new Promise((resolve, reject) => waiting.set(id, { resolve, reject }));
    },
    end: () => w.terminate(),
  };
}

/** @type {ReturnType<typeof worker> | undefined} */ let wa;

const a = {
  async open() {
    const t0 = performance.now();
    wa = worker();
    try {
      const r = await wa.call("open");
      return { ok: true, ...r, workerMs: performance.now() - t0 - r.totalMs };
    } catch (e) {
      wa.end();
      wa = undefined;
      return { ok: false, error: errorText(e), ms: performance.now() - t0 };
    }
  },
  fill: (from, n) => wa.call("fill", { from, n }),
  latest: () => wa.call("latest"),
  count: () => wa.call("count"),
  raw: () => wa.call("raw"),
  async wipe() {
    const r = await wa.call("wipe");
    wa.end();
    wa = undefined;
    return r;
  },
  async close() {
    await wa?.call("close");
    wa?.end();
    wa = undefined;
  },
};

/** Store B: AES-GCM records in IndexedDB "b", the CryptoKey beside them. */
/** @type {IDBDatabase | undefined} */ let bdb;
/** @type {CryptoKey | undefined} */ let bkey;
const enc = new TextEncoder();
const dec = new TextDecoder();

const b = {
  /** @param {{ closeOnVersionChange?: boolean }} [opts] */
  async open(opts = {}) {
    const t0 = performance.now();
    bdb = await openDb("b", ["key", "m"]);
    if (opts.closeOnVersionChange !== false) bdb.onversionchange = () => bdb?.close();
    const t1 = performance.now();
    const k = await storeKey(bdb);
    bkey = k.key;
    const t2 = performance.now();
    return {
      ok: true,
      openMs: t1 - t0,
      keyMs: t2 - t1,
      totalMs: t2 - t0,
      keyCreated: k.created,
      keyUnexportable: await unexportable(bkey),
    };
  },
  async fill(from, n) {
    const t0 = performance.now();
    for (let at = from; at < from + n; at += 500) {
      const ids = Array.from({ length: Math.min(500, from + n - at) }, (_, j) => at + j);
      const boxes = await Promise.all(
        ids.map((i) =>
          seal(
            bkey,
            enc.encode(
              JSON.stringify({ conv: `c${i % 20}`, ts: 1_700_000_000_000 + i, body: message(i) }),
            ),
          ),
        ),
      );
      const tx = bdb.transaction("m", "readwrite");
      const s = tx.objectStore("m");
      ids.forEach((i, j) => s.put(boxes[j], i));
      await committed(tx);
    }
    return { ms: performance.now() - t0 };
  },
  async latest() {
    const t0 = performance.now();
    const boxes = [];
    await new Promise((resolve, reject) => {
      const req = bdb.transaction("m").objectStore("m").openCursor(null, "prev");
      req.onsuccess = () => {
        const c = req.result;
        if (!c || boxes.length === 50) return resolve(undefined);
        boxes.push(c.value);
        c.continue();
      };
      req.onerror = () => reject(req.error);
    });
    const rows = await Promise.all(
      boxes.map(async (box) => JSON.parse(dec.decode(await open(bkey, box)))),
    );
    return { ms: performance.now() - t0, rows: rows.length, first: rows[0]?.body.slice(0, 24) };
  },
  count: () => done(bdb.transaction("m").objectStore("m").count()),
  async raw() {
    const box = await done(bdb.transaction("m").objectStore("m").get(0));
    return { marker: containsMarker(box.ct), ctBytes: box.ct.length + box.iv.length };
  },
  async wipe() {
    const t0 = performance.now();
    bdb?.close();
    bdb = undefined;
    bkey = undefined;
    const r = await deleteDb("b");
    return { ms: performance.now() - t0, blocked: r.blocked };
  },
  close() {
    bdb?.close();
    bdb = undefined;
  },
};

/** What the browser says about this origin's storage. */
async function storage() {
  const est = await navigator.storage.estimate();
  return { usage: est.usage, quota: est.quota, details: est.usageDetails ?? null };
}

async function persist() {
  const before = await navigator.storage.persisted();
  const granted = await Promise.race([
    navigator.storage.persist(),
    new Promise((r) => setTimeout(() => r("no answer in 3 s"), 3000)),
  ]);
  return { before, granted, after: await navigator.storage.persisted() };
}

/** What is left: OPFS entries at the root and IndexedDB databases. */
async function leftovers() {
  const opfs = [];
  try {
    const root = await navigator.storage.getDirectory();
    for await (const name of root.keys()) opfs.push(name);
  } catch (e) {
    opfs.push(`(${errorText(e)})`);
  }
  const dbs = indexedDB.databases
    ? (await indexedDB.databases()).map((d) => d.name)
    : ["(databases() missing)"];
  return { opfs, dbs, usage: (await navigator.storage.estimate()).usage };
}

/** Times a deletion of "b" while another tab may hold it, giving up after ms. */
async function deleteB(ms) {
  const t0 = performance.now();
  const r = await Promise.race([
    deleteDb("b"),
    new Promise((resolve) => setTimeout(() => resolve("pending"), ms)),
  ]);
  return { result: r, ms: performance.now() - t0 };
}

/** Unencrypted messages in IndexedDB "control", for the plaintext scan to find. */
async function control(n) {
  const db = await openDb("control", ["m"]);
  const tx = db.transaction("m", "readwrite");
  for (let i = 0; i < n; i++) tx.objectStore("m").put(message(i), i);
  await committed(tx);
  db.close();
}

/**
 * A CryptoKey stored as both stores store theirs, but extractable, so the
 * scan knows its bytes: does the profile hold key material in the clear, and
 * does it outlive deleteDatabase?
 */
async function residue() {
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", key));
  const db = await openDb("residue", ["key"]);
  const tx = db.transaction("key", "readwrite");
  tx.objectStore("key").put(key, "k");
  await committed(tx);
  db.close();
  return [...raw].map((x) => x.toString(16).padStart(2, "0")).join("");
}

const dropResidue = () => deleteDb("residue");

/** Removes A's pool directory and key from the page, not through its worker. */
async function removeA() {
  const t0 = performance.now();
  const key = await Promise.race([
    deleteDb("a-key"),
    new Promise((r) => setTimeout(() => r("pending"), 2000)),
  ]);
  let files = "removed";
  try {
    await (await navigator.storage.getDirectory()).removeEntry(".a-pool", { recursive: true });
  } catch (e) {
    files = errorText(e);
  }
  return { key, files, ms: performance.now() - t0 };
}

window.bench = {
  a,
  b,
  storage,
  persist,
  leftovers,
  deleteB,
  removeA,
  control,
  residue,
  dropResidue,
  userAgent: navigator.userAgent,
};
window.benchReady = true;
