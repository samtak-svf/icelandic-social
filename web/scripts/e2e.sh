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
HEALTH=http://127.0.0.1:8787/health
export PATH="$HOME/.cargo/bin:$PATH"

if [ "${1:-}" = "--prepare" ]; then
  shift
  (cd "$ROOT/core" && cargo xtask fetch web)
  (cd "$ROOT" && pnpm --filter spjall-web exec playwright install chromium)
fi

# Another Worker on the port would answer for this one.
if curl -sf -m 2 "$HEALTH" >/dev/null 2>&1; then
  echo "::error::something already answers on $HEALTH; stop it first" >&2
  exit 1
fi

cd "$ROOT/backend"
rm -rf .cloudflare/state
node scripts/d1.ts migrate --local --persist-to .cloudflare/state
[ -f .dev.vars ] || printf 'KENNITALA_HMAC_KEY=%s\n' "$(openssl rand -hex 32)" > .dev.vars

# Job control gives the Worker its own process group, so stopping it stops
# workerd too, and nothing outside this run.
set -m
# SIGHUP is ignored without nohup, which exits under a launchd runner (android/scripts/test.sh).
(trap '' HUP; exec pnpm exec cf dev --mode interop) > "$WORKER_LOG" 2>&1 &
worker=$!
set +m
status=1
stop() {
  kill -- "-$worker" 2>/dev/null || true
  wait "$worker" 2>/dev/null || true
  if [ "$status" -ne 0 ]; then
    echo "==> worker log ($WORKER_LOG)" >&2
    tail -100 "$WORKER_LOG" >&2
  fi
}
trap stop EXIT

for _ in $(seq 60); do
  curl -sf -m 5 "$HEALTH" >/dev/null && break
  sleep 1
done
curl -sf -m 5 "$HEALTH" >/dev/null || { echo "::error::the Worker did not answer $HEALTH" >&2; exit 1; }

cd "$ROOT"
pnpm --filter spjall-web e2e "$@" && status=0 || status=$?
exit "$status"
