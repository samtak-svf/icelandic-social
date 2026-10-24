//! The core in a browser Web Worker (decision 0081): the blocking client over
//! a synchronous `XMLHttpRequest`, with its store and its blobs in one OPFS
//! pool under one key.
//!
//! The modules that need a browser are compiled for `wasm32-unknown-unknown`
//! only; the rest builds and tests natively, so `cargo test --workspace` and
//! clippy cover it.

pub mod blobs;
pub mod dto;
pub mod error;
pub mod qr;
pub mod request;

#[cfg(all(target_arch = "wasm32", target_os = "unknown"))]
mod api;
#[cfg(all(target_arch = "wasm32", target_os = "unknown"))]
pub mod xhr;
