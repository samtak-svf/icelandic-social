// The browser store's two-part key (decision 0064). The store's key is 32
// random bytes. They are sealed by a non-extractable AES-GCM key kept in
// IndexedDB, and that sealed value is sealed again by the 32-byte share the
// server hands only to the device's live session. Neither part alone opens the
// store: a copied profile has no share, and the share has nothing to open
// without the profile's local key. Both layers bind the device id, so a record
// cannot be moved to another device.
//
// While a link waits for the phone, the store is sealed the same way under the
// share the server made with the link request, bound to the request's id
// rather than a device's (decision 0096), so a reload goes on with the link.
//
// It runs in the chat worker: the raw key never reaches the page.

/** What IndexedDB keeps for one device. `local` cannot be exported. */
export interface SealedStoreKey {
  v: 1;
  deviceId: string;
  local: CryptoKey;
  sealed: Uint8Array<ArrayBuffer>;
}

/** A link that waits for the phone: its code, and the store sealed under the request's share. */
export interface PendingLink {
  v: 1;
  linkId: string;
  code: string;
  /** Milliseconds since the epoch. */
  expiresAt: number;
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

/** What a record is bound to: a device's id, or `pending/` and a link request's id. */
function aad(binding: string, layer: "local" | "share"): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`spjall-store-key/v1/${layer}/${binding}`);
}

const pendingBinding = (linkId: string) => `pending/${linkId}`;

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

async function sealBound(
  storeKey: Uint8Array<ArrayBuffer>,
  share: Uint8Array<ArrayBuffer>,
  binding: string,
): Promise<{ local: CryptoKey; sealed: Uint8Array<ArrayBuffer> }> {
  const outer = await importShare(share, "encrypt");
  const local = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
  const inner = await encrypt(local, storeKey, aad(binding, "local"));
  const sealed = await encrypt(outer, inner, aad(binding, "share"));
  inner.fill(0);
  return { local, sealed };
}

async function unsealBound(
  record: { local: CryptoKey; sealed: Uint8Array<ArrayBuffer> },
  share: Uint8Array<ArrayBuffer>,
  binding: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const outer = await importShare(share, "decrypt");
  let inner: Uint8Array<ArrayBuffer> | undefined;
  try {
    inner = await decrypt(outer, record.sealed, aad(binding, "share"));
    return await decrypt(record.local, inner, aad(binding, "local"));
  } catch {
    throw new StoreKeyLost();
  } finally {
    inner?.fill(0);
  }
}

/** Seals `storeKey` under a new local key and then under the server's `share`. */
export async function seal(
  storeKey: Uint8Array<ArrayBuffer>,
  share: Uint8Array<ArrayBuffer>,
  deviceId: string,
): Promise<SealedStoreKey> {
  return { v: 1, deviceId, ...(await sealBound(storeKey, share, deviceId)) };
}

/** The store key, or `StoreKeyLost` when either part does not open it. */
export async function unseal(
  record: SealedStoreKey,
  share: Uint8Array<ArrayBuffer>,
  deviceId: string,
): Promise<Uint8Array<ArrayBuffer>> {
  if (record.v !== 1 || record.deviceId !== deviceId) throw new StoreKeyLost();
  return unsealBound(record, share, deviceId);
}

/** Seals the store of a link that waits for the phone under its request's `share` (0096). */
export async function sealPending(
  storeKey: Uint8Array<ArrayBuffer>,
  share: Uint8Array<ArrayBuffer>,
  link: { code: string; linkId: string; expiresAt: number },
): Promise<PendingLink> {
  const { code, linkId, expiresAt } = link;
  return {
    v: 1,
    linkId,
    code,
    expiresAt,
    ...(await sealBound(storeKey, share, pendingBinding(linkId))),
  };
}

/** The store key of a waiting link, or `StoreKeyLost` when either part does not open it. */
export async function unsealPending(
  record: PendingLink,
  share: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  if (record.v !== 1) throw new StoreKeyLost();
  return unsealBound(record, share, pendingBinding(record.linkId));
}

const DB = "spjall-store-key";
const STORE = "keys";
const RECORD = "current";
const PENDING = "pending";

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

/** The link this browser waits on, if any. */
export function loadPending(): Promise<PendingLink | undefined> {
  return run<PendingLink | undefined>("readonly", (s) => s.get(PENDING));
}

/** Keeps the waiting link, replacing the one before. */
export async function savePending(record: PendingLink): Promise<void> {
  await run("readwrite", (s) => s.put(record, PENDING));
}

/** Forgets the waiting link; the device record, if any, stays. */
export async function deletePending(): Promise<void> {
  await run("readwrite", (s) => s.delete(PENDING));
}

/** Deletes the key database, the waiting link's record with it: the local part is gone, so the store cannot open again. */
export function deleteSealed(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
}
