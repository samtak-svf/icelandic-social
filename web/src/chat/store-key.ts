// The browser store's two-part key (decision 0064). The store's key is 32
// random bytes. They are sealed by a non-extractable AES-GCM key kept in
// IndexedDB, and that sealed value is sealed again by the 32-byte share the
// server hands only to the device's live session. Neither part alone opens the
// store: a copied profile has no share, and the share has nothing to open
// without the profile's local key. Both layers bind the device id, so a record
// cannot be moved to another device.
//
// It runs in the chat worker: the raw key never reaches the page.

/** What IndexedDB keeps for one device. `local` cannot be exported. */
export interface SealedStoreKey {
  v: 1;
  deviceId: string;
  local: CryptoKey;
  sealed: Uint8Array<ArrayBuffer>;
}

/** The store cannot be opened again: the device is lost, and the person links anew. */
export class StoreKeyLost extends Error {
  constructor() {
    super("store_key_lost");
    this.name = "StoreKeyLost";
  }
}

const KEY_BYTES = 32;
const IV_BYTES = 12;

/** A fresh store key: what the core's store is opened with. */
export function newStoreKey(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(KEY_BYTES));
}

function aad(deviceId: string, layer: "local" | "share"): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`spjall-store-key/v1/${layer}/${deviceId}`);
}

function importShare(share: Uint8Array<ArrayBuffer>, use: KeyUsage): Promise<CryptoKey> {
  if (share.length !== KEY_BYTES) throw new RangeError("the store-key share is 32 bytes");
  return crypto.subtle.importKey("raw", share, "AES-GCM", false, [use]);
}

async function encrypt(
  key: CryptoKey,
  plain: Uint8Array<ArrayBuffer>,
  data: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const body = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: data }, key, plain),
  );
  const out = new Uint8Array(IV_BYTES + body.length);
  out.set(iv);
  out.set(body, IV_BYTES);
  return out;
}

async function decrypt(
  key: CryptoKey,
  sealed: Uint8Array<ArrayBuffer>,
  data: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  const iv = sealed.subarray(0, IV_BYTES);
  const body = sealed.subarray(IV_BYTES);
  return new Uint8Array(
    await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: data }, key, body),
  );
}

/** Seals `storeKey` under a new local key and then under the server's `share`. */
export async function seal(
  storeKey: Uint8Array<ArrayBuffer>,
  share: Uint8Array<ArrayBuffer>,
  deviceId: string,
): Promise<SealedStoreKey> {
  const outer = await importShare(share, "encrypt");
  const local = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
  const inner = await encrypt(local, storeKey, aad(deviceId, "local"));
  const sealed = await encrypt(outer, inner, aad(deviceId, "share"));
  inner.fill(0);
  return { v: 1, deviceId, local, sealed };
}

/** The store key, or `StoreKeyLost` when either part does not open it. */
export async function unseal(
  record: SealedStoreKey,
  share: Uint8Array<ArrayBuffer>,
  deviceId: string,
): Promise<Uint8Array<ArrayBuffer>> {
  if (record.v !== 1 || record.deviceId !== deviceId) throw new StoreKeyLost();
  const outer = await importShare(share, "decrypt");
  let inner: Uint8Array<ArrayBuffer> | undefined;
  try {
    inner = await decrypt(outer, record.sealed, aad(deviceId, "share"));
    return await decrypt(record.local, inner, aad(deviceId, "local"));
  } catch {
    throw new StoreKeyLost();
  } finally {
    inner?.fill(0);
  }
}

const DB = "spjall-store-key";
const STORE = "keys";
const RECORD = "current";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(
  mode: IDBTransactionMode,
  act: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = act(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** The sealed record this browser keeps, if any. */
export function loadSealed(): Promise<SealedStoreKey | undefined> {
  return run<SealedStoreKey | undefined>("readonly", (s) => s.get(RECORD));
}

/** Keeps the sealed record; the `CryptoKey` is stored as itself, never as bytes. */
export async function saveSealed(record: SealedStoreKey): Promise<void> {
  await run("readwrite", (s) => s.put(record, RECORD));
}

/** Deletes the key database: the local part is gone, so the store cannot open again. */
export function deleteSealed(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
}
