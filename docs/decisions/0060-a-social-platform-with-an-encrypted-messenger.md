# 0060. The product is a social platform with an encrypted messenger, in one Worker

- Status: accepted; implemented in the backend, the core, the apps and the web (phases 1–4 and 7: #45, #47, #48, #49, #58);
  news (#50) and linked-device browser chat (#51) in progress; amended by 0114, 0115 and 0116
- Date: 2026-10-17
- Decided by: Guðröður Atli Jónsson
- Builds on: [0001](0001-eu-storage-and-residency-wording.md) (EU storage),
  [0002](0002-mls-end-to-end-encryption.md) (MLS), [0005](0005-contract-zod-openapi-generated-clients.md)
  (the contract), [0008](0008-no-pii-in-logs.md) (no PII in logs)
- Amends: 0009 (what the product is, and the web as a client), 0044 (a feed and posts may
  return, under this record and the community record)
- Amended by: [0114](0114-friends-and-the-person-screen.md) (friendships, not follows),
  [0115](0115-the-wall.md) (an account's Space is its wall, friends by default),
  [0116](0116-the-feed.md) (the feed reaches the apps in the closed beta)

## Decision

### The product

- **One account across encrypted conversations, communities, social feeds and news**, on
  Android, iOS and the web. The messenger stays as 0009 and its amendments describe it; the
  social side is added beside it, never inside a conversation.
- **Two kinds of content, never mixed.** A conversation is end-to-end encrypted under MLS
  (0002), and the server sees only ciphertext. Community and feed content is hosted and
  access-controlled: the server reads it to serve it to its audience. A screen always shows
  which of the two it is, and nothing moves from one to the other without the person doing
  it.
- **The web is a client.** It is the lead client for social features, with Android and iOS
  following each one in a tracked issue. A browser signs in to a session, never an MLS
  device (the session record, #268); encrypted chat in a browser comes last, as a device
  linked to a phone (#271).
- Communities, audiences and moderation are their own record (#270). A social feature still
  needs its record before code, as 0009 requires.

### What stays of 0044

- **The posts deleted in production stay deleted.** Nothing is restored, and the removed
  `posts`, `post_replies` and `post_reactions` tables do not return: social content is a new
  design under these records.
- The `post` envelope kind stays decodable with its fixed line, and nothing sends one.
- There is still no feed in the apps until the social slice ships after the open beta.

### Hosting

- **One Worker** serves the API at `/v1/`, the links at `/l/` and the web app at `/`, on one
  host (the web-host record, #269). EU jurisdiction is unchanged (0001).
- **One D1** holds the accounts, the social graph (memberships, follows, blocks), moderation
  state and a compact post index (`post_id`, its space, the author, `created_at`) that the
  feed reads in time windows. [`docs/d1-social-workload.md`](../d1-social-workload.md)
  measured the graph at about 0.9 GiB after three years at 100,000 accounts.
- **Content lives in a SQLite Durable Object per space**: one per community and one per
  account's posts to its followers. It holds the posts, comments, reactions and the
  space's moderation log, and is pinned to the EU per object id, as `Conversation` is:
  `env.SPACE.jurisdiction("eu").getByName(…)`, made only in `backend/src/env/` (0001). The
  measurement put content at about 94% of 60 GiB after three years, past D1's 10 GB in six
  months; a space's object has its own 10 GB.
- **Members read their spaces; nothing fans out.** A feed reads the index per source in a
  time window. A notification row is written only for something addressed to one person (a
  reply, a reaction to their post, a mention).

### Modules

- The backend is one deployable in modules: `identity/` (accounts, login identities,
  sessions, devices, blocks), `modules/*` (messaging, profiles, and each social area as its
  own module), `integrations/` (outside services, such as news sources)
  and `jobs/` (scheduled work).
- **A module writes only its own tables**, reads another module's only where the guard lists
  the pair with a reason, and is imported only through its entry (`tooling/module-guard.mjs`,
  #314). A new table is given an owner in the PR that creates it.

### Release order

1. The records (#302), then groundwork that changes nothing visible, beside the closed beta.
2. Sessions separate from devices, then the web shell on the same Worker.
3. The first social slice after the open beta, web first; then news.
4. Encrypted chat on non-phone devices last.

## Why

- The messenger alone does not carry the product that was asked for: communities and news
  are where people meet, and a conversation is where they talk privately. One account for
  both keeps one identity, one block list and one deletion.
- Keeping hosted content apart from MLS keeps 0002's promise exact. A community of thousands
  cannot be an MLS group, and a messenger that quietly hosts some messages in the clear is
  worse than one that says which is which.
- One Worker and one D1 are what the team can run. The modules and their guard give the
  boundaries that microservices would, without the deploys, the network hops and the
  distributed transactions.
- The D1 measurement made the content split a choice now rather than a migration later: the
  graph fits for years, the content does not. A Durable Object per space is the pattern the
  conversations already use, with residency per object id already proven.

## Rules out

- Microservices, a database per module, or a D1 created at runtime per community.
- A plugin runtime or third-party code on the server.
- An algorithmic feed. Feeds are in time order, from what a person joined or follows.
- A cross-platform UI rewrite of the apps, or a desktop app before the web.
- Fanning a community post out to its members.
- Community or feed content inside an MLS conversation, or a conversation's content on the
  social side.
- Restoring the content 0044 deleted.
