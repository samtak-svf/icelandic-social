#!/usr/bin/env bash
# Set up a Mac of Samtak's own once, so tooling/mac-remote.mjs and ios.yml can
# build on it, and android/scripts/test.sh can run the Android emulator on it.
# Run from Linux, over ssh, as the Mac's build user:
#
#   ssh samtak-mac 'bash -s' < tooling/mac-bootstrap.sh
#
# Safe to run again; each step skips what is already there. Xcode is the one
# step it cannot take: Apple serves it only to a signed-in developer, so the
# script stops and says so until Xcode is installed. The Mac itself needs no
# Apple ID for it: sign in to developer.apple.com in a browser elsewhere, copy
# its ADCDownloadAuth cookie to the Mac over ssh stdin, fetch the .xip from
# download.developer.apple.com with curl, delete the cookie, then xip -x.
#
# Nothing that signs goes on this Mac: no certificate, no profile, no store
# key. The release workflow stays on GitHub's hosted runners.
set -euo pipefail

say() { printf '==> %s\n' "$*"; }

if ! xcode-select -p 2>/dev/null | grep -q '/Applications/Xcode'; then
  say "Xcode is not installed (the header of this script says how, with no Apple ID here), then:"
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

# Android: the JDK, the SDK and the emulator's AVD, for android/scripts/test.sh.
# No LaunchAgent for the emulator: test.sh starts and stops its own, because a
# resident one would hold RAM on a shared Mac that also runs iOS CI.
ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
for cask in temurin@21 android-commandlinetools; do
  if ! brew list --cask "$cask" >/dev/null 2>&1; then
    say "$cask"
    brew install --quiet --cask "$cask"
  fi
done
export ANDROID_HOME JAVA_HOME="$(/usr/libexec/java_home -v 21)"

# Gradle fetches platforms and build tools only for licences already accepted,
# and never the emulator or its system image.
say "Android licences"
yes | sdkmanager --licenses >/dev/null 2>&1 || true
installed=$(sdkmanager --list_installed 2>/dev/null)
packages=(
  platform-tools
  emulator
  # COMPILE_SDK = 37 in android/build-logic/.../gradle/Android.kt. The SDK names
  # its platforms by minor version, so android-37 does not exist (37.0 does).
  "platforms;android-37.0"
  "platforms;android-37.1"
  # The build tools AGP asks for (the agp version in android/gradle/libs.versions.toml).
  "build-tools;36.0.0"
  "build-tools;37.0.0"
  # api-level 34 and the default target, as .github/workflows/android.yml runs
  # it; arm64-v8a because this Mac is Apple silicon.
  "system-images;android-34;google_apis;arm64-v8a"
)
for pkg in "${packages[@]}"; do
  if ! grep -q "^ *$pkg " <<<"$installed"; then
    say "sdk: $pkg"
    sdkmanager --install "$pkg" >/dev/null
  fi
done

if ! avdmanager list avd -c 2>/dev/null | grep -qx spjall-test; then
  say "AVD spjall-test"
  echo no | avdmanager create avd --name spjall-test --device pixel_5 \
    --package "system-images;android-34;google_apis;arm64-v8a"
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
# ios/scripts/test.sh builds in a directory per checkout under it.
export SPJALL_DERIVED_DATA="\$HOME/Library/Developer/spjall-derived-data"
EOF
fi

# Its own marker: a Mac provisioned before the Android lane has the one above.
marker="# spjall android (tooling/mac-bootstrap.sh)"
if ! grep -qF "$marker" "$HOME/.zshenv" 2>/dev/null; then
  say "~/.zshenv (Android)"
  cat >>"$HOME/.zshenv" <<EOF

$marker
export ANDROID_HOME="$ANDROID_HOME"
export JAVA_HOME="$JAVA_HOME"
EOF
fi

say "ready: node tooling/mac-remote.mjs from the Linux checkout"
