#!/usr/bin/env bash
# Runs measure.mjs inside the official Playwright image for this Playwright
# version, pinned by digest. WebKit's Linux build needs Ubuntu's libraries
# (ICU 74, libjpeg8, libjxl 0.8), so on any other distribution it runs here.
# The worktree is mounted at its own path so pnpm's symlinks resolve.
#
#   ./container.sh --browsers chromium,firefox,webkit --runs 3
set -euo pipefail
IMAGE="mcr.microsoft.com/playwright:v1.64.0-noble@sha256:bc72a8df40831ded821e3cbc79c318c21b44d6e51dff9fd89ace7a8249c5b462"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
RUNTIME="$(command -v podman || command -v docker)"
"$RUNTIME" run --rm --ipc=host --security-opt label=disable \
  -v "$ROOT:$ROOT" -w "$HERE" "$IMAGE" \
  sh -c 'node fetch.mjs && node measure.mjs "$@"' measure "$@"
