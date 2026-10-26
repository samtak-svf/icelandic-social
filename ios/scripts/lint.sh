#!/usr/bin/env bash
# swift-format in strict mode over the iOS sources (config: ios/.swift-format).
# ios.yml runs this, and so does test.sh, which tooling/mac-remote.mjs runs on
# a Mac of our own, so a format error fails the same way locally and in CI.
#
#   ios/scripts/lint.sh
set -euo pipefail

cd "$(dirname "$0")/.."
xcrun swift-format lint --strict --recursive App NotificationService Shared Tests
