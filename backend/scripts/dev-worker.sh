#!/usr/bin/env bash
# The Worker under `cf dev --mode interop` (fake Kenni and Google providers) on
# fresh local state, for web/scripts/e2e.sh and interop.yml.
#
#   eval "$(backend/scripts/dev-worker.sh start)"   # exports SPJALL_DEV_URL and SPJALL_DEV_PORT
#   backend/scripts/dev-worker.sh stop
#
# The port is SPJALL_DEV_PORT when set. Unset in CI it is a free port picked
# here, so two jobs on one machine each get their own Worker (decision 0062
# kept 8787 for the apps; dev-origin.ts). Unset elsewhere it is 8787. Only the
# two assignments go to stdout; progress and errors go to stderr. Under GitHub
# Actions both are also appended to $GITHUB_ENV for the later steps.
#
# The Worker gets its own process group, recorded in .cloudflare/dev-worker.pid,
# so `stop` ends workerd with it and nothing outside this run. SIGHUP is ignored
# without nohup, which exits under the launchd runner on samtak-mac.
# The kennitala key in backend/.dev.vars is made for the run when absent: a
# throwaway key for test data, never a real secret.
set -euo pipefail

BACKEND=$(cd "$(dirname "$0")/.." && pwd)
STATE=$BACKEND/.cloudflare
PIDFILE=$STATE/dev-worker.pid
WORKER_LOG=${WORKER_LOG:-$STATE/worker.log}

stop() {
  [ -f "$PIDFILE" ] || return 0
  local pid
  pid=$(cat "$PIDFILE")
  rm -f "$PIDFILE"
  kill -- "-$pid" 2>/dev/null || true
  # Not our child when run as a separate `stop`: poll until the group is gone.
  for _ in $(seq 20); do
    kill -0 -- "-$pid" 2>/dev/null || return 0
    sleep 0.5
  done
  kill -9 -- "-$pid" 2>/dev/null || true
}

start() {
  if [ -z "${SPJALL_DEV_PORT:-}" ]; then
    if [ -n "${CI:-}" ]; then
      SPJALL_DEV_PORT=$(node -e 'const s=require("node:net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')
    else
      SPJALL_DEV_PORT=8787
    fi
  fi
  export SPJALL_DEV_PORT
  local url=http://127.0.0.1:$SPJALL_DEV_PORT
  local health=$url/health

  # Another Worker on the port would answer for this one.
  if curl -sf -m 2 "$health" >/dev/null 2>&1; then
    echo "::error::something already answers on $health; stop it first" >&2
    exit 1
  fi

  cd "$BACKEND"
  mkdir -p "$STATE"
  rm -rf "$STATE/state"
  # cf has no --persist-to for dev: the migrations go where cf dev keeps its
  # state, and the operator invite goes through the dev Worker itself
  # (scripts/invite-operator.ts --local).
  node scripts/d1.ts migrate --local --persist-to .cloudflare/state >&2
  [ -f .dev.vars ] || printf 'KENNITALA_HMAC_KEY=%s\n' "$(openssl rand -hex 32)" > .dev.vars

  set -m
  (trap '' HUP; exec pnpm exec cf dev --mode interop) > "$WORKER_LOG" 2>&1 &
  echo $! > "$PIDFILE"
  set +m

  for _ in $(seq 60); do
    curl -sf -m 5 "$health" >/dev/null && break
    sleep 1
  done
  if ! curl -sf -m 5 "$health" >/dev/null; then
    echo "::error::the Worker did not answer $health" >&2
    tail -100 "$WORKER_LOG" >&2
    stop
    exit 1
  fi

  printf 'SPJALL_DEV_URL=%s\nSPJALL_DEV_PORT=%s\n' "$url" "$SPJALL_DEV_PORT"
  if [ -n "${GITHUB_ENV:-}" ]; then
    printf 'SPJALL_DEV_URL=%s\nSPJALL_DEV_PORT=%s\n' "$url" "$SPJALL_DEV_PORT" >> "$GITHUB_ENV"
  fi
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  *) echo "usage: dev-worker.sh start|stop" >&2; exit 2 ;;
esac
