//! The engine's one clock. `std::time` traps on wasm32 in a browser, so
//! there the time comes from JavaScript through `web-time`: `Date.now()`, the
//! clock sqlite-wasm-rs gives SQLite. The core's `now()` and the store's
//! `unixepoch()` then agree on when a disappearing message expires.

#[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
pub(crate) use std::time::{Instant, SystemTime, UNIX_EPOCH};
#[cfg(all(target_arch = "wasm32", target_os = "unknown"))]
pub(crate) use web_time::{Instant, SystemTime, UNIX_EPOCH};

/// Now, in milliseconds since the Unix epoch.
pub(crate) fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as i64)
}
