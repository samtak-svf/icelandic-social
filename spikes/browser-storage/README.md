# Browser storage measurement

A measurement, not product code (#297). It compares two ways to keep the encrypted message
store in a browser, in Chromium, Firefox and WebKit:

- **A:** `sqlite3mc` (SQLite3 Multiple Ciphers 2.5.1, its default cipher ChaCha20-Poly1305) on
  the `opfs-sahpool` VFS in a dedicated worker. The database key is 32 random bytes sealed under
  a non-extractable AES-GCM `CryptoKey` kept in IndexedDB.
- **B:** IndexedDB records, each AES-GCM encrypted with a non-extractable `CryptoKey` kept in
  the same database.

The results and what they mean are in [`docs/browser-storage.md`](../../docs/browser-storage.md).
Nothing here is imported by the backend, the core or the apps, and no CI job runs it.

## Running it

```bash
pnpm install                               # at the repo root
cd spikes/browser-storage
./container.sh --runs 3                    # all three browsers, in the pinned Playwright image
node summarize.mjs                         # results/raw.json as ranges
```

`container.sh` uses podman (or docker) and the official Playwright image pinned by digest,
because WebKit's Linux build needs Ubuntu's libraries. Where the host has them,
`pnpm exec playwright install chromium firefox webkit && pnpm measure` runs the same on the
host. `--n` sets the message count (10 000), `--browsers` the engines, and `--keep --profiles
profiles` keeps each browser profile for inspection.

`fetch.mjs` downloads the sqlite3mc wasm build from its GitHub release and refuses it unless
its SHA-256 matches the one pinned there (the release's own `SHA256SUMS`).

## Files

| File               | What it does                                                       |
| ------------------ | ------------------------------------------------------------------ |
| `fetch.mjs`        | the pinned, checksum-verified sqlite3mc wasm into `vendor/`        |
| `server.mjs`       | one fixed origin; `/clear` answers `Clear-Site-Data: "storage"`    |
| `page/a-worker.js` | store A                                                            |
| `page/bench.js`    | store B, and the page side of each step                            |
| `page/common.js`   | IndexedDB helpers, the key, sealing, the ~200-byte messages        |
| `measure.mjs`      | Playwright: each step, a fresh profile per run, `results/raw.json` |
| `summarize.mjs`    | ranges per browser                                                 |
| `container.sh`     | the same inside the pinned Playwright image                        |
