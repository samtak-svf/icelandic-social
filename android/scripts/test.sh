#!/usr/bin/env bash
# The Android checks, and the instrumented tests in an emulator, on a Mac of
# our own set up by tooling/mac-bootstrap.sh. Run it from Linux with
# tooling/mac-remote.mjs; the emulator never runs on the Linux workstation.
#
#   android/scripts/test.sh              ktlint, detekt, lint, unit tests, assembleDebug
#   android/scripts/test.sh --connected  connectedDebugAndroidTest on the AVD spjall-test
#
# --connected reuses a device adb already lists; otherwise it boots the AVD,
# headless, and stops only an emulator it started itself.
set -euo pipefail

if [ "$(uname -s)" != "Darwin" ]; then
  echo "android/scripts/test.sh runs on the Mac only: the emulator never runs on the Linux workstation." >&2
  echo "Use: node tooling/mac-remote.mjs -- android/scripts/test.sh --connected" >&2
  exit 1
fi

ANDROID=$(cd "$(dirname "$0")/.." && pwd)
ROOT=$(dirname "$ANDROID")
export ANDROID_HOME=${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}
export JAVA_HOME=${JAVA_HOME:-$(/usr/libexec/java_home -v 21)}
export PATH="$HOME/.cargo/bin:/opt/homebrew/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
AVD=spjall-test
BOOT_TIMEOUT=300
EMULATOR_LOG=${TMPDIR:-/tmp}/spjall-emulator.log

# cargo xtask fetch downloads and verifies every time; the stamp skips it
# while the lock is the one the present core was fetched for. libs/ is
# gitignored, and so is the stamp inside it.
stamp="$ANDROID/core/crypto/libs/.artifact.lock.json"
if ! cmp -s "$ROOT/core/artifact.lock.json" "$stamp" 2>/dev/null; then
  (cd "$ROOT/core" && cargo xtask fetch android)
  cp "$ROOT/core/artifact.lock.json" "$stamp"
fi

cd "$ANDROID"
if [ "${1:-}" != "--connected" ]; then
  ./gradlew --console=plain check assembleDebug
  exit
fi

emulator_pid=
cleanup() {
  if [ -n "$emulator_pid" ]; then
    adb emu kill >/dev/null 2>&1 || true
    kill "$emulator_pid" 2>/dev/null || true
    wait "$emulator_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT

if adb devices | awk 'NR > 1 && $2 == "device"' | grep -q .; then
  echo "==> reusing the device adb lists"
else
  echo "==> booting $AVD (log: $EMULATOR_LOG)"
  # Ignoring SIGHUP survives exec; macOS nohup also detaches from the console,
  # which a runner under launchd cannot do, so it exits before the emulator starts.
  (trap '' HUP; exec emulator -avd "$AVD" -no-window -no-audio -no-boot-anim -no-snapshot-save \
    -timezone Atlantic/Reykjavik) >"$EMULATOR_LOG" 2>&1 &
  emulator_pid=$!
  deadline=$((SECONDS + BOOT_TIMEOUT))
  until [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do
    if [ "$SECONDS" -ge "$deadline" ]; then
      tail -20 "$EMULATOR_LOG" >&2
      echo "::error::$AVD did not finish booting in ${BOOT_TIMEOUT}s" >&2
      exit 1
    fi
    sleep 2
  done
fi

# Results of an earlier run on this Mac would otherwise count toward this one.
results="$ANDROID/app/build/outputs/androidTest-results/connected"
rm -rf "$results"
./gradlew --console=plain connectedDebugAndroidTest

# A run that executes nothing is not a pass.
total=0
while IFS= read -r xml; do
  n=$(sed -n 's/^<testsuites [^>]*tests="\([0-9]*\)".*/\1/p' "$xml" | head -1)
  total=$((total + ${n:-0}))
done < <(find "$results" -name '*.xml' 2>/dev/null)
echo "==> instrumented tests executed: $total"
[ "$total" -gt 0 ] || { echo "::error::connectedDebugAndroidTest reported 0 tests" >&2; exit 1; }
