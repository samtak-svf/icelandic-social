// Store A: sqlite3mc (SQLite3 Multiple Ciphers, its default cipher) on the
// opfs-sahpool VFS, which holds an exclusive sync access handle on each file,
// in a dedicated worker. The database key is 32 random bytes sealed under a
// non-extractable AES-GCM CryptoKey in IndexedDB ("a-key"), unsealed at open.
import sqlite3InitModule from "./vendor/sqlite3.mjs";
import {
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

const POOL_DIR = ".a-pool";
const FILE = "/a.db";

/** @type {any} */ let sqlite3;
/** @type {any} */ let pool;
/** @type {any} */ let db;

async function secret() {
  const kdb = await openDb("a-key", ["key", "secret"]);
  const { key, created } = await storeKey(kdb);
  let box = await done(kdb.transaction("secret").objectStore("secret").get("s"));
  if (!box) {
    box = await seal(key, crypto.getRandomValues(new Uint8Array(32)));
    const tx = kdb.transaction("secret", "readwrite");
    tx.objectStore("secret").put(box, "s");
    await new Promise((r) => (tx.oncomplete = r));
  }
  const raw = await open(key, box);
  const hex = [...raw].map((b) => b.toString(16).padStart(2, "0")).join("");
  kdb.close();
  return { hex, created, unexportable: await unexportable(key) };
}

/** @param {string} hex */
function openFile(hex) {
  db = new sqlite3.oo1.DB({ filename: FILE, vfs: "multipleciphers-opfs-sahpool" });
  db.exec(`PRAGMA hexkey = '${hex}'`);
  db.exec(
    "CREATE TABLE IF NOT EXISTS m (id INTEGER PRIMARY KEY, conv TEXT, ts INTEGER, body TEXT)",
  );
}

const ops = {
  async open() {
    const t0 = performance.now();
    sqlite3 ??= await sqlite3InitModule();
    const t1 = performance.now();
    pool = await sqlite3.installOpfsSAHPoolVfs({ name: "opfs-sahpool", directory: POOL_DIR });
    const t2 = performance.now();
    if (!sqlite3.capi.sqlite3_vfs_find("multipleciphers-opfs-sahpool")) {
      const rc = sqlite3.capi.sqlite3mc_vfs_create("opfs-sahpool", 0);
      if (rc !== 0) throw new Error(`sqlite3mc_vfs_create: ${rc}`);
    }
    const key = await secret();
    const t3 = performance.now();
    let orphan = false;
    try {
      openFile(key.hex);
    } catch (e) {
      // A new key and an old file: a wipe removed the key but not the file
      // (another tab held it). The file is unreadable, so it goes.
      if (!key.created || !errorText(e).includes("SQLITE_NOTADB")) throw e;
      db.close();
      pool.unlink(FILE);
      openFile(key.hex);
      orphan = true;
    }
    const cipher = db.selectValue("PRAGMA cipher");
    const t4 = performance.now();
    return {
      initMs: t1 - t0,
      vfsMs: t2 - t1,
      keyMs: t3 - t2,
      openMs: t4 - t3,
      totalMs: t4 - t0,
      cipher,
      version: sqlite3.capi.sqlite3mc_version(),
      keyCreated: key.created,
      keyUnexportable: key.unexportable,
      orphan,
    };
  },
  async fill({ from, n }) {
    const t0 = performance.now();
    db.transaction(() => {
      const st = db.prepare("INSERT INTO m (id, conv, ts, body) VALUES (?, ?, ?, ?)");
      for (let i = from; i < from + n; i++)
        st.bind([i, `c${i % 20}`, 1_700_000_000_000 + i, message(i)]).stepReset();
      st.finalize();
    });
    return { ms: performance.now() - t0 };
  },
  async latest() {
    const t0 = performance.now();
    const rows = db.selectObjects("SELECT id, conv, ts, body FROM m ORDER BY id DESC LIMIT 50");
    return { ms: performance.now() - t0, rows: rows.length, first: rows[0]?.body.slice(0, 24) };
  },
  async count() {
    return db.selectValue("SELECT count(*) FROM m");
  },
  /** Reads the database file's bytes as stored: encrypted or not. */
  async raw() {
    const bytes = pool.exportFile(FILE);
    const plainHeader = new TextDecoder().decode(bytes.subarray(0, 15)) === "SQLite format 3";
    return {
      bytes: bytes.length,
      plainHeader,
      marker: containsMarker(bytes),
      poolFiles: pool.getFileCount(),
      poolCapacity: pool.getCapacity(),
    };
  },
  /**
   * Revocation: the key database first, so whatever else fails the file is
   * already unreadable, then the pool directory.
   */
  async wipe() {
    const t0 = performance.now();
    db?.close();
    db = undefined;
    const del = await deleteDb("a-key");
    const t1 = performance.now();
    await pool.removeVfs();
    return { keyMs: t1 - t0, filesMs: performance.now() - t1, keyBlocked: del.blocked };
  },
  async close() {
    db?.close();
    db = undefined;
    pool?.pauseVfs();
    return true;
  },
};

self.onmessage = async (ev) => {
  const { id, op, args } = ev.data;
  try {
    self.postMessage({ id, ok: true, result: await ops[op](args) });
  } catch (e) {
    self.postMessage({ id, ok: false, error: errorText(e) });
  }
};
