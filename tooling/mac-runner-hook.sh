#!/usr/bin/env bash
# Runner job hook for the self-hosted Mac runners: reap what a job left behind.
#
# Installed as BOTH ACTIONS_RUNNER_HOOK_JOB_STARTED and
# ACTIONS_RUNNER_HOOK_JOB_COMPLETED by tooling/mac-bootstrap.sh. Cancelling a job
# kills the step's shell, not its process group, so `workerd` and its pnpm/node
# parents outlive it (#318).
#
# Invariant: no process whose command line lies under this runner's _work/
# survives from one job into the next. Two runners share the Mac, each with its
# own _work, so a process under the other one, or outside any _work (the
# emulator, Runner.Listener, Runner.Worker), is never touched.
#
# A failing hook fails the job, so every refusal prints why and exits 0.
# Logs counts only: a command line may carry anything.
# SPJALL_REAP_GRACE_SECONDS (default 5) is the wait between SIGTERM and SIGKILL.
set -euo pipefail

log() { printf 'mac-runner-hook: %s\n' "$*"; }

if [ -z "${RUNNER_WORKSPACE:-}" ]; then
  log "RUNNER_WORKSPACE is unset; nothing reaped"
  exit 0
fi
workdir=$(dirname "$RUNNER_WORKSPACE")
if [ "$(basename "$workdir")" != "_work" ]; then
  log "work dir is not named _work; nothing reaped"
  exit 0
fi

# This process and its ancestors (the runner itself, a job's shell) stay.
keep=" "
pid=$$
while [ -n "$pid" ] && [ "$pid" -gt 1 ] 2>/dev/null; do
  keep="$keep$pid "
  pid=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ' || true)
done

# Still running: a zombie has exited and only waits for its parent to reap it.
running() {
  local state
  state=$(ps -o stat= -p "$1" 2>/dev/null | tr -d ' ') || return 1
  [ -n "$state" ] && [ "${state#Z}" = "$state" ]
}

# Matching targets, one pid per line.
targets() {
  ps -axo pid=,command= | while read -r p cmd; do
    case "$keep" in *" $p "*) continue ;; esac
    case "$cmd" in *"$workdir/"*) printf '%s\n' "$p" ;; esac
  done
}

pids=$(targets)
total=0
for p in $pids; do total=$((total + 1)); kill -TERM "$p" 2>/dev/null || true; done

killed=0
if [ "$total" -gt 0 ]; then
  grace=${SPJALL_REAP_GRACE_SECONDS:-5}
  waited=0
  while [ "$waited" -lt $((grace * 10)) ]; do
    left=0
    for p in $pids; do running "$p" && left=1; done
    [ "$left" -eq 0 ] && break
    sleep 0.1
    waited=$((waited + 1))
  done
  for p in $pids; do
    if running "$p"; then
      kill -KILL "$p" 2>/dev/null || true
      killed=$((killed + 1))
    fi
  done
fi
log "reaped $total ($killed killed)"
