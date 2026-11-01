# 0081. The browser runs the blocking core in a worker, over synchronous requests

- Status: accepted; implemented in the core (`spjall-wasm`: the worker transport, the blob store, the
  link QR) and the web client (the chat worker, the page's socket, the integrity of every
  asset, the policy; #43)
- Date: 2026-10-23
- Decided by: Guðröður Atli Jónsson
- Amended by: [0124](0124-unread-without-the-message.md) (the chat runs under every page of a linked browser)
- Amends: [0064](0064-non-phone-devices-are-linked-devices.md) (browser chat waits for the
  async core; the code that runs), [0074](0074-history-transfer-format-and-upload.md) (the
  download)
- Builds on: [0005](0005-contract-zod-openapi-generated-clients.md) (the contract),
  [0062](0062-the-web-host-and-its-sign-in-callbacks.md) (the web host),
  [0077](0077-the-link-code-and-what-the-phone-signs.md) (the link code)

## Decision

### The client

- **The browser runs the core's own blocking client, unchanged, in one dedicated Web
  Worker.** Its `Transport` is synchronous `XMLHttpRequest`, which a worker may use and a
  page may not. Only that worker ever blocks; the page and its other tabs never wait on it.
  0064 deferred browser chat to an async core (#308); this record answers that question
  without one.
- **No async client is written.** `AsyncTransport` stays unimplemented. An async client
  would be a second copy of every `Client` method and its tests, which is what 0064's "one
  store design across clients" rules out.
- **The realtime socket only wakes the worker.** The page holds the WebSocket and tells the
  worker to sync; the worker reads nothing from the socket. A blocked worker cannot take
  events, and a sync already has to catch up after any gap, so nothing is lost.

### The core it runs

- **One wasm crate, `core/wasm` (`spjall-wasm`)**, replacing the `core/web-spike` crate. It
  holds the XHR transport, the browser's blob store and the link code's QR matrix, drawn
  inside the wasm so the page needs no QR library.
- **The web reads the core the way the apps do**: `cargo xtask core web` builds it locally,
  `cargo xtask fetch web` writes the published artifact into the gitignored `web/core/`
  after checking the SHA-256 pinned in `core/artifact.lock.json`, and a `core-v…` tag
  publishes it beside the Android and iOS artifacts. The web's types for it are committed,
  so the web type-checks without a fetch.
- **The store is the core's store on `opfs-sahpool`** (`sqlite-wasm-vfs`), behind an `opfs`
  feature of `spjall-store`, with the same `PRAGMA key` and the same refusal to open
  without a cipher. The pool has no shared memory, so the journal is `TRUNCATE`, not WAL.
- **Media and history files live in a second sqlite3mc database** in the same pool, under
  the same key, so a blob is encrypted at rest like every row.

### The server

- **The socket accepts a session cookie** as well as a device token, when the session has
  an active linked device of the account and the request's `Origin` is the web host's own.
  The cookie is the browser's only credential the page can send on a WebSocket; the
  `Origin` check is what keeps another site from opening one with it.
- **A linked browser is a `web` device.** `completeLinkRequest` records the kind of the
  session that asked, not the approving phone's platform.
- **The approval says whether history follows.** `approveLinkRequest` takes an optional
  `history` (`none` or `sent`), and `complete` answers `historyExpected`, so the browser
  waits for a history only when one is coming. An approval without the field is taken as
  `sent`, as the 0.37 apps send it.
- **The history download is ranged.** `GET …/history` answers a `Range` request with 206
  and that slice, and the browser's transport fetches the file in pieces of at most 64 MiB
  into its blob store. 0074's 1 GiB limit stands, and a synchronous request never holds
  more than one piece in memory.

### The code that runs

- **Every script and style the page loads carries Subresource Integrity**, stamped at build
  time, and the wasm core is fetched with its own `integrity`. A `new Worker()` script
  cannot carry SRI; it is served only from the host, under `worker-src 'self'`, and listed
  in the published hashes.
- **The Content Security Policy adds `'wasm-unsafe-eval'` and `worker-src 'self'`**, and
  nothing else.
- **Each production deploy publishes `web-files.sha256`** in a `web-v…` GitHub release built
  from the deployed commit.

## Why

The client is about twenty blocks of blocking methods over one `Transport`. A synchronous
request inside a worker gives it exactly the boundary it already has, so the browser runs
the code and the tests the phones run. The cost is one worker that cannot answer while it
waits, which no page sees because the page never calls it synchronously.

Ranged download keeps 0074's limit without the phone having to know what kind of device
it sends to, and without a gigabyte in a worker's memory.

## What it rules out

- An async copy of the client, or a second store, for the browser.
- A WebSocket from a session that has no linked device, or from another origin.
- A third-party or unhashed script on the web host, and any CSP source beyond the host's
  own and `'wasm-unsafe-eval'`.
- A browser history download in one request.
