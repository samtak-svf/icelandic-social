#!/usr/bin/env bash
# swift-format lint (lint.sh), then the iOS unit tests in a simulator, signed
# ad hoc. ios.yml runs this, and so does tooling/mac-remote.mjs on a Mac of our
# own, so the two cannot drift.
#
# Every run clones its own simulator and deletes it on exit. Two runs at once
# (a PR and main, or a mac-remote run) used to share one device, and the second
# install failed with "Busy (Application failed preflight checks)".
#
#   ios/scripts/test.sh             the core fetched and the project generated already (CI)
#   ios/scripts/test.sh --prepare   fetch the core when the lock changed, then xcodegen first
#
# SPJALL_DERIVED_DATA keeps the build outside the checkout on a Mac that is
# reused, which is what makes the second run incremental. Each checkout gets a
# directory of its own under it: two worktrees on different cores that shared
# one compiled each other's stale SpjallCore module ("cannot find
# 'uniffi_spjall_core_checksum_…' in scope"). By default it is ios/build, which
# a hosted runner throws away.
set -euo pipefail

IOS=$(cd "$(dirname "$0")/.." && pwd)
ROOT=$(dirname "$IOS")
DERIVED=${SPJALL_DERIVED_DATA:+$SPJALL_DERIVED_DATA/$(basename "$ROOT")}
DERIVED=${DERIVED:-build}
# Its own log too, so the check at the end never reads another run's.
LOG=$(mktemp "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/xcodebuild-test.XXXXXX")

if [ "${1:-}" = "--prepare" ]; then
  # cargo xtask fetch downloads and verifies every time; the stamp skips it
  # while the lock is the one the present core was fetched for.
  stamp="$IOS/Packages/SpjallCore/.artifact.lock.json"
  if ! cmp -s "$ROOT/core/artifact.lock.json" "$stamp" 2>/dev/null; then
    (cd "$ROOT/core" && cargo xtask fetch ios)
    cp "$ROOT/core/artifact.lock.json" "$stamp"
  fi
  (cd "$IOS" && xcodegen generate --quiet)
fi

"$IOS/scripts/lint.sh"

# The newest runtime's first iPhone is only the template: tests never run on it.
TEMPLATE_UDID=$(xcrun simctl list devices available -j | jq -r '[.devices | to_entries[] | select(.key | startswith("com.apple.CoreSimulator.SimRuntime.iOS-")) | {runtime: .key, devices: [.value[] | select(.name | startswith("iPhone"))]} | select(.devices | length > 0)] | sort_by(.runtime) | (last // {}) | (.devices // []) | .[0] | .udid? // empty')
if [ -z "$TEMPLATE_UDID" ]; then
  xcrun simctl list devices available
  echo "::error::no available iPhone simulator"
  exit 1
fi

# A crashed run leaves its clone behind. Only spjall-test-* devices older than
# 2 hours (birth time of the device directory) are touched; a failure here
# never fails the run. The device directory, not its data/ inside: a clone's
# data/ keeps the template's birth time, so a run clone seconds old looks
# hours old there, and a second run on the same Mac deleted it mid-test.
now=$(date +%s)
xcrun simctl list devices -j \
  | jq -r '.devices[][] | select(.name | startswith("spjall-test-")) | "\(.udid) \(.dataPath // "")"' \
  | while read -r udid data; do
    born=$(stat -f %B "${data%/data}" 2>/dev/null || echo "$now")
    if [ $((now - born)) -gt 7200 ]; then
      xcrun simctl shutdown "$udid" 2>/dev/null || true
      xcrun simctl delete "$udid" 2>/dev/null || true
    fi
  done || true

SIM_UDID=
cleanup() {
  if [ -n "$SIM_UDID" ]; then
    xcrun simctl shutdown "$SIM_UDID" 2>/dev/null || true
    xcrun simctl delete "$SIM_UDID" 2>/dev/null || true
  fi
}
# EXIT also fires on failure; the signals turn an interrupt into an exit.
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
# Only a shut-down device can be cloned; a run from before this script may
# have left the template booted.
clone_name="spjall-test-${GITHUB_RUN_ID:-local}-$$"
SIM_UDID=$(xcrun simctl clone "$TEMPLATE_UDID" "$clone_name" 2>/dev/null) || {
  xcrun simctl shutdown "$TEMPLATE_UDID" 2>/dev/null || true
  SIM_UDID=$(xcrun simctl clone "$TEMPLATE_UDID" "$clone_name")
}
xcrun simctl boot "$SIM_UDID"
xcrun simctl bootstatus "$SIM_UDID" -b >/dev/null

if command -v xcpretty >/dev/null; then pretty=(xcpretty)
elif command -v xcbeautify >/dev/null; then pretty=(xcbeautify --quiet)
else pretty=(cat); fi

# -skipPackagePluginValidation: swift-openapi-generator's build plugin
# would otherwise wait for a trust prompt no CI runner can answer.
# Signed ad hoc ("Sign to Run Locally", no team): an unsigned app has no
# application identifier, and the simulator's Keychain refuses it
# (errSecMissingEntitlement), which the store key test needs.
cd "$IOS"
xcodebuild test \
  -project Spjall.xcodeproj \
  -scheme Spjall \
  -destination "id=$SIM_UDID" \
  -configuration Debug \
  -derivedDataPath "$DERIVED" \
  -skipPackagePluginValidation \
  CODE_SIGN_IDENTITY=- \
  CODE_SIGNING_ALLOWED=YES \
  CODE_SIGNING_REQUIRED=NO \
  | tee "$LOG" | "${pretty[@]}"

# A build that compiles and runs nothing is not a pass.
grep -E 'Executed [1-9][0-9]* tests?, with 0 failures' "$LOG"
