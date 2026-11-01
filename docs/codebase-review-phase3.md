# Phase 3 Codebase Review: Backend Queries & Orchestration, Web Client, and Rust Core

_Date:_ 2026-11-01  
_Reviewer:_ AI Agent (verified line-by-line against the codebase)  
_Purpose:_ Deep review of backend pagination/SQL/orchestration, web data loading and memory management, and Rust core concurrency/duplication

---

## Executive Summary

Building on Phases 1 and 2, this phase examined the remaining backend surfaces (`compose/`, access/standing, pagination, SQL index coverage), the web client (`web/src/social/` vs `web/src/chat/`), and the Rust core (`core/client/` and `core/store/`). Every finding below has been verified directly against the source code, and two false positives raised during exploration were refuted and excluded.

### Top Findings Across Phase 3

1. **Suspended moderators retain full moderation powers (`backend`)**: `notSuspended` wraps content-creation routes, and `actOnAccount` checks `suspension()` only on the _target_ (`backend/src/modules/moderation/actions.ts:320`), never on the _actor_. Neither `Standing` (`communities.ts:75-112`) nor `isPlatformModerator` (`reports.ts:314-320`) checks whether the acting moderator is currently suspended.
2. **Account deletion (`deleteAccount`) can leave unreachable content on partial failure (`backend`)**: `forgetAccount` (`backend/src/modules/social/lifecycle.ts:64-71`) loops sequentially over `space_authors` (DO call + D1 batch + R2 delete per community), and `dropAccount` (`compose/account-deletion.ts:36`) deletes the account row, which cascades `space_authors` (`migrations/0015_social.sql:41`). If a mid-saga retry never happens after `revokeAllDevices`, leftover community content has no index entry pointing to it.
3. **Report queue N+1 and non-sargable SQL (`backend`)**: `reportPage` (`backend/src/modules/moderation/reports.ts:255-280`) runs `standingOf` (D1 query) and `stateOf` (Durable Object call) inside `Promise.all(page.map(...))` — up to 50 D1 queries and 50 DO invocations per page. Its `WHERE (CASE WHEN ?1 IS NULL ...)` (`reports.ts:215-216`) also prevents SQLite from using either `reports_to_platform` or `reports_by_community`.
4. **Web post images and chat group photos lack caching and deduplication (`web`)**: Unlike `Avatar` (`web/src/social/avatar.tsx:74`), `useMediaSrc` (`web/src/social/viewer.tsx:15-34`) has no cache and revokes on unmount — opening a post image in the lightbox downloads the full blob a second time while the thumbnail is already mounted (`post.tsx:363` + `viewer.tsx:70`). Similarly, `useGroupPhoto` (`web/src/chat/group-photo.ts:58-98`) makes one worker RPC and creates a fresh `Blob` URL per mounted avatar instance with no shared cache.
5. **Web `Cover` flashes the previous community's cover on navigation (`web`)**: `Avatar` resets `setSrc(null)` unconditionally when `[kind, id, photo]` changes (`web/src/social/avatar.tsx:131`), whereas `Cover` only resets when `version === null` (`avatar.tsx:182`). Navigating from one community with a cover to another shows the old cover until the new fetch resolves.
6. **Rust core outbox `drain()` and `history` lock contention (`core`)**: `drain()` (`core/client/src/lib.rs:1655-1681`) opens two separate `BEGIN IMMEDIATE` write transactions (`try_write`) per queued message (one just to read `next_unsent`, then network I/O, then one to mark it sent). `export_history` (`core/client/src/history.rs:664`) uses `self.store.try_write(|tx| records(tx, since))` — holding an exclusive write lock across the entire database for a pure `SELECT` scan.

---

## 1. Backend: Pagination, SQL Indexes, and Query Bottlenecks

### 1.1 Five Cursor Dialects with Inconsistent Layering

Cursor parsing is implemented five times with different shapes and validation boundaries:

| Surface        | Format                                          | Validated at                                       | Parsed at                                                       |
| -------------- | ----------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------- |
| Posts / Feed   | `createdAt` or `createdAt-postId`               | `backend/src/api/social.ts:129-132` (Zod regex)    | `backend/src/modules/social/post-page.ts:22-28` (`parseCursor`) |
| Home           | `days.createdAt` or `days.createdAt-postId`     | `backend/src/api/home.ts:20-23`                    | `backend/src/modules/social/home.ts:80-89` (`parseHomeCursor`)  |
| Reports        | `createdAt-reportId`                            | `backend/src/api/moderation.ts:209-213`            | `backend/src/modules/moderation/reports.ts:204-208`             |
| Moderation Log | `entryId` (integer string)                      | `backend/src/api/moderation.ts:217-221`            | `backend/src/modules/moderation/log.ts:103` (`Number(before)`)  |
| Directory      | base64url JSON `[verified, nameKey, accountId]` | Inside `decodeDirectoryCursor`                     | `backend/src/modules/profiles/profiles.ts:89-107`               |
| Import Items   | `createdAt-itemId`                              | `backend/src/api/imports.ts:180` (reuses `Cursor`) | `backend/src/modules/imports/file-read.ts:77-78`                |

- **Note on the Moderation Log cursor (False Positive Refuted):** At first glance `backend/src/api/moderation.ts:217-221` (`^\d{1,16}$`) looks like a timestamp without a tiebreaker id, which would lose rows on equal timestamps. Direct inspection of `backend/src/modules/moderation/log.ts:100-103,124` shows it actually paginates on `entry_id < ?2 ORDER BY entry_id DESC` (the `INTEGER PRIMARY KEY`), which is strictly unique and monotonic. The cursor is sound; only its description in `backend/src/api/moderation.ts:220` could be clearer that the digits are `entryId`.
- **Layering gap in `parseCursor` (`post-page.ts:22-28`):** Unlike `decodeDirectoryCursor` (`profiles.ts:89-107`), which validates its input and returns `null` on malformed strings, `parseCursor` trusts that the caller ran the HTTP route's Zod regex first. Because `parseCursor` is exported and `feed()`/`communityPosts()` take `before: string | undefined`, any non-HTTP caller passing an unvalidated string could produce `NaN` in `.bind()`.

### 1.2 SQL Index Gaps and Query Plans

1. **Report queue `CASE` expression defeats indexes (`backend/src/modules/moderation/reports.ts:215-216`):**
   ```sql
   WHERE (CASE WHEN ?1 IS NULL THEN to_platform = 1
               ELSE community_id = ?1 AND to_platform = 0 END)
   ```
   Because `to_platform` is inside a `CASE` over a bound parameter, SQLite cannot use `reports_to_platform (to_platform, state, created_at)` or `reports_by_community (community_id, state, created_at)` (`backend/migrations/0016_moderation.sql:38-39`). Splitting into two query strings (or `to_platform = ?5 AND (?1 IS NULL OR community_id = ?1)`) restores index seeks.
2. **Missing index for `expireReports` (`reports.ts:373-378`):**
   `DELETE FROM reports WHERE state = 'closed' AND closed_at < ?` scans the table because no index on `reports` starts with `(state, closed_at)`.
3. **`posts_by_community` missing tiebreaker column (`migrations/0030_anonymous_posts.sql:30`):**
   The index is `(community_id, created_at)`, while queries sort by `ORDER BY p.created_at DESC, p.post_id DESC` (`post-page.ts:62`). Extending the index to `(community_id, created_at DESC, post_id DESC)` avoids a temp B-tree sort on timestamp ties.
4. **Unbounded search ID list in a single bound parameter (`post-page.ts:51,60,70`):**
   `const matched = await searched(env, communityId, query)` fetches every matching post ID from the Space DO's FTS table and binds `JSON.stringify(matched ?? [])` into a single D1 parameter (`json_each(?6)`). For a short query in a large community, this materializes thousands of IDs into one JSON parameter.
5. **Unpaginated endpoints (`communities.ts:327-337, 399-417`):**
   - `members()` (`communities.ts:399-417`) has no `LIMIT` — returns every member of a community in one payload.
   - `communitiesOf()` (`communities.ts:327-337`) has no `LIMIT` and evaluates `COLUMNS` (`communities.ts:80-112`, ~9 correlated subqueries per row, including `EXISTS (SELECT 1 FROM platform_moderators WHERE account_id = ?1)` at line 86 which does not depend on the community row at all).
6. **Quadratic array filters (`identity/accounts.ts:44-47`, `modules/social/lifecycle.ts:51`):**
   - `activeDevicesOf` (`accounts.ts:44-47`) does `accounts.map(id => results.filter(r => r.accountId === id)...)` — $O(\text{accounts} \times \text{devices})$. Grouping into a `Map` first makes it $O(N)$.
   - `lifecycle.ts:51` does `postIds.filter((id) => !kept.includes(id))` — $O(N^2)$ over a purged post list; `new Set(kept)` makes it $O(N)$.

_(Note: Every multi-ID query in the backend properly uses `json_each(?)` rather than `IN (?, ?, ...)`, completely avoiding D1's 100-parameter limit.)_

---

## 2. Backend: `compose/`, Saga Safety, and Access Control

### 2.1 `reportPage` N+1 (`backend/src/modules/moderation/reports.ts:255-280`)

Inside `Promise.all(page.map(async (r) => ...))`:

- Line 275 calls `await standingOf(env, r, ...)` (1 D1 query per report).
- Line 276 calls `await stateOf(env, r)` (1 Durable Object RPC to `space(env, r.community_id)` per post/comment report).

With `limit` up to 50 (`backend/src/api/moderation.ts:214`), loading one page of reports triggers up to **50 concurrent DO calls and 50 D1 queries**, threatening Cloudflare Workers' 50-subrequest limit on the free tier and adding latency on paid tiers. Both can be batched by `community_id` the same way `render()` (`modules/social/posts.ts:58-68`) batches post reads per community.

### 2.2 `deleteAccount` and `purgeContent` Ordering / Saga Risks

1. **`deleteAccount` (`backend/src/compose/account-deletion.ts:20-37`):**
   Runs 10 sequential cross-module steps starting with `revokeAllDevices`. If `forgetAccount` (`modules/social/lifecycle.ts:64-71`, which makes 3 sequential calls per community the user ever posted in) fails mid-way, the user has no active devices left to retry `DELETE /v1/me` without signing in again, and `deleteOrphans` (`account-deletion.ts:40-43`) only cleans up accounts with zero identities.
2. **`communityLifecycle.purgeContent` (`backend/src/compose/community-lifecycle.ts:13-16`):**
   ```ts
   purgeContent: async (env, communityId) => {
     await dropSpace(env, communityId);
     await forgetCommunity(env, communityId);
   },
   ```
   Destroys the Durable Object (`dropSpace`) _before_ cleaning up D1 rows (`forgetCommunity`). If `forgetCommunity` fails, the retry sees the D1 rows and runs again (which is safe if `dropSpace` is idempotent), but reversing the order or ensuring idempotency is cleaner.
3. **`jobHandlers` silent overwrite (`backend/src/compose/job-handlers.ts:9-12`):**
   Spreads `...notificationJobs(...)` and `...importJobs()` into one object without asserting disjoint keys.
4. **Minor duplicate check in `linkOrJoin` (`backend/src/compose/account-linking.ts:31-32`):**
   Two consecutive `if (linked.ok.merged)` statements on back-to-back lines.

### 2.3 Access Control: Suspended Moderators and Wall Mutes

1. **Suspended moderators retain moderation powers (`backend/src/modules/moderation/actions.ts`, `reports.ts`):**
   _(Note: Phase 3 exploration also flagged wall posts/comments bypassing suspension in `access.ts:137`, which is a **false positive** — all wall write routes in `social/wall-routes.ts:110,126,143,155` and `social/routes.ts:92,163` are wrapped in `notSuspended(...)` middleware (`identity/suspension.ts:82`).)_
   However, **moderation routes are NOT wrapped in `notSuspended`**, and `actor()` (`actions.ts:51-61`) / `actOnAccount()` (`actions.ts:300-351`) never check if the acting moderator is suspended (`suspension()` is only checked on the _target_ at `actions.ts:320`). A suspended community moderator or platform moderator can still ban members, remove posts, or suspend accounts.
2. **`applies()` missing `unmute_member` check (`backend/src/modules/moderation/actions.ts:75-79`):**
   `ban` checks `!s.banned` and `unban` checks `s.banned`, but `unmute_member` only checks `s.role !== null`, allowing a moderator to "unmute" an unmuted member and write a no-op entry to `moderation_log`.
3. **`placeOf` skips `canRead` on community reports (`backend/src/modules/moderation/reports.ts:64-67`):**
   Uses `standing(env, reporter, id)` and checks `!found.banned`, but does not check `canRead(found)`, allowing a non-member to submit a report against a private community's ID.

---

## 3. Web Client (`web/src/`): Duplication, Caching, and Hook Safety

### 3.1 `social/` vs `chat/` Split

`web/src/social/` has strong shared primitives (`useLoad` in `outcome.ts:34`, `usePaged` in `paged.ts:38`, `useObjectUrl` in `object-url.ts:8`, `ImageProblem` in `image-problem.tsx:30`), while `web/src/chat/` hand-rolls its own effects:

| Issue                                                    | Location                                                                                                                       | Detail & Fix                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Duplicate `useObjectUrl`**                             | `web/src/social/comment-composer.tsx:15-24` (`Preview`)                                                                        | Reimplements `createObjectURL` + `revokeObjectURL` in `useEffect` instead of calling `useObjectUrl(file)` from `web/src/social/object-url.ts:8`.                                                                                                                                                                                             |
| **Split `REFUSED` maps**                                 | `web/src/social/composer.tsx:30-34` vs `web/src/social/image-problem.tsx:23-27`                                                | `composer.tsx` has `{ too_many, too_large, invalid_image }`; `image-problem.tsx` has `{ too_large, invalid_image, no_master }`. Both render the same `<Status>` pattern.                                                                                                                                                                     |
| **Stale Cover image on community switch**                | `web/src/social/avatar.tsx:180-185` (`Cover`)                                                                                  | `Avatar` (`avatar.tsx:131`) calls `setSrc(null)` at the start of its effect on every `[kind, id, photo]` change. `Cover` (`avatar.tsx:182`) only calls `setSrc(null)` when `version === null`. Switching between two communities with covers leaves Community A's cover visible on Community B until B's cover finishes downloading.         |
| **No cache for post images (`useMediaSrc`)**             | `web/src/social/viewer.tsx:15-34`                                                                                              | Every mount fetches the image blob anew and revokes it on unmount. Clicking a post image (`post.tsx:363`) to open `ViewerImage` (`viewer.tsx:70`) downloads the same image a second time while it is already on screen.                                                                                                                      |
| **No cache for chat group photos (`useGroupPhoto`)**     | `web/src/chat/group-photo.ts:58-98`                                                                                            | Each mounted `ConversationAvatar` (`conversation-row.tsx:35`, header, info sheet) independently calls `call("groupPhoto", id)` over the worker boundary and creates its own `Blob` URL, plus registers its own `subscribe` listener (`group-photo.ts:67-74`).                                                                                |
| **Race condition in `conversation-list.tsx`**            | `web/src/chat/conversation-list.tsx:55-68`                                                                                     | `load()` has no `live` flag and no generation counter: rapid navigation or overlapping event batches (`line 76`) can resolve out of order.                                                                                                                                                                                                   |
| **Repeated `myCommunities()` loader**                    | `routes/index.tsx:17`, `routes/notifications.tsx:19`, `social/notification-settings.tsx:13`, `routes/communities.index.tsx:38` | Four identical `useLoad(useCallback(() => outcome(myCommunities(), 200), []))` calls instead of a shared `useMyCommunities()` hook like `useMembers` (`social/members.ts:6-8`).                                                                                                                                                              |
| **`useAct` has no `.catch` and unstable `act` identity** | `web/src/social/use-act.ts:13-21`                                                                                              | `void write().then(...)` has no `.catch(...)`; if `write()` ever rejects instead of resolving to an `Outcome`, `busy` stays `true` forever. Also `act` is recreated every render without `useCallback`.                                                                                                                                      |
| **`usePaged` dead-end on continuation error**            | `web/src/social/paged.ts:82`                                                                                                   | If loading a subsequent page fails, `problem !== null` disables the `IntersectionObserver` sentinel permanently with no retry button in `ImagesTab` (`wall.tsx:363`, `routes/communities.$communityId._tabs.images.tsx:30`). Also `append` (`paged.ts:15-25`) rebuilds `new Set(held.items.map(key))` on every page ($O(N^2)$ across pages). |

---

## 4. Rust Core (`core/`): Duplication and SQLite Concurrency

### 4.1 Code Duplication in `core/`

1. **`.part` download-and-rename protocol duplicated in `photo.rs` (`core/client/src/photo.rs:163-225`):**
   `source_to` (`photo.rs:163-190`) and `kept_or_fetched` (`photo.rs:196-225`) implement the exact same temp-file download, rename, cleanup on error, and 404 handling. They have already drifted: `kept_or_fetched` validates `is_id(version)` at line 201, while `source_to` does not.
2. **Duplicate `fn hex(bytes: &[u8]) -> String`:**
   Implemented identically in `core/store/src/lib.rs:805` and `core/client/src/media.rs:291`.
3. **Inline `if !is_id(...)` checks vs `social::id()` helper:**
   `core/client/src/social.rs:35` defines a clean `fn id(text: &str, what: &'static str) -> Result<(), ClientError>`, whereas `account.rs:434,473,476,517,528`, `photo.rs:76,201,273`, and `lib.rs:934,985,1014,1263` write out the `if !is_id(...)` check by hand.

### 4.2 SQLite / SQLCipher Bottlenecks

1. **`export_history` takes an exclusive write lock for a read-only scan (`core/client/src/history.rs:664`):**
   ```rust
   let (rows, media) = self.store.try_write(|tx| records(tx, since))?;
   ```
   `try_write` opens a `TransactionBehavior::Immediate` write transaction (`core/store/src/lib.rs:767-772`), even though `records(tx, since)` (`history.rs:194-320`) only runs `SELECT` queries across conversations, messages, reactions, read states, members, and profiles. While an export is scanning a large database, every incoming message or UI write on the writer connection is blocked.
2. **`import_history` materializes the entire archive in memory before one giant transaction (`core/client/src/history.rs:411-425, 714-716`):**
   `read_stream` buffers every deserialized record into `Vec<Record>` in RAM (up to `MAX_HISTORY` = 1 GiB, `history.rs:35`), and then line 716 writes all of them in a single `try_write` transaction with up to 6 `execute` statements per record.
3. **Outbox `drain()` is a per-message write-transaction loop (`core/client/src/lib.rs:1655-1681`):**
   For each unsent message, `drain()` opens `try_write(|tx| next_unsent(tx, group))` (an `IMMEDIATE` write transaction just to `SELECT` one row), performs the network `send_message` call, and opens a second `try_write` to mark it sent. With $N$ queued messages, that is $2N + 1$ write transactions.
4. **Per-operation `purge` transactions (`core/client/src/lib.rs:1330, 1370, 1380, 1525`):**
   Every sync step opens an additional standalone `try_write` transaction to run `purge` (`lib.rs:1386-1391`), which executes two `DELETE` statements for expired messages (`timeline.rs:756-757`).

---

## 5. Consolidated Action Plan (All Phases)

### Tier 1: Correctness & Security Fixes (Immediate, Small PRs)

1. **Backend — Cancel unread body on community image 404/403** (`backend/src/modules/communities/images.ts:80-81`).
2. **Backend — Check moderator suspension in `moderation/actions.ts` and `reports.ts`** (or document in decision 0115 if suspended moderators are meant to keep moderation powers).
3. **Backend — Scope upload `try / catch` blocks** (`profiles/photos.ts:99-104`, `social/upload.ts:36-41`, `messaging/routes.ts:156-168`, `group-photo-routes.ts:28-33`) so D1/R2 errors are not masked as `400 invalid_request`.
4. **Web — Clear `Cover` `src` when switching communities** (`web/src/social/avatar.tsx:182`: call `setSrc(null)` unconditionally before fetching, matching `Avatar` at line 131).
5. **Android — Catch `Throwable` (rethrow `CancellationException`) and add `busy` guard to `FriendsViewModel`** (`BaseViewModel` + `FriendsViewModel.kt:148`).
6. **Android — Rename `SuggestionSettingViewModel.run` to `readAfter`** (`SuggestionSetting.kt:46,55`) so it does not shadow `kotlin.run`.
7. **Contract — Add `request_refused`, `request_limit`, `friend_limit` vectors** to `api/presentation.vectors.json`.

### Tier 2: High-Leverage Deduplication (Medium PRs)

1. **Backend — Upload & error helpers**: Extract `cancelBody(c)` and shared `STATUS`/`refusal` to `backend/src/shared/errors.ts`; extract `readExactly` and `TAKEN` to `backend/src/shared/images.ts`; parameterize `takeUpload` with an explicit rate-limit key and separate `"imports"` from `"photos"`.
2. **Backend — Messaging membership helper**: Extract `requireConversationMember` across the 7 call sites in `backend/src/modules/messaging/`.
3. **Android & iOS — Screen base types**: Introduce `BaseViewModel<S : ScreenState<S>>` on Android and `ScreenModel` protocol + `.problemCard(problem:retry:)` modifier on iOS.
4. **Web — Reuse existing hooks**: Replace `Preview` in `comment-composer.tsx:15-24` with `useObjectUrl`; unify `REFUSED` in `image-problem.tsx` and use `<ImageProblem>` in `composer.tsx` and `comment-composer.tsx`; extract `useMyCommunities()`.
5. **Core — Unify `.part` download in `photo.rs:163-225` and `hex()` in `store`/`media`.**

### Tier 3: Performance & Scalability Bottlenecks (Targeted PRs)

1. **Backend — Batch `reportPage` (`reports.ts:255-280`) and fix `CASE` in `WHERE` (`reports.ts:215-216`)** so loading a report queue does not trigger 50 DO calls and full-table scans.
2. **Web — Cache/deduplicate post images (`viewer.tsx:15-34`) and group photos (`chat/group-photo.ts:58-98`)** using bounded LRU/version maps like `avatar.tsx`.
3. **Core — Read-only transaction for `export_history` (`history.rs:664`) and read query in `drain()` (`lib.rs:1656`)** so reads do not hold `BEGIN IMMEDIATE` write locks.
4. **Backend — Add missing composite index `(community_id, created_at, post_id)` on `post_index` and `(state, closed_at)` on `reports`.**
