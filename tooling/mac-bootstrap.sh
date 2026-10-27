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
# The runner job hook (tooling/mac-runner-hook.sh) has ONE copy, in the checkout.
# This script runs from stdin and has no checkout, so the hook is sent first,
# from the Linux checkout, and the step below only wires it (re-send it to update):
#
#   ssh samtak-mac 'mkdir -p ~/.local/libexec/spjall && cat > ~/.local/libexec/spjall/mac-runner-hook.sh && chmod +x ~/.local/libexec/spjall/mac-runner-hook.sh' < tooling/mac-runner-hook.sh
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

# llvm: Apple's clang has no wasm32 target, which the browser core needs (.github/actions/rust-toolchain).
say "xcodegen, jq, xcbeautify, llvm"
brew install --quiet xcodegen jq xcbeautify llvm

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

# Runner job hook: reaps what a cancelled job left running under the runner's
# _work (#318). One copy of it, sent over ssh (see the header); wired here into
# each samtak-svf runner's .env, which a runner reads only when it starts.
hook="$HOME/.local/libexec/spjall/mac-runner-hook.sh"
# ps etime ([[dd-]hh:]mm:ss) in seconds.
etime_seconds() {
  local t=${1// /} d=0 h=0 m s a b c
  case $t in *-*) d=${t%%-*} t=${t#*-} ;; esac
  IFS=: read -r a b c <<<"$t"
  if [ -n "${c:-}" ]; then h=$a m=$b s=$c; else m=$a s=$b; fi
  echo $((10#$d * 86400 + 10#$h * 3600 + 10#$m * 60 + 10#$s))
}
if [ ! -x "$hook" ]; then
  say "runner job hook missing: $hook (the header of this script says how to send it), then run this again"
  exit 1
fi
for dir in "$HOME/actions-runner" "$HOME/actions-runner-2"; do
  [ -f "$dir/.runner" ] || continue
  # .runner is JSON with a BOM; only a runner of the samtak-svf org gets the hook.
  bom=$'\xef\xbb\xbf'
  runner=$(LC_ALL=C sed "1s/^$bom//" "$dir/.runner")
  case "$(jq -r '.gitHubUrl // empty' <<<"$runner")" in
    https://github.com/samtak-svf | https://github.com/samtak-svf/*) ;;
    *) continue ;;
  esac
  name=$(jq -r '.agentName' <<<"$runner")
  changed=0
  for var in ACTIONS_RUNNER_HOOK_JOB_STARTED ACTIONS_RUNNER_HOOK_JOB_COMPLETED; do
    line="$var=$hook"
    if grep -qxF "$line" "$dir/.env" 2>/dev/null; then
      continue
    fi
    changed=1
    touch "$dir/.env"
    if grep -q "^$var=" "$dir/.env"; then
      grep -v "^$var=" "$dir/.env" >"$dir/.env.new" || true
      printf '%s\n' "$line" >>"$dir/.env.new"
      mv "$dir/.env.new" "$dir/.env"
    else
      # Keep the file's other lines; start a new line if the last has no newline.
      [ -s "$dir/.env" ] && [ -n "$(tail -c1 "$dir/.env")" ] && printf '\n' >>"$dir/.env"
      printf '%s\n' "$line" >>"$dir/.env"
    fi
  done
  # The hook is loaded only by a listener that started after .env last changed,
  # so a wired hook still needs a restart when the listener is older than .env.
  [ "$changed" -eq 1 ] && wired="job hook wired" || wired="job hook already wired"
  listener=$(pgrep -f "$dir/bin/[R]unner.Listener" | head -1 || true)
  if [ -n "$listener" ] &&
    [ $(($(date +%s) - $(etime_seconds "$(ps -o etime= -p "$listener")"))) -ge "$(stat -f %m "$dir/.env")" ]; then
    say "runner $name: $wired and loaded"
  elif pgrep -f "$dir/bin/[R]unner.Worker" >/dev/null; then
    say "runner $name: $wired; a job is running, so it takes effect at the next restart"
  else
    say "runner $name: $wired, restarting the runner"
    # The runners are LaunchDaemons (svc.sh install as root): the system domain,
    # not the build user's gui domain.
    sudo -n launchctl kickstart -k "system/actions.runner.samtak-svf.$name"
  fi
done

say "ready: node tooling/mac-remote.mjs from the Linux checkout"
