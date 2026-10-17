#!/usr/bin/env bash
# Builds both sides of the spike and runs tests/interop.mjs. Needs the
# wasm32-unknown-unknown target, clang (sqlite-wasm-rs builds SQLite with it)
# and wasm-bindgen-cli at the version Cargo.lock pins.
set -euo pipefail
cd "$(dirname "$0")/.."
target="$(realpath -m "${CARGO_TARGET_DIR:-target}")"
cargo build --release -p spjall-web-spike --bin native
# Twice: rusqlite's plain SQLite on wasm32, where `PRAGMA key` is ignored and
# the file is plaintext, then with SQLite3 Multiple Ciphers, where it is not.
for features in "" sqlite3mc; do
  echo "== browser side with features: ${features:-none}"
  cargo build --release -p spjall-web-spike --lib --target wasm32-unknown-unknown \
    ${features:+--features "$features"}
  pkg="$target/web-spike-pkg${features:+-$features}"
  wasm-bindgen --target nodejs --out-dir "$pkg" \
    "$target/wasm32-unknown-unknown/release/spjall_web_spike.wasm"
  # wasm-bindgen's nodejs output is CommonJS; inside the repo the root
  # package.json would make Node load it as an ES module.
  echo '{ "type": "commonjs" }' >"$pkg/package.json"
  ls -l "$pkg/spjall_web_spike_bg.wasm"
  node web-spike/tests/interop.mjs "$pkg" "$target/release/native" "${features:+encrypted}"
done
