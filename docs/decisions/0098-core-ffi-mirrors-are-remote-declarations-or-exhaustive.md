# 0098. The ffi mirrors of client types are remote declarations or exhaustive conversions

- Status: accepted; implemented in `core/ffi`, `core/wasm` and `tooling/core-dto-guard.mjs` (#267)
- Date: 2026-10-26
- Decided by: Guðröður Atli Jónsson

## Decision

- **A client type the apps see unchanged is declared in `core/ffi` with
  `#[uniffi::remote(Record)]` / `#[uniffi::remote(Enum)]`**, importing the client's own type
  (`pub use spjall_client::api::Author;`). There is no second struct and no `From` pair. The
  declaration lists the fields UniFFI generates bindings from, and the macro builds and
  destructures the real type from that list, so a field added to, removed from or retyped on
  the client type fails the ffi build until the declaration follows.
- **A mirror that renames, converts or drops something stays a separate type**, and its
  `impl From` destructures the source by name: every field listed, `field: _` with a reason for
  one dropped, no `..`, and an enum match with no `_ =>` arm. The same holds for the wasm view
  in `core/wasm/src/dto.rs` and for the closures that convert a nested struct. A field added to
  the client type is then a compile error in every mirror.
- **`tooling/core-dto-guard.mjs` (`check:core-dto`, pre-push) enforces the second rule** on
  every `impl From` in `core/ffi/src` and `core/wasm/src/dto.rs`: a field read of the
  parameter or of a closure parameter, a `..` in a destructuring of the parameter, or a `_ =>`
  arm in a match on it fails.

## Why

The ffi crate held about 80 `From` impls, a third of them pure field copies. Each was a place
where a field added to a client type compiled and was silently absent from the apps. Removing
the copies removes the places; making the rest exhaustive turns the remaining ones into
compile errors instead of review findings.

Deriving `uniffi::Record` on the client types themselves (an optional `uniffi` feature on
`spjall-client`, with `uniffi::setup_scaffolding!()` there) was tried first and rejected: UniFFI
gives a type its crate's namespace, so the types left `spjall_core` for a second namespace.
Measured with uniffi 0.32.2, the Kotlin moved to `uniffi.spjall_client` in its own file, and Swift
gained a second module (`spjall_client.swift`, `spjall_clientFFI.h`, a second modulemap). The apps
would have imported from two places, and the client crate would depend on UniFFI. The remote
declaration keeps every type in the `spjall_core` namespace: the Kotlin and Swift generated
before and after the change are byte-identical (`diff -r` over `kotlin/` and `swift/`, docs
included).

## What it rules out

- UniFFI derives on `core/client` types, and a `uniffi` dependency or feature in that crate.
- A new pure-copy mirror with a `From` pair: declare the client type remotely instead.
- A remote declaration for a type the ffi mirror gives `Eq` that the client type lacks (`Focus`,
  `FrameRect` hold `f64`): the orphan rule forbids the `impl`, so those two stay mirrors.
