#!/usr/bin/env bash
# Set up a Mac of Samtak's own once, so tooling/mac-remote.mjs and ios.yml can
# build on it. Run from Linux, over ssh, as the Mac's build user:
#
#   ssh samtak-mac 'bash -s' < tooling/mac-bootstrap.sh
#
# Safe to run again; each step skips what is already there. Xcode is the one
# step it cannot take: it needs an Apple ID sign-in on the Mac, so the script
# stops and says so until Xcode is installed.
#
# Nothing that signs goes on this Mac: no certificate, no profile, no store
# key. The release workflow stays on GitHub's hosted runners.
set -euo pipefail

say() { printf '==> %s\n' "$*"; }

if ! xcode-select -p 2>/dev/null | grep -q '/Applications/Xcode'; then
  say "Xcode is not installed. Install it from the App Store (or with xcodes), then:"
  say "  sudo xcode-select -s /Applications/Xcode.app && sudo xcodebuild -license accept"
  exit 1
fi
say "$(xcodebuild -version | head -1)"

if ! command -v brew >/dev/null && [ ! -x /opt/homebrew/bin/brew ]; then
  say "Homebrew"
  NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi
eval "$(/opt/homebrew/bin/brew shellenv)"

say "xcodegen, jq, xcbeautify"
brew install --quiet xcodegen jq xcbeautify

if ! command -v rustup >/dev/null && [ ! -x "$HOME/.cargo/bin/rustup" ]; then
  # Only rustup itself: core/rust-toolchain.toml names the toolchain, and
  # cargo installs it on the first `cargo xtask fetch ios`.
  say "rustup"
  curl -fsSL https://sh.rustup.rs | sh -s -- -y --default-toolchain none --profile minimal
fi

if ! xcrun simctl list runtimes | grep -q '^iOS '; then
  say "iOS simulator runtime"
  xcodebuild -downloadPlatform iOS
fi

# ssh runs commands in a non-interactive zsh, which reads .zshenv and nothing
# else: the tools above and the reused DerivedData have to be named there.
marker="# spjall (tooling/mac-bootstrap.sh)"
if ! grep -qF "$marker" "$HOME/.zshenv" 2>/dev/null; then
  say "~/.zshenv"
  cat >>"$HOME/.zshenv" <<EOF

$marker
eval "\$(/opt/homebrew/bin/brew shellenv)"
. "\$HOME/.cargo/env"
export SPJALL_DERIVED_DATA="\$HOME/Library/Developer/spjall-derived-data"
EOF
fi

say "ready: node tooling/mac-remote.mjs from the Linux checkout"
