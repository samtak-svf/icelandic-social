#!/usr/bin/env bash
# The web's Playwright run against the real Worker under `cf dev --mode interop`
# (fake Kenni and Google providers), as web.yml runs it. web.yml calls this
# script; from Linux, run it on the Mac with tooling/mac-remote.mjs web, which
# keeps Chromium and workerd off a workstation that swaps.
#
#   web/scripts/e2e.sh [--prepare] [playwright args…]
#
# --prepare first fetches the pinned core for the web and installs Chromium;
# CI has its own steps for both. Every run starts from empty local state, and
# the kennitala key is made for the run when backend/.dev.vars is absent: it
# is a throwaway key for test data, never a real secret.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
WORKER_LOG=${WORKER_LOG:-$ROOT/backend/.cloudflare/worker.log}
export WORKER_LOG
export PATH="$HOME/.cargo/bin:$PATH"

if [ "${1:-}" = "--prepare" ]; then
  shift
  (cd "$ROOT/core" && cargo xtask fetch web)
  (cd "$ROOT" && pnpm --filter spjall-web exec playwright install chromium)
fi

# A free port per run in CI, 8787 elsewhere: backend/scripts/dev-worker.sh
# starts the Worker on fresh state and prints SPJALL_DEV_URL and SPJALL_DEV_PORT.
DEV_WORKER=$ROOT/backend/scripts/dev-worker.sh
status=1
stop() {
  "$DEV_WORKER" stop || true
  if [ "$status" -ne 0 ]; then
    echo "==> worker log ($WORKER_LOG)" >&2
    tail -100 "$WORKER_LOG" >&2 || true
  fi
}
trap stop EXIT
# eval of a substitution hides a failed start, so the assignment comes first.
started=$("$DEV_WORKER" start)
eval "$started"
export SPJALL_DEV_URL SPJALL_DEV_PORT

cd "$ROOT"
pnpm --filter spjall-web e2e "$@" && status=0 || status=$?
exit "$status"
