//! `cargo xtask` puts the core where the apps read it, by building it or by
//! fetching a published copy. Either way the apps see the same local paths,
//! so Gradle and SwiftPM never call cargo and never touch the network:
//!
//! | Platform | Local path (gitignored)        | Published file             |
//! |----------|--------------------------------|----------------------------|
//! | Android  | `android/core/crypto/libs/`    | `spjall-core-android.zip`  |
//! | iOS      | `ios/Packages/SpjallCore/`     | `spjall-core-ios.zip`      |
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
  cargo xtask fetch <android|ios> [--from <dir|https-url>]
                               download the version pinned in core/artifact.lock.json and verify it";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Platform {
    Android,
    Ios,
}

impl Platform {
    fn parse(name: Option<&str>) -> Result<Self> {
        match name {
            Some("android") => Ok(Self::Android),
            Some("ios") => Ok(Self::Ios),
            _ => bail!("{USAGE}"),
        }
    }

    pub fn key(self) -> &'static str {
        match self {
            Self::Android => "android",
            Self::Ios => "ios",
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
        }
    }
}

/// The repo root: the parent of the `core/` workspace.
pub fn repo_root() -> PathBuf {
    let xtask = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
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
