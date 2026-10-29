# 0113. A hosted call never waits for a sync

- Status: accepted; implemented (#357)
- Date: 2026-10-29
- Decided by: Guðröður Atli Jónsson
- Builds on [0056](0056-a-read-never-waits-for-the-network.md)

## Decision

- **A call that only asks the server takes no lock of the `Client`.** The core hands out a
  `Hosted` handle (`Client::hosted`): a copy of the transport, the `Spjall-Client` value and a
  share of the device token. The FFI keeps one beside its `Client`, and the profile
  (`me`), the notifications and every social call that touches neither the store nor the files go
  through it.
- **The token is shared, not copied.** The `Client` writes it through one function when a device
  signs in, links or signs out, and a `Hosted` reads it by cloning it out of a read lock that is
  released before the request goes out. A sign-out reaches every handle at once.
- **What stays on the `Client`** is what touches the store, the blobs or the outcome: the calls
  that write a row, keep a file (`set_community_avatar`, `set_community_cover`,
  `upload_social_media`, `post_media`) or fold a result into the store (`blocked`).
- **The apps show each answer as it arrives.** The profile screen starts the profile and the
  blocked list first and publishes each as it returns; what is local is read while they wait,
  through the `View` (0056), so the invite link never takes the `Client` lock.

## Why

Decision 0056 moved the reads of local data off the lock a sync holds. The server-only calls
still took it: on 2026-10-29 a sync made 37 serial requests over 9 seconds on mobile data (Workers
Logs, 18:23:45 to 18:23:54 UTC), and the profile and notification screens stayed blank until it
ended, because `me` and every notification call waited for the same lock.

## Rules out

- A server-only call that takes the `Client` lock. A new method that needs only the transport and
  the token is added to `Hosted`, and the FFI method calls `self.hosted`, never `self.client()`.
- A local read behind the `Client` lock on a screen's first load. The first measurement of 0.17.6
  (2026-10-29 20:52 UTC) still had `/v1/me` arriving after the sync, because the profile screen
  read its invite link through the `Client` before asking for the profile.
- A disk cache of the profile to hide the wait. The wait was a lock, not the network, and a cache
  would show a stale name and device list to fix a delay that no longer exists.
