#!/usr/bin/env bash
# swift-format in strict mode over the iOS sources (config: ios/.swift-format).
# ios.yml runs this, and so does test.sh, which tooling/mac-remote.mjs runs on
# a Mac of our own, so a format error fails the same way locally and in CI.
#
#   ios/scripts/lint.sh
set -euo pipefail

cd "$(dirname "$0")/.."
# xcrun finds swift-format on a Mac; elsewhere it is the swift-format on PATH.
if command -v xcrun >/dev/null 2>&1; then swift_format=(xcrun swift-format); else swift_format=(swift-format); fi
"${swift_format[@]}" lint --strict --recursive App NotificationService Shared Tests
