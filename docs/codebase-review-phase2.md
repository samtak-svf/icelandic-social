# Phase 2 Codebase Review: Deep Dive (Uploads, ViewModels)

_Date:_ 2026-11-01  
_Reviewer:_ AI Agent (deep exploration via subagents)  
_Purpose:_ Detailed analysis of upload pipeline and ViewModel patterns to inform targeted refactoring

## Executive Summary

This phase digs into the two highest-value duplication areas identified in Phase 1: the image/upload handling in the backend, and the ViewModel/Model boilerplate in Android and iOS.

Key findings:

1. **Upload pipeline** - `takeUpload()` exists but is used in only 2 of 10 upload paths. The preamble mechanics are copy-pasted 5-7 times with real behavioral differences (especially around body cancellation, rate limiting scope/keys, error handling scope). Some differences are intentional (streaming vs buffering, compensation strategies), others are bugs or inconsistencies.
2. **ViewModels/Models** - There is massive boilerplate duplication, but it's more complex than "identical copy-paste". Android has 4 distinct `perform()` variants plus 12 inline implementations; iOS has 7 copies + 10 inlined. There are also real behavioral divergences (Android crashes on `InternalException` from Rust panics because it only catches `CoreException`; iOS handles all throwables).

The refactoring paths are clear, but must be done carefully to preserve intentional differences and fix real bugs.

## 1. Upload Pipeline Deep Dive

### Current State

| Route                                    | Handler                                      | Uses `takeUpload`              | Max Size                             | Rate Limit Key                              | Cancels on pre-access refusal     | Notes                                    |
| ---------------------------------------- | -------------------------------------------- | ------------------------------ | ------------------------------------ | ------------------------------------------- | --------------------------------- | ---------------------------------------- |
| `PUT /v1/me/photo`                       | `profiles/photos.ts`                         | ✓                              | 10 MB (`MAX_PHOTO_UPLOAD`)           | `accountId` (photos budget)                 | Yes                               | Includes D1 write in try/catch scope     |
| `PUT /v1/communities/{id}/avatar\|cover` | `communities/images.ts`                      | ✓                              | 10 MB                                | `accountId` (photos budget)                 | **No** on 404/403 before preamble | Bug: body not cancelled on access denial |
| `PUT /v1/wall/cover`                     | `communities/wall-images.ts`                 | Via `uploadedImage`            | 10 MB                                | `accountId` (photos budget)                 | Yes                               | Wrapped with `notSuspended`              |
| `POST /v1/communities/{id}/media`        | `social/routes.ts` → `social/upload.ts`      | Reimplemented                  | 10 MB (`MAX_SOCIAL_UPLOAD`)          | **`social:${accountId}`** (separate budget) | Yes                               | Only social uploads use separate budget  |
| `POST /v1/wall/media`                    | `social/wall-routes.ts`                      | `storedUpload` (reimplemented) | 10 MB                                | `social:${accountId}`                       | Yes                               | Wrapped with `notSuspended`              |
| `PUT /v1/conversations/{c}/media/{m}`    | `messaging/routes.ts` → `messaging/media.ts` | Reimplemented                  | ~25 MB ciphertext (`MAX_CIPHERTEXT`) | **None**                                    | Yes                               | Streams to R2, D1-row-first compensation |
| `PUT /v1/conversations/{c}/photo/{m}`    | `messaging/group-photo-routes.ts`            | Reimplemented                  | 1 MB (`MAX_GROUP_PHOTO`)             | **None**                                    | Yes                               | Object-first with compensation           |
| `PUT /v1/imports/{id}/parts/{n}`         | `imports/routes.ts` → `file.ts`              | Via `partRequest`              | 64 MiB                               | **None** (limited at create/publish)        | Yes                               | Multi-part import system                 |
| `PUT /v1/history/{id}/parts/{n}`         | `history/routes.ts`                          | Via `partRequest`              | 64 MiB                               | **None**                                    | Yes                               | Multi-part history transfer              |

### Critical Issues Found

1. **Body not cancelled on community image access denial** (`communities/images.ts:80-81`): When a non-moderator tries to upload to a community avatar/cover, we return 404/403 _before_ calling `takeUpload()`. Unlike `uploadSocialMedia()` which cancels on 404/403, this leaves the HTTP body unread. `drainBody()` only drains ≤64KB, so for 10MB uploads the connection may reset badly. This is the only place where the "copied preamble" diverges from the real one in an observable way.

2. **Rate limit budget sharing is unintended**: Profile photos, community images, wall covers, and _all_ import operations (create/publish/page/connection) all use the bare `accountId` against the `photos` budget (10 req/60s). Social media uses a separate `social:` key. This means uploading import parts could exhaust the photo upload budget and vice versa.

3. **Catch blocks are too broad**: Most paths catch the entire `storeImage`/`putMedia`/etc. call and return 400 "invalid_request". This swallows R2/D1 failures and turns them into client errors with misleading messages. Only `communities/images.ts` scopes the catch to just the body consumption step (correctly). A DB outage becomes a 400.

4. **Inconsistent logging**: `photo.set`/`community.*_set` log the stored (legacy frame) size; `social_media.stored` logs the uploaded request length; `putMedia`/`putGroupPhoto` log nothing. Three different meanings for `size`. Rate limit refusals all log code `"photos"` even when using different budgets or different purposes.

5. **No rate limiting on large uploads**: 25MB ciphertext media, 1MB group photos, 64MB import/history parts have no per-account rate limits at all. Only membership checks protect them.

6. **Orphaned objects possible**: `putMedia` does D1-row-first with compensation (deletes row on failure), `putGroupPhoto` does object-first with old-key cleanup, `storeImage` writes master then frames with no compensation. A failed D1 insert after successful R2 upload can leave orphaned objects.

### Safe Unifications

| Extraction                                         | Effort  | Risk | Notes                                                                       |
| -------------------------------------------------- | ------- | ---- | --------------------------------------------------------------------------- |
| `cancelBody(c)` in `shared/errors.ts`              | Trivial | None | Replace 7 identical closures                                                |
| `contentLength(request)` predicate                 | Trivial | None | Unify 3 implementations of the same check                                   |
| `readExactly(stream, size)` to `shared/streams.ts` | Trivial | None | Identical FixedLengthStream pattern in 2 places                             |
| Make `takeUpload` take `limitKey` parameter        | Small   | Low  | Currently hardcodes `photos` key; social uploads need `social:${accountId}` |
| Extract `imagesRefusalCode(error)`                 | Trivial | None | Duplicated in shared/images.ts and social/media.ts                          |
| Share `TAKEN` format set                           | Trivial | None | Duplicated verbatim                                                         |

### Must Stay Separate

- **Store order/compensation** - R2-objects-first vs D1-row-first vs object-then-row are intentional for different failure modes
- **Buffering vs streaming** - Images buffer for Cloudflare Images API (max 10MB), messaging streams directly to R2 (25MB ciphertext kept out of memory per decision 0023)
- **Size limits** - Different resources have different limits with different OpenAPI descriptions; changing them affects contracts
- **Error code sets** - `409 conflict`, `409 no_master`, `410 expired`, `403 not_this_device` are resource-specific and watched by clients/core
- **Rate limiting policy** - Presence and keys are product decisions that would change behavior if generalized
- **Suspension wrapping** - Per-route, enumerated in tests
- **Log semantics** - Different domains have different observability needs

### Recommended Fix Order

1. **Fix the body-cancellation bug** in `communities/images.ts:80-81` (immediate)
2. **Scope catch blocks** to only body consumption (fixes misleading error codes, prevents swallowing real failures)
3. **Give imports their own limit key** or document sharing; fix misleading log codes
4. **Move `takeUpload` to `shared/upload.ts`** (no longer purely image-related)
5. **Extract mechanical helpers** once structure is clean

## 2. ViewModel/Model Pattern Deep Dive

### Architecture Differences

| Aspect          | Android (Kotlin)                                                                   | iOS (Swift)                                                              |
| --------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Base            | `ViewModel` from androidx.lifecycle                                                | Plain `@MainActor @Observable final class`                               |
| State           | Immutable `data class State` in nested class, `MutableStateFlow` + `asStateFlow()` | Flat mutable `private(set)` properties on the class                      |
| Observation     | `collectAsStateWithLifecycle()`                                                    | `@Observable` macro                                                      |
| Async           | `viewModelScope.launch`, `withContext(io)`                                         | `async` methods called from `.task { }`, `Task.detached` via `offMain()` |
| Error           | `CoreException`/`IOException` → `Problem` via `Throwable.problem()`                | Any `Error` → `Problem(error)`                                           |
| Retry           | `private var failed: (() -> Unit)?` + `fun retry()`                                | `private var failed: (() async -> Void)?` + `func retry() async`         |
| One-shot events | `Channel` + `receiveAsFlow()`                                                      | Mutable optional property watched by view, cleared by method             |

### Android ViewModels (24 total)

Of the 14 specifically mentioned in Phase 1:

| ViewModel                    | Has `perform`          | `loaded` | `busy` guard    | `loaded=true` on fail | Notes                                                                                |
| ---------------------------- | ---------------------- | -------- | --------------- | --------------------- | ------------------------------------------------------------------------------------ |
| `MeViewModel`                | Yes (variant B)        | No       | Yes             | N/A                   | Two problem sinks (`problem`, `photoProblem`) via `shown` param; progressive updates |
| `PeopleViewModel`            | Yes (variant A)        | Yes      | Yes             | Yes                   | Standard                                                                             |
| `SignInViewModel`            | **No**                 | No       | Yes (inline)    | N/A                   | Retry reconstructed from `SavedStateHandle`, no `failed` slot                        |
| `JoinRequestsViewModel`      | Yes (A')               | Yes      | Yes             | Yes                   | Refetches inside action                                                              |
| `CreateCommunityViewModel`   | **No**                 | No       | Inline guard    | N/A                   | No retry; swallows refusals intentionally                                            |
| `AnonymousQueueViewModel`    | Yes (A')               | Yes      | Yes             | Yes                   | Standard                                                                             |
| `CommunitiesViewModel`       | **No** (inline)        | Yes      | Yes (load only) | Yes                   | Hand-written load/page/moreFeed/pin/react                                            |
| `CommunityViewModel`         | Yes (variant A)        | Yes      | Yes             | Yes                   | Standard                                                                             |
| `FriendsViewModel`           | Yes (variant C)        | Yes      | **No guard!**   | Yes                   | Missing busy guard - latent race condition                                           |
| `NotificationsViewModel`     | **No** (inline)        | Yes      | Yes (load only) | Yes                   | Has `change(rollback, call)` for optimistic updates                                  |
| `PersonViewModel`            | Yes (A') + `attempt()` | Yes      | Yes             | Yes                   | Parallel mechanism for different error handling                                      |
| `PostViewModel`              | **No** (inline)        | Yes      | Yes (load only) | Yes                   | Optimistic likes with rollback                                                       |
| `StatementsViewModel`        | Yes (A')               | Yes      | Yes             | Yes                   | Standard                                                                             |
| `SuggestionSettingViewModel` | **No**                 | No       | Yes (inline)    | N/A                   | Uses member `run()` which shadows `kotlin.run` - dangerous                           |

**4 distinct `perform()` bodies exist:**

- **A** - Standard: guard busy, set busy/problem, launch, try withContext(io), clear failed, set busy false; catch sets failed/again, busy false, loaded true, problem
- **A'** - Like A but action returns/fetches data and writes result in success branch
- **B** (Me) - Adds `shown` projector for problem destination, catches `IOException` separately
- **C** (Friends) - **No busy guard**, adds `onDone` callback

### iOS Models (28 total, 7 mentioned + 10 inlined)

| Model                | Has `perform` | `loaded`   | Divergence                                                      | Notes                      |
| -------------------- | ------------- | ---------- | --------------------------------------------------------------- | -------------------------- |
| `MeModel`            | Yes           | **Absent** | Omits `loaded = true` in catch (by design - no loaded property) | Opts out intentionally     |
| `PeopleModel`        | Yes           | Yes        | None (canonical)                                                | Reference implementation   |
| `ReportsModel`       | Yes           | Yes        | Sets `done = false` at start                                    | Real behavioral difference |
| `CommunitiesModel`   | Yes           | Yes        | None                                                            | Standard                   |
| `CommunityModel`     | Yes           | Yes        | None                                                            | Standard                   |
| `NotificationsModel` | Yes           | Yes        | None                                                            | Standard                   |
| `PostModel`          | Yes           | Yes        | None                                                            | Standard                   |

The 5 byte-identical copies (`People`, `Communities`, `Community`, `Notifications`, `Post`) + `ReportsModel` (identical + done reset) + `MeModel` (identical - loaded assignment). 10 more models have inlined versions.

### Critical Bugs/Issues Found

1. **Android crashes on Rust panics**: `InternalException("Rust panic")` from core bindings is NOT a `CoreException`. Android `perform()` only catches `CoreException` (and sometimes `IOException`), so Rust panics escape `viewModelScope` with no handler → app crash. iOS catches everything and shows `ProblemCard`. Same Rust core, different crash behavior.

2. **FriendsViewModel has no busy guard**: Can fire concurrent requests, causing race conditions. iOS `FriendsModel` uses a ticket/counter to ignore stale results, but Android has no equivalent protection.

3. **SuggestionSettingViewModel.run() shadows kotlin.run**: Member function named `run` shadows the standard library `run{}`. If renamed/removed/refactored by IDE, the friend suggestions toggle in "Ég" will silently disappear. This is a landmine.

4. **Cancellation handling differs badly**: Android lets `CancellationException` escape (VM cleared, harmless); iOS catches it and shows a problem card (bad UX). Neither is ideal, but they're different.

5. **MeModel.perform divergence is misunderstood**: Phase 1 said "omits loaded = true" as a bug, but MeModel has no `loaded` property at all - it's intentional because "Ég" determines state differently (`me == nil` check).

### Proposed Solution

#### Android: `BaseViewModel<S : ScreenState<S>>`

```kotlin
interface ScreenState<S : ScreenState<S>> {
    val busy: Boolean
    val problem: Problem?
    fun busy(on: Boolean): S
    fun trouble(problem: Problem?): S
    fun answered(): S = this  // Override for states that track "has answer arrived"
}

abstract class BaseViewModel<S : ScreenState<S>>(
    initial: S,
    protected val io: CoroutineDispatcher = Dispatchers.IO,
) : ViewModel() {
    private val _state = MutableStateFlow(initial)
    val state: StateFlow<S> = _state.asStateFlow()
    protected val current: S get() = _state.value
    protected fun edit(change: (S) -> S) = _state.update(change)

    private var failed: (() -> Unit)? = null
    fun retry() { failed?.invoke() }

    protected fun perform(
        again: () -> Unit,
        shown: (S, Problem) -> S = { state, problem -> state.trouble(problem).answered() },
        action: suspend () -> Unit,
    ) {
        if (current.busy) return
        edit { it.busy(true).trouble(null) }
        viewModelScope.launch {
            try {
                withContext(io) { action() }
                failed = null
                edit { it.busy(false) }
            } catch (e: CancellationException) {
                throw e  // Don't treat cancellation as failure
            } catch (e: Throwable) {  // Catch everything including InternalException!
                failed = again
                edit { shown(it, e.problem()) }
            }
        }
    }
}
```

Key improvements: catches `Throwable` (fixes the crash bug), rethrows `CancellationException`, allows custom problem routing via `shown`.

#### iOS: `ScreenModel` Protocol

```swift
@MainActor
protocol ScreenModel: AnyObject {
    var busy: Bool { get set }
    var loaded: Bool { get set }
    var problem: Problem? { get set }
    var failed: (() async -> Void)? { get set }
}

extension ScreenModel {
    var loaded: Bool {
        get { true }   // Default for models without loaded
        set {}
    }

    func retry() async { await failed?() }

    func perform(again: @escaping () async -> Void, _ action: () async throws -> Void) async {
        guard !busy else { return }
        busy = true
        problem = nil
        do {
            try await action()
            failed = nil
        } catch is CancellationError {
            // Screen gone, not a failure
        } catch {
            failed = again
            loaded = true
            problem = Problem(error)
        }
        busy = false
    }
}
```

### Migration Strategy

**Do NOT create a cross-platform base type** - Android uses immutable StateFlow with `data class`, iOS uses mutable `@Observable` properties. The architectures are fundamentally different. Instead, maintain a shared **test checklist** of 6 proofs that must pass on both platforms.

**Android migration order:**

1. Create base classes + tests (prove the 6 behaviors including InternalException handling)
2. Migrate the 4 with identical `perform` bodies: `CommunityViewModel`, `JoinRequestsViewModel`, `StatementsViewModel`, `AnonymousQueueViewModel`
3. Migrate `PeopleViewModel` (A' variant), extract inline prologues from `Communities`, `Notifications`, `Post`
4. `FriendsViewModel` - adopt base AND add busy guard (intentional behavior change, needs new test)
5. `MeViewModel` - use `shown` projector for photoProblem
6. `CreateCommunityViewModel`, `SuggestionSettingViewModel` - adopt busy discipline only, no retry; rename `SuggestionSetting.run()` to avoid shadowing
7. `FeedViewModel` - rename fields to match base terminology
8. **Leave `SignInViewModel`** - retry is reconstructed from `SavedStateHandle`, cannot use `failed` slot
9. `ConversationViewModel` last (complex due to socket)

**iOS migration order:**

1. Create `ScreenModel.swift` protocol + extension + tests
2. Migrate 5 byte-identical bodies (`People`, `Communities`, `Community`, `Notifications`, `Post`)
3. Migrate `ReportsModel` (move `done = false` into actions)
4. `MeModel` conforms with no `loaded` (using default)
5. Migrate 10 inlined models
6. Consider adding generation counter to base for `FriendsModel` (or keep its ticket)

### Verification

```bash
# Android (on samtak-mac via mac-remote, or if local)
node tooling/mac-remote.mjs -- android/scripts/test.sh

# iOS (macOS only)
ios/scripts/lint.sh
ios/scripts/test.sh --prepare
```

Files that may need updating: `tooling/line-count.allow.json` (shrink-only policy - many grandfathered large files). The new base package won't trigger module guards.

## Recommendations for Phase 3

Based on these deep dives, I'd prioritize:

1. **Immediate fixes (low risk):** Fix body cancellation in `communities/images.ts`, scope catch blocks in upload handlers, fix `FriendsViewModel` busy guard on Android, fix `SuggestionSettingViewModel.run()` shadowing
2. **Upload extraction:** Extract `cancelBody`, `contentLength`, `readExactly` helpers; make `takeUpload` take `limitKey`; consider moving to `shared/upload.ts`
3. **ViewModel base:** Start with Android base + migrate the 4 identical ViewModels as proof of concept; do iOS in parallel
4. **Pagination unification:** (from Phase 1) Create `shared/pagination.ts` for backend cursor parsing

The ViewModel extraction is higher value because it will fix the real crash bug (`InternalException` not caught) and prevent future bugs. The upload extraction is valuable for maintainability but most differences are intentional.
