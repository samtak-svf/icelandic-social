//! `core/artifact.lock.json`: which published core the apps use, and the
//! checksum each download must match. `pnpm check:core` validates its shape;
//! this module trusts nothing it downloads until the checksum agrees.

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use anyhow::{Context, Result, bail};
use serde::Deserialize;

use crate::Platform;
use crate::archive::{sha256_hex, unzip_into};

/// Downloads larger than this are refused (the zips are a few tens of MB).
const MAX_DOWNLOAD: u64 = 512 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Lock {
    /// The published core version, or `null` before the first publish.
    pub version: Option<String>,
    /// The NDK release the Android artifact is built with.
    pub android_ndk: String,
    /// Where a version's files are served, with `{version}` standing for the
    /// version (decision 0013), or `null` before the first publish.
    pub base_url: Option<String>,
    #[serde(default)]
    pub artifacts: BTreeMap<String, Artifact>,
}

#[derive(Debug, Deserialize)]
pub struct Artifact {
    pub file: String,
    pub sha256: String,
}

impl Lock {
    pub fn read(root: &Path) -> Result<Self> {
        let path = root.join("core/artifact.lock.json");
        let text =
            fs::read_to_string(&path).with_context(|| format!("reading {}", path.display()))?;
        serde_json::from_str(&text).with_context(|| format!("parsing {}", path.display()))
    }
}

/// The URL of `file` in `version`: the base with `{version}` filled in, then
/// the file name. The placeholder is required, so a base that would serve
/// every version from one place is refused rather than silently mixed.
fn artifact_url(base: &str, version: &str, file: &str) -> Result<String> {
    if !base.contains("{version}") {
        bail!("the base URL must contain {{version}}: {base}");
    }
    let dir = base.replace("{version}", version);
    Ok(format!("{}/{file}", dir.trim_end_matches('/')))
}

/// A file of a GitHub release: `https://github.com/<owner>/<repo>/releases/download/<tag>/<file>`.
#[derive(Debug, PartialEq)]
struct ReleaseFile<'a> {
    repo: &'a str,
    tag: &'a str,
    file: &'a str,
}

fn release_file(url: &str) -> Option<ReleaseFile<'_>> {
    let path = url.strip_prefix("https://github.com/")?;
    let (owner_repo, rest) = path.split_once("/releases/download/")?;
    let (tag, file) = rest.split_once('/')?;
    let parts = owner_repo.split('/').count() == 2 && !tag.is_empty() && !file.contains('/');
    parts.then_some(ReleaseFile {
        repo: owner_repo,
        tag,
        file,
    })
}

/// The token a private repository's release needs: `GITHUB_TOKEN` (CI passes
/// `github.token`), else `GH_TOKEN` (`GH_TOKEN=$(gh auth token)` locally).
fn github_token() -> Option<String> {
    ["GITHUB_TOKEN", "GH_TOKEN"]
        .iter()
        .find_map(|name| std::env::var(name).ok().filter(|v| !v.is_empty()))
}

#[derive(Deserialize)]
struct Release {
    assets: Vec<Asset>,
}

#[derive(Deserialize)]
struct Asset {
    name: String,
    url: String,
}

/// A release file through the API, which serves a private repository's
/// files to a token; the plain download URL answers 404 to one without.
fn download_release(release: &ReleaseFile, token: &str) -> Result<Vec<u8>> {
    let auth = format!("Bearer {token}");
    let api = format!(
        "https://api.github.com/repos/{}/releases/tags/{}",
        release.repo, release.tag
    );
    let text = ureq::get(&api)
        .header("Authorization", &auth)
        .header("Accept", "application/vnd.github+json")
        .call()
        .with_context(|| format!("GET {api}"))?
        .body_mut()
        .read_to_string()?;
    let found: Release = serde_json::from_str(&text).with_context(|| format!("parsing {api}"))?;
    let Some(asset) = found.assets.iter().find(|a| a.name == release.file) else {
        bail!("release {} has no file {}", release.tag, release.file);
    };
    let mut response = ureq::get(&asset.url)
        .header("Authorization", &auth)
        .header("Accept", "application/octet-stream")
        .call()
        .with_context(|| format!("GET {}", asset.url))?;
    Ok(response
        .body_mut()
        .with_config()
        .limit(MAX_DOWNLOAD)
        .read_to_vec()?)
}

fn download(source: &str, version: &str, file: &str) -> Result<Vec<u8>> {
    if source.starts_with("https://") {
        let url = artifact_url(source, version, file)?;
        if let (Some(release), Some(token)) = (release_file(&url), github_token()) {
            return download_release(&release, &token);
        }
        let mut response = ureq::get(&url).call().with_context(|| {
            format!("GET {url} (a private repository needs GITHUB_TOKEN or GH_TOKEN)")
        })?;
        return Ok(response
            .body_mut()
            .with_config()
            .limit(MAX_DOWNLOAD)
            .read_to_vec()?);
    }
    if source.contains("://") {
        bail!("only https:// or a local directory can be fetched from, not {source}");
    }
    let path = Path::new(source).join(file);
    fs::read(&path).with_context(|| format!("reading {}", path.display()))
}

/// Downloads the pinned artifact for `platform`, checks it against the lock,
/// and only then replaces the platform's local directory.
pub fn fetch(root: &Path, lock: &Lock, platform: Platform, from: Option<&str>) -> Result<()> {
    let Some(version) = &lock.version else {
        bail!(
            "no core is published yet (core/artifact.lock.json has no version); \
             build it instead: cargo xtask core {}",
            platform.key()
        );
    };
    let Some(artifact) = lock.artifacts.get(platform.key()) else {
        bail!(
            "core/artifact.lock.json pins no {} artifact",
            platform.key()
        );
    };
    let Some(source) = from.or(lock.base_url.as_deref()) else {
        bail!("core/artifact.lock.json has no baseUrl; pass --from <dir|https-url>");
    };

    let bytes = download(source, version, &artifact.file)?;
    let actual = sha256_hex(&bytes);
    if actual != artifact.sha256 {
        bail!(
            "checksum mismatch for {}: the lock pins {}, the download is {actual}; nothing was written",
            artifact.file,
            artifact.sha256
        );
    }
    let dest = root.join(platform.local_dir());
    unzip_into(&bytes, &dest)?;
    println!(
        "core {version} ({}) verified and unpacked into {}",
        platform.key(),
        platform.local_dir()
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::archive::zip_entries;

    fn lock(sha256: &str) -> Lock {
        Lock {
            version: Some("0.1.0".into()),
            android_ndk: "30.0.16248370".into(),
            base_url: None,
            artifacts: BTreeMap::from([(
                "android".into(),
                Artifact {
                    file: "spjall-core-android.zip".into(),
                    sha256: sha256.into(),
                },
            )]),
        }
    }

    fn published() -> (tempfile::TempDir, Vec<u8>) {
        let dir = tempfile::tempdir().unwrap();
        let zip = zip_entries(&[("spjall-core.aar".into(), b"aar".to_vec())]).unwrap();
        fs::write(dir.path().join("spjall-core-android.zip"), &zip).unwrap();
        (dir, zip)
    }

    #[test]
    fn the_committed_lock_parses() {
        Lock::read(&crate::repo_root()).unwrap();
    }

    #[test]
    fn a_matching_checksum_unpacks() {
        let (source, zip) = published();
        let root = tempfile::tempdir().unwrap();
        let from = source.path().to_str().unwrap();
        fetch(
            root.path(),
            &lock(&sha256_hex(&zip)),
            Platform::Android,
            Some(from),
        )
        .unwrap();
        let aar = root.path().join("android/core/crypto/libs/spjall-core.aar");
        assert_eq!(fs::read(aar).unwrap(), b"aar");
    }

    /// The web artifact takes the same path as the others, into `web/core`.
    #[test]
    fn a_matching_web_checksum_unpacks_into_the_web_directory() {
        let dir = tempfile::tempdir().unwrap();
        let zip = zip_entries(&[("spjall_wasm_bg.wasm".into(), b"wasm".to_vec())]).unwrap();
        fs::write(dir.path().join("spjall-core-web.zip"), &zip).unwrap();
        let lock = Lock {
            version: Some("0.1.0".into()),
            android_ndk: "30.0.16248370".into(),
            base_url: None,
            artifacts: BTreeMap::from([(
                "web".into(),
                Artifact {
                    file: "spjall-core-web.zip".into(),
                    sha256: sha256_hex(&zip),
                },
            )]),
        };
        let root = tempfile::tempdir().unwrap();
        fetch(
            root.path(),
            &lock,
            Platform::Web,
            Some(dir.path().to_str().unwrap()),
        )
        .unwrap();
        assert_eq!(
            fs::read(root.path().join("web/core/spjall_wasm_bg.wasm")).unwrap(),
            b"wasm"
        );
    }

    #[test]
    fn a_lock_without_a_web_artifact_says_so() {
        let error = fetch(
            Path::new("/nowhere"),
            &lock(&"0".repeat(64)),
            Platform::Web,
            Some("/nowhere"),
        )
        .unwrap_err();
        assert!(
            error.to_string().contains("pins no web artifact"),
            "{error}"
        );
    }

    #[test]
    fn a_wrong_checksum_fails_and_writes_nothing() {
        let (source, _) = published();
        let root = tempfile::tempdir().unwrap();
        let from = source.path().to_str().unwrap();
        let error = fetch(
            root.path(),
            &lock(&"0".repeat(64)),
            Platform::Android,
            Some(from),
        )
        .unwrap_err();
        assert!(error.to_string().contains("checksum mismatch"), "{error}");
        assert!(!root.path().join("android").exists());
    }

    #[test]
    fn an_unpublished_lock_says_to_build() {
        let mut unpublished = lock("");
        unpublished.version = None;
        let error = fetch(Path::new("."), &unpublished, Platform::Ios, None).unwrap_err();
        assert!(
            error.to_string().contains("cargo xtask core ios"),
            "{error}"
        );
    }

    #[test]
    fn plain_http_is_refused() {
        let error = download("http://example.invalid/{version}", "0.1.0", "f").unwrap_err();
        assert!(error.to_string().contains("only https://"), "{error}");
    }

    #[test]
    fn the_url_is_the_base_with_the_version_filled_in() {
        let url = artifact_url(
            "https://github.com/o/r/releases/download/core-v{version}",
            "0.1.0",
            "spjall-core-android.zip",
        )
        .unwrap();
        assert_eq!(
            url,
            "https://github.com/o/r/releases/download/core-v0.1.0/spjall-core-android.zip"
        );
    }

    #[test]
    fn a_github_release_url_names_its_repo_tag_and_file() {
        let url = "https://github.com/o/r/releases/download/core-v0.1.0/spjall-core-web.zip";
        assert_eq!(
            release_file(url),
            Some(ReleaseFile {
                repo: "o/r",
                tag: "core-v0.1.0",
                file: "spjall-core-web.zip",
            })
        );
        assert_eq!(
            release_file("https://artifacts.example.org/0.1.0/f.zip"),
            None
        );
        assert_eq!(
            release_file("https://github.com/o/r/s/releases/download/t/f"),
            None
        );
        assert_eq!(
            release_file("https://github.com/o/r/releases/download/t/d/f"),
            None
        );
    }

    #[test]
    fn a_base_url_without_the_version_is_refused() {
        let error = artifact_url("https://artifacts.example.org", "0.1.0", "f").unwrap_err();
        assert!(error.to_string().contains("{version}"), "{error}");
    }
}
