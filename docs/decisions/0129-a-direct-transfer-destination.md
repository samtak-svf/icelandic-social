# 0129. A direct transfer destination

- Status: accepted; implemented (#550), not yet enabled
- Date: 2026-11-03
- Decided by: the overseer, on Guðröður Atli Jónsson's order of 2026-11-03 to let a person push their content here from another platform directly; his to overturn
- Amends: [0127](0127-what-a-real-export-holds-and-how-it-comes-in.md) (a third way in, beside the file and the feed)

## Decision

**The server is a destination for direct transfers under the Data Transfer Initiative's open
standard**: the Generic Importers API, with an OAuth 2.0 authorization-code grant. A person on
another platform picks this service as where their posts and photos go, signs in here, consents,
and the exporter pushes the items one at a time, once or on a schedule. It is the third way in for
the import epic (#461), beside the export file (0119, 0127) and the page feed (0120).

**Two verticals, nothing else.** `social-posts` (an activity: text, links, images) and `media`
(albums, photos and videos; `photos` and `videos` are aliases). Calendar, blobs, archives and every
other vertical are ruled out: nothing here holds them. A video is acknowledged and left behind,
counted, as decision 0120 leaves videos; a file larger than a photo may be is treated the same, so
the exporter is never stuck retrying an item that cannot land.

**One exporter, set by a secret.** The registered client (id, name, SHA-256 of its secret, its
redirect addresses, the import source key it maps to) is one JSON secret, `TRANSFER_CLIENT`, read
only in `backend/src/env/`. While it is unset every transfer endpoint answers 404 and the web shows
nothing. The exporter's own terms decide who may transfer: it geofences to Iceland and registers
this destination at its Trust Level 1. A second exporter is a new record, not a list in the secret.

**Everything comes in held** (0127). A transferred post is a held post of one standing import per
person and exporter, seen by nobody but its author until they open it, and removed with that import
by the existing routes. Photos are staged in R2 and gathered into posts by album once no photo has
arrived for ten minutes, so an album lands as the posts its author would have made, not one post
per photo.

**Repeats are no-ops.** A post is known by the exporter's activity id, a photo by the SHA-256 of
its bytes, both within the person's import: the exporter retries, and a recurring transfer sends
the same items again.

**The grant is the person's to take back.** Tokens are opaque, stored only as SHA-256 hashes in D1.
An access token lasts one hour; a refresh token has no expiry and rotates on every use. A code is
single-use for ten minutes; a reused code or refresh token is read as stolen and ends the grant. PKCE
(S256) is honoured when the exporter sends it, and a verifier without a challenge is refused as a
downgrade. The person sees each grant (since when, what came in, what was left behind) and revokes
it on the imports page; a revoked grant answers the exporter `session_invalidated`, which is the
protocol's signal to stop. Revoking keeps what came in; removing the import removes it.

**Limits the protocol can act on.** A person's transfers hold at most 50,000 items; past that the
answer is `413 destination_full`, which pauses the job. There is no per-item rate limit: the
exporter sends one item at a time and gives up after about thirteen seconds of retries, so a 429
would lose items, not slow them.

**Residency and fetching.** Everything lands in the EU D1, R2 and Durable Objects (0001). An image
a post links to is fetched by the server over https only, from a public host name (no address
literal, no single-label or local name, port 443), with redirects re-checked, ten seconds and the
photo size limit as caps; anything else is left out and counted, never fetched.

## Why

The export file asks a person to request an archive, wait, download gigabytes and upload them
again. A direct transfer is one consent. The standard is open and the exporter already speaks it,
so the work is the destination's side only, and it reuses the import pipeline that already holds,
sorts and opens posts.

## What it rules out

- Any vertical but social posts and media.
- A transferred post visible before its author opens it.
- Storing a token, code or client secret as itself.
- A rate limit on items, and any fetch to a non-public address.
- Naming the exporter in this repository: it is "another platform" here, as in 0119 and 0120.
