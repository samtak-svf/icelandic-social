# Browser storage: sqlite3mc in OPFS against encrypted IndexedDB

The measurement asked for by [#39](https://github.com/samtak-svf/icelandic-social/issues/39),
for the store decision in [#13](https://github.com/samtak-svf/icelandic-social/issues/13).
It follows point 2 of [the web client feasibility note](web-client-feasibility.md).

## Question

Which encrypted store should the browser client keep its messages in?

- **A**: SQLite3 Multiple Ciphers (`sqlite3mc`, its default cipher) on the `opfs-sahpool`
  VFS, in a dedicated worker. Each file is held through an exclusive sync access handle. The
  database key is 32 random bytes, sealed with AES-GCM under a non-extractable WebCrypto key
  that is kept in IndexedDB. This is the core's store
  ([0016](decisions/0016-one-encrypted-store-owned-by-the-core.md)) in a browser.
- **B**: an IndexedDB store with one record per message, each AES-GCM encrypted under a
  non-extractable `CryptoKey` that is stored in the same database by structured clone. Two
  established messengers ship this design.

Both stores were measured on reload persistence, several tabs, a revocation wipe, storage
loss (`persist()`, Clear-Site-Data, `estimate()`), size on disk for 10,000 messages of about
200 bytes, and cold start (open plus a first query of 50 rows).

## Short answer

**Use A.** It is half the size on disk, writes four to five times faster, keeps the core's
SQL and transactions, and its file is encrypted in every engine. Its cost is about 100 ms of
cold start, most of it wasm initialisation, and **one tab at a time**: in every engine a
second tab cannot open the database. The browser client therefore needs one owning tab,
with the other tabs routed to it. Revocation is a key-first wipe backed by a server
`Clear-Site-Data` header, which removed everything in every engine. A non-extractable key
keeps script from exporting it, but its raw bytes are on disk in all three engines, so it
does not protect against someone who copies the profile.

## Method

The harness is [`spikes/browser-storage/`](../spikes/browser-storage/README.md). It is not
part of the core graph and does not run in CI.

- Playwright 1.64.0 in its pinned container
  (`mcr.microsoft.com/playwright:v1.64.0-noble@sha256:bc72a8df…c462`), headless, on an x86
  Linux desktop. The engines are Chromium 156.0.8078.4, Firefox 157.0 and WebKit 27.2. WebKit
  on Linux stands in for Safari.
- sqlite3mc 2.5.1 (SQLite 3.53.4), from its release's wasm zip, checked against the
  release's SHA-256 (`761a41b8…77ce`). `PRAGMA cipher` answers `chacha20` everywhere.
- Each run starts with a fresh profile. N = 10,000 messages of 200 bytes, in one SQL
  transaction for A and in IndexedDB transactions of 500 for B.
- "On disk" sums the origin's own storage directories in the profile. The same files are
  scanned for a plaintext marker that every message contains. A control store, written
  unencrypted, proves that the scan finds plaintext when there is some.
- Key residue: an extractable `CryptoKey`, stored exactly as both stores store theirs, so the
  scan knows its bytes and can look for them.
- Three runs per engine. Every figure below is the range over those runs, from
  [`results/raw.json`](../spikes/browser-storage/results/raw.json) (2026-10-17).

`spikes/browser-storage/container.sh --runs 3` reruns the measurement, and
`node summarize.mjs` prints the full table.

## Results

| Measure                                      | Chromium                  | Firefox           | WebKit            |
| -------------------------------------------- | ------------------------- | ----------------- | ----------------- |
| Write 10,000 (ms), A                         | 86–107                    | 75–100            | 65–93             |
| Write 10,000 (ms), B                         | 366–389                   | 394–446           | 387–396           |
| On disk (KiB), A                             | 2316                      | 2792              | 2340              |
| On disk (KiB), B                             | 4840                      | 4284–4292         | 3948              |
| `estimate()` (KiB), A                        | 9220                      | 2792              | 9216              |
| `estimate()` (KiB), B                        | 4824                      | 5198–5210         | 3491              |
| Plaintext found in profile files, A or B     | none                      | none              | none              |
| Plaintext found, unencrypted control         | yes                       | yes               | yes               |
| Cold start, A: wasm init (ms)                | 40–48                     | 42–49             | 37–40             |
| Cold start, A: VFS install (ms)              | 8.6–9.9                   | 9.0–10.0          | 3.7–5.7           |
| Cold start, A: key + open (ms)               | 37–42                     | 29–48             | 39–40             |
| Cold start, A: first 50 rows (ms)            | 2.2–3.4                   | 2.3–3.0           | 2.0–3.4           |
| Cold start, A: wall, worker included (ms)    | 110–122                   | 123–149           | 104–107           |
| Cold start, B: key + open (ms)               | 33–39                     | 2.5–3.1           | 2.4–2.7           |
| Cold start, B: first 50 rows, decrypted (ms) | 2.0–3.4                   | 1.7–2.7           | 2.5–4.2           |
| Cold start, B: wall (ms)                     | 40–47                     | 9–10              | 9–11              |
| Rows after reload, A / B                     | 10,000 / 10,000           | 10,000 / 10,000   | 10,000 / 10,000   |
| Second tab opens A                           | no                        | no                | no                |
| Second tab's write to B seen in the first    | yes                       | yes               | yes               |
| Wipe (ms), A / B                             | 5.0–5.3 / 1.3–2.0         | 8.1–9.0 / 1.6–2.1 | 3.7–4.2 / 1.1–1.8 |
| On disk after both wipes (KiB)               | 5628                      | 484               | 0                 |
| `estimate()` after both wipes (KiB)          | 4172–6717                 | 480               | 6288              |
| Clear-Site-Data: response (ms)               | 8–9                       | 20–22             | 4–5               |
| Clear-Site-Data: on disk after (KiB)         | 60                        | 0                 | 0                 |
| `CryptoKey` raw bytes on disk                | yes                       | yes               | yes               |
| … after `deleteDatabase`                     | yes, also after a restart | no                | no                |
| … after Clear-Site-Data                      | no                        | no                | no                |
| `persist()`                                  | false                     | no answer in 3 s  | false             |
| Quota (MiB)                                  | 10240                     | 10240             | 1000              |

## Findings

1. **Both stores encrypt, and both survive a reload.** No profile file held a message in the
   clear, and the control showed that the scan would have found one. A's file has no
   `SQLite format 3` header. Every reload kept all 10,000 rows in both stores.
2. **A is smaller and writes faster.** The sqlite3mc file is 2240 KiB in every engine,
   against 3.9–4.8 MiB for B, whose records each carry an IV, a GCM tag and IndexedDB
   overhead. A writes 10,000 rows in under 110 ms; B needs 370–450 ms, mostly for the
   per-record encryption.
3. **`estimate()` is not the size on disk.** Chromium and WebKit report the sahpool's
   preallocated pool for A (about 9 MiB) and keep reporting space after a wipe. Firefox's
   figure matches its disk. Quota decisions must not be built on `estimate()` alone.
4. **A costs about 100 ms of cold start; B is close to free outside Chromium.** For A, wasm
   initialisation is 37–49 ms, and unsealing the key and opening the file another 29–48 ms.
   The first query takes 2–3 ms in both stores. Chromium's IndexedDB open alone is 33–39 ms,
   so there B saves only about 70 ms.
5. **A belongs to one tab.** A second tab's open fails after about 60–170 ms
   (`NoModificationAllowedError` in Chromium and Firefox, `InvalidStateError` in WebKit),
   and the first tab is unaffected. B is shared freely, and a write in one tab is visible in
   the other.
6. **A wipe needs the key gone first.** With another tab holding the store:
   - A: the key database deletes at once, but the files cannot be removed
     (`NoModificationAllowedError`). The lock frees 126–156 ms after the holding tab closes.
     The next open finds a new key and an unreadable file, and drops it. Because the key goes
     first, the leftover file is already useless.
   - B: `deleteDatabase` stays pending for as long as the holder ignores `versionchange`, and
     completes within 3 ms once it closes.
7. **Clear-Site-Data removes everything, in every engine.** After a response with
   `Clear-Site-Data: "storage"`, nothing was listed in OPFS or IndexedDB, at most 60 KiB was
   left on disk, and both stores reopened empty under new keys. A page wipe left 0.5–5.6 MiB
   of files behind in Firefox and Chromium until the engine compacted them.
8. **A non-extractable key is on disk in the clear.** In all three engines the raw bytes of a
   stored `CryptoKey` are in the profile files. Chromium keeps them in its LevelDB files
   after `deleteDatabase`, also across a restart, until compaction. Clear-Site-Data removed
   them everywhere. "Non-extractable" protects against script in the origin, not against
   someone who copies the profile.
9. **Nothing guarantees the store stays.** `persist()` was refused in headless Chromium and
   WebKit, and Firefox shows a prompt that nobody answers. WebKit's quota is 1000 MiB, the
   other engines' 10 GiB.

## Recommendation for #271

- **Store: A, sqlite3mc in OPFS (`opfs-sahpool`) in a dedicated worker.** It is the core's
  store and schema with a different VFS, so the core needs no second storage
  implementation. It is the smaller and faster store, and its cold start of about 100 ms
  is acceptable for a client that then waits on the network.
- **One owning tab.** Elect an owner with a Web Lock (`navigator.locks.request` on the
  store's name). The other tabs talk to the owner through a `BroadcastChannel`, or show "open
  in another tab". When the owner closes, the lock passes on, and the new owner opens the file
  within about 150 ms. A SharedWorker would avoid the election, but Chrome for Android has
  none.
- **Key custody:** a non-extractable AES-GCM `CryptoKey` in IndexedDB that seals 32 random
  bytes, which are the sqlite3mc key. This blocks exfiltration by script, which is the threat
  a browser can actually address. It does not protect a copied profile (finding 8). If that
  matters, the sealing key must come from outside the profile, for example from a server
  session (lost when the session ends) or from a passphrase. That is a product choice for the
  decision record, not something this measurement settles.
- **Revocation:** the client deletes the key database first and then the pool (a
  crypto-shred), and treats a new key with an old file as an orphan to drop. The server
  answers the revoked session with `Clear-Site-Data: "storage"`, which is the only wipe that
  removed everything, key bytes included, in every engine.
- **Eviction:** treat the store as a cache. `persist()` cannot be relied on, and Safari evicts
  after 7 days without a visit. An evicted browser must rebuild from the server and from a
  sibling device's history transfer, and its device must expire on the server.

## Not measured

- Real Safari on macOS and iOS: its 7-day eviction, any Keychain wrapping of stored
  `CryptoKey`s, and its storage quota. WebKit on Linux is not Safari.
- Mobile browsers (Chrome for Android, iOS Safari), and the cold start on a phone. These
  figures come from a desktop.
- A real `persist()` decision. Headless runs never grant it, and Firefox's prompt goes
  unanswered.
- The Web Lock handover between tabs, and long-term growth or compaction.
- The core's own Rust store in wasm (`sqlite-wasm-rs`) instead of the sqlite3mc JavaScript
  build. Both use the same library and VFS design, but the Rust build was not timed here.
