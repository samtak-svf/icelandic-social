#!/usr/bin/env bash
# A run that executes nothing is not a pass: the count of the instrumented tests
# in a results directory, which both device lanes of android.yml read.
#
#   android/scripts/connected-count.sh [results-dir]
set -euo pipefail

results=${1:-app/build/outputs/androidTest-results/connected}
total=0
while IFS= read -r xml; do
  n=$(sed -n 's/^<testsuites [^>]*tests="\([0-9]*\)".*/\1/p' "$xml" | head -1)
  total=$((total + ${n:-0}))
done < <(find "$results" -name '*.xml' 2>/dev/null)
echo "==> instrumented tests executed: $total"
[ "$total" -gt 0 ] || { echo "::error::connectedDebugAndroidTest reported 0 tests" >&2; exit 1; }
