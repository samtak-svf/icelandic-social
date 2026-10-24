//! `cargo xtask` puts the core where the apps read it, by building it or by
//! fetching a published copy. Either way the apps see the same local paths,
//! so Gradle and SwiftPM never call cargo and never touch the network:
//!
//! | Platform | Local path (gitignored)        | Published file             |
//! |----------|--------------------------------|----------------------------|
//! | Android  | `android/core/crypto/libs/`    | `spjall-core-android.zip`  |
//! | iOS      | `ios/Packages/SpjallCore/`     | `spjall-core-ios.zip`      |
//! | Web      | `web/core/`                    | `spjall-core-web.zip`      |
//!
//! A build also writes the published file and its SHA-256 to
//! `core/target/artifacts/`; core.yml uploads exactly those on a `core-v*`
//! tag. Apps move to a new core only by a PR that edits
//! `core/artifact.lock.json`.

mod archive;
mod build;
mod lock;

use std::path::PathBuf;

use anyhow::{Result, bail};

const USAGE: &str = "\
usage:
  cargo xtask core android     build the AAR and Kotlin bindings (needs the NDK in core/artifact.lock.json)
  cargo xtask core ios         build the XCFramework and Swift package (macOS only)
  cargo xtask core web         build the wasm module and its JS glue (needs wasm-bindgen-cli and the wasm32 target)
  cargo xtask fetch <android|ios|web> [--from <dir|https-url>]
                               download the version pinned in core/artifact.lock.json and verify it";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Platform {
    Android,
    Ios,
    Web,
}

impl Platform {
    fn parse(name: Option<&str>) -> Result<Self> {
        match name {
            Some("android") => Ok(Self::Android),
            Some("ios") => Ok(Self::Ios),
            Some("web") => Ok(Self::Web),
            _ => bail!("{USAGE}"),
        }
    }

    pub fn key(self) -> &'static str {
        match self {
            Self::Android => "android",
            Self::Ios => "ios",
            Self::Web => "web",
        }
    }

    /// The published file name.
    pub fn file(self) -> String {
        format!("spjall-core-{}.zip", self.key())
    }

    /// Where the apps read it, relative to the repo root.
    pub fn local_dir(self) -> &'static str {
        match self {
            Self::Android => "android/core/crypto/libs",
            Self::Ios => "ios/Packages/SpjallCore",
            Self::Web => "web/core",
        }
    }
}

/// The repo root: the parent of the `core/` workspace.
///
/// Read `CARGO_MANIFEST_DIR` from the runtime environment first (`cargo run`
/// sets it to the invoking worktree's `core/xtask`), falling back to the
/// compile-time `env!("CARGO_MANIFEST_DIR")` only when invoked directly outside
/// cargo. A compile-time-only path bakes the first worktree into the shared
/// `CARGO_TARGET_DIR` binary and makes `cargo xtask fetch` unpack into the
/// wrong worktree.
pub fn repo_root() -> PathBuf {
    repo_root_from(std::env::var_os("CARGO_MANIFEST_DIR"))
}

fn repo_root_from(manifest_dir: Option<std::ffi::OsString>) -> PathBuf {
    let xtask = match manifest_dir.filter(|value| !value.is_empty()) {
        Some(dir) => PathBuf::from(dir),
        None => PathBuf::from(env!("CARGO_MANIFEST_DIR")),
    };
    xtask
        .ancestors()
        .nth(2)
        .expect("xtask lives at core/xtask")
        .to_path_buf()
}

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    let root = repo_root();
    match args.as_slice() {
        ["core", platform] => build::run(&root, Platform::parse(Some(platform))?),
        ["fetch", platform, rest @ ..] => {
            let from = match rest {
                [] => None,
                ["--from", source] => Some(*source),
                _ => bail!("{USAGE}"),
            };
            let lock = lock::Lock::read(&root)?;
            lock::fetch(&root, &lock, Platform::parse(Some(platform))?, from)
        }
        _ => bail!("{USAGE}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_platform_has_a_name_a_file_and_a_directory() {
        for (name, platform, dir) in [
            ("android", Platform::Android, "android/core/crypto/libs"),
            ("ios", Platform::Ios, "ios/Packages/SpjallCore"),
            ("web", Platform::Web, "web/core"),
        ] {
            assert_eq!(Platform::parse(Some(name)).unwrap(), platform);
            assert_eq!(platform.key(), name);
            assert_eq!(platform.file(), format!("spjall-core-{name}.zip"));
            assert_eq!(platform.local_dir(), dir);
        }
        assert!(Platform::parse(Some("desktop")).is_err());
    }

    #[test]
    fn repo_root_follows_runtime_cargo_manifest_dir() {
        assert_eq!(
            repo_root_from(Some("/tmp/wt-b/core/xtask".into())),
            PathBuf::from("/tmp/wt-b")
        );
        assert_eq!(
            repo_root_from(Some("".into())),
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .ancestors()
                .nth(2)
                .unwrap()
        );
    }
}
