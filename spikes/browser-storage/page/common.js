// Shared by the page and the store A worker: IndexedDB as promises, the
// non-extractable AES-GCM key both stores keep in IndexedDB, and the messages.

const MARKER = "PLAINTEXT-MARKER";

/** About 200 bytes of text, numbered so a read can be checked. */
export function message(i) {
  const head = `${MARKER} ${i} `;
  return head + "x".repeat(200 - head.length);
}

/** @param {IDBRequest} req */
export function done(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** @param {IDBTransaction} tx */
export function committed(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * Opens (and on first use creates) an IndexedDB database with these stores.
 * @param {string} name
 * @param {string[]} stores
 */
export function openDb(name, stores) {
  const req = indexedDB.open(name, 1);
  req.onupgradeneeded = () => {
    for (const s of stores) req.result.createObjectStore(s);
  };
  return done(req);
}

/**
 * The store's AES-GCM key: a CryptoKey that cannot be exported, kept in
 * IndexedDB by structured clone (as Wire and Element do). Made on first use.
 * @param {IDBDatabase} db with a "key" store
 * @returns {Promise<{ key: CryptoKey, created: boolean }>}
 */
export async function storeKey(db) {
  const found = await done(db.transaction("key").objectStore("key").get("k"));
  if (found) return { key: found, created: false };
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
  const tx = db.transaction("key", "readwrite");
  tx.objectStore("key").put(key, "k");
  await committed(tx);
  return { key, created: true };
}

/** True when the key really cannot leave WebCrypto. */
export async function unexportable(key) {
  try {
    await crypto.subtle.exportKey("raw", key);
    return false;
  } catch {
    return key.extractable === false;
  }
}

/** @param {CryptoKey} key @param {Uint8Array} bytes */
export async function seal(key, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes));
  return { iv, ct };
}

/** @param {CryptoKey} key @param {{ iv: Uint8Array, ct: Uint8Array }} box */
export async function open(key, box) {
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: box.iv }, key, box.ct));
}

/** @param {string} name */
export function deleteDb(name) {
  return new Promise((resolve, reject) => {
    let blocked = false;
    const req = indexedDB.deleteDatabase(name);
    req.onblocked = () => {
      blocked = true;
    };
    req.onsuccess = () => resolve({ blocked });
    req.onerror = () => reject(req.error);
  });
}

/** Whether a byte array contains the ASCII marker. */
export function containsMarker(bytes) {
  const m = new TextEncoder().encode(MARKER);
  outer: for (let i = 0; i + m.length <= bytes.length; i++) {
    for (let j = 0; j < m.length; j++) if (bytes[i + j] !== m[j]) continue outer;
    return true;
  }
  return false;
}

/** @param {unknown} e */
export function errorText(e) {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}
