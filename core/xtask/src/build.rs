//! Builds the core for one platform. The result is first written as the
//! published zip, then unpacked into the app's local directory, so a local
//! build and a fetched artifact leave identical trees.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::{Context, Result, bail};

use crate::Platform;
use crate::archive::{sha256_hex, unzip_into, zip_dir, zip_entries};
use crate::lock::Lock;

/// The apps' minSdk; the `.so` files are linked against this API level.
const ANDROID_MIN_SDK: u32 = 26;

/// cargo-ndk ABI names and the Rust target each one builds.
const ANDROID_ABIS: &[(&str, &str)] = &[
    ("arm64-v8a", "aarch64-linux-android"),
    ("armeabi-v7a", "armv7-linux-androideabi"),
    ("x86_64", "x86_64-linux-android"),
    ("x86", "i686-linux-android"),
];

/// The apps' iOS deployment target (ios/project.yml, PACKAGE_SWIFT). rustc
/// and the C builds of SQLCipher and OpenSSL must all target it: left unset,
/// rustc links for its old default while cc compiles for the SDK's version,
/// and the link fails on symbols only the newer one has.
const IOS_DEPLOYMENT_TARGET: &str = "17.0";

const IOS_DEVICE: &str = "aarch64-apple-ios";
const IOS_SIMULATOR: &[&str] = &["aarch64-apple-ios-sim", "x86_64-apple-ios"];

const LIB: &str = "spjall_core";

pub fn run(root: &Path, platform: Platform) -> Result<()> {
    let core = root.join("core");
    let staging = core.join("target/xtask").join(platform.key());
    if staging.exists() {
        fs::remove_dir_all(&staging)?;
    }
    let out = staging.join("out");
    fs::create_dir_all(&out)?;

    match platform {
        Platform::Android => android(root, &core, &staging, &out)?,
        Platform::Ios => ios(&core, &staging, &out)?,
    }

    let zip = zip_dir(&out)?;
    let artifacts = core.join("target/artifacts");
    fs::create_dir_all(&artifacts)?;
    let file = platform.file();
    let sha256 = sha256_hex(&zip);
    fs::write(artifacts.join(&file), &zip)?;
    fs::write(
        artifacts.join(format!("{file}.sha256")),
        format!("{sha256}  {file}\n"),
    )?;
    unzip_into(&zip, &root.join(platform.local_dir()))?;

    println!("{} -> {}", file, platform.local_dir());
    println!("sha256 {sha256}");
    Ok(())
}

fn command(program: &str, dir: &Path) -> Command {
    let mut command = Command::new(program);
    command.current_dir(dir);
    command
}

fn exec(command: &mut Command) -> Result<()> {
    let status = command
        .status()
        .with_context(|| format!("starting {command:?}"))?;
    if !status.success() {
        bail!("{command:?} failed with {status}");
    }
    Ok(())
}

fn add_targets(core: &Path, targets: &[&str]) -> Result<()> {
    exec(
        command("rustup", core)
            .args(["target", "add"])
            .args(targets),
    )
}

/// Generates bindings from an unstripped host build: release libraries are
/// stripped, and stripping drops the UniFFI metadata symbols bindgen reads.
fn bindgen(core: &Path, language: &str, out: &Path) -> Result<()> {
    exec(command("cargo", core).args(["build", "--quiet", "--locked", "--package", "spjall-ffi"]))?;
    let extension = if cfg!(target_os = "macos") {
        "dylib"
    } else {
        "so"
    };
    let library = cargo_target(core)
        .join("debug")
        .join(format!("lib{LIB}.{extension}"));
    exec(
        command("cargo", core)
            .args([
                "run",
                "--quiet",
                "--release",
                "--package",
                "uniffi-bindgen",
                "--",
            ])
            .args(["generate", "--no-format", "--library"])
            .arg(&library)
            .args(["--language", language, "--out-dir"])
            .arg(out),
    )
}

/// Where cargo puts what it builds in `core`: `CARGO_TARGET_DIR` when set
/// (AGENTS.md shares one across worktrees), else `core/target`. xtask's own
/// staging and artifacts stay under `core/target` either way, for core.yml.
fn cargo_target(core: &Path) -> PathBuf {
    target_dir(core, std::env::var_os("CARGO_TARGET_DIR"))
}

/// cargo's rule: an empty value is unset, a relative one is relative to the
/// directory cargo runs in, which for xtask's builds is `core`.
fn target_dir(core: &Path, env: Option<std::ffi::OsString>) -> PathBuf {
    match env.filter(|value| !value.is_empty()) {
        Some(dir) => core.join(dir),
        None => core.join("target"),
    }
}

fn android_sdk() -> Result<PathBuf> {
    for key in ["ANDROID_HOME", "ANDROID_SDK_ROOT"] {
        if let Some(path) = std::env::var_os(key).filter(|value| !value.is_empty()) {
            return Ok(PathBuf::from(path));
        }
    }
    let home = std::env::var_os("HOME").context("neither ANDROID_HOME nor HOME is set")?;
    Ok(PathBuf::from(home).join("Android/Sdk"))
}

fn android(root: &Path, core: &Path, staging: &Path, out: &Path) -> Result<()> {
    let lock = Lock::read(root)?;
    let ndk = android_sdk()?.join("ndk").join(&lock.android_ndk);
    if !ndk.is_dir() {
        bail!(
            "NDK {0} is not installed at {1}; install it with: sdkmanager \"ndk;{0}\"",
            lock.android_ndk,
            ndk.display()
        );
    }
    let targets: Vec<&str> = ANDROID_ABIS.iter().map(|(_, target)| *target).collect();
    add_targets(core, &targets)?;

    let jni = staging.join("jni");
    let mut ndk_build = command("cargo", core);
    ndk_build.env("ANDROID_NDK_HOME", &ndk).arg("ndk");
    for (abi, _) in ANDROID_ABIS {
        ndk_build.args(["--target", abi]);
    }
    ndk_build
        .args(["--platform", &ANDROID_MIN_SDK.to_string(), "--output-dir"])
        .arg(&jni)
        .args(["build", "--release", "--locked", "--package", "spjall-ffi"]);
    exec(&mut ndk_build)
        .context("cargo-ndk failed; is it installed? cargo install cargo-ndk --locked")?;

    let so = format!("lib{LIB}.so");
    let mut aar = vec![
        (
            "AndroidManifest.xml".to_owned(),
            ANDROID_MANIFEST.as_bytes().to_vec(),
        ),
        ("R.txt".to_owned(), Vec::new()),
        (
            "classes.jar".to_owned(),
            zip_entries(&[(
                "META-INF/MANIFEST.MF".to_owned(),
                b"Manifest-Version: 1.0\r\n\r\n".to_vec(),
            )])?,
        ),
    ];
    for (abi, _) in ANDROID_ABIS {
        let path = jni.join(abi).join(&so);
        let bytes =
            fs::read(&path).with_context(|| format!("cargo-ndk produced no {}", path.display()))?;
        aar.push((format!("jni/{abi}/{so}"), bytes));
    }
    aar.sort();
    fs::write(out.join("spjall-core.aar"), zip_entries(&aar)?)?;

    bindgen(core, "kotlin", &out.join("kotlin"))
}

/// The AAR carries only the native libraries; the Kotlin bindings are
/// compiled by `android/core/crypto` from `libs/kotlin/`.
const ANDROID_MANIFEST: &str = r#"<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="samtak.spjall.core.natives" />
"#;

fn ios(core: &Path, staging: &Path, out: &Path) -> Result<()> {
    if !cfg!(target_os = "macos") {
        bail!(
            "the iOS core builds on macOS only (Xcode's xcodebuild and lipo); CI builds it in core.yml"
        );
    }
    let mut targets = vec![IOS_DEVICE];
    targets.extend(IOS_SIMULATOR);
    add_targets(core, &targets)?;
    for target in &targets {
        exec(
            command("cargo", core)
                .env("IPHONEOS_DEPLOYMENT_TARGET", IOS_DEPLOYMENT_TARGET)
                .args([
                    "build",
                    "--release",
                    "--locked",
                    "--package",
                    "spjall-ffi",
                    "--target",
                    target,
                ]),
        )?;
    }

    let archive = format!("lib{LIB}.a");
    let release = |target: &str| {
        cargo_target(core)
            .join(target)
            .join("release")
            .join(&archive)
    };
    let simulator = staging.join("simulator").join(&archive);
    fs::create_dir_all(simulator.parent().expect("has a parent"))?;
    let mut lipo = command("lipo", core);
    lipo.arg("-create");
    for target in IOS_SIMULATOR {
        lipo.arg(release(target));
    }
    exec(lipo.arg("-output").arg(&simulator))?;

    let generated = staging.join("swift");
    bindgen(core, "swift", &generated)?;
    let headers = staging.join("headers");
    fs::create_dir_all(&headers)?;
    fs::copy(
        generated.join("SpjallCoreFFI.h"),
        headers.join("SpjallCoreFFI.h"),
    )?;
    fs::copy(
        generated.join("SpjallCoreFFI.modulemap"),
        headers.join("module.modulemap"),
    )?;

    exec(
        command("xcodebuild", core)
            .arg("-create-xcframework")
            .arg("-library")
            .arg(release(IOS_DEVICE))
            .arg("-headers")
            .arg(&headers)
            .arg("-library")
            .arg(&simulator)
            .arg("-headers")
            .arg(&headers)
            .arg("-output")
            .arg(out.join("SpjallCoreFFI.xcframework")),
    )?;

    let sources = out.join("Sources/SpjallCore");
    fs::create_dir_all(&sources)?;
    fs::copy(
        generated.join("SpjallCore.swift"),
        sources.join("SpjallCore.swift"),
    )?;
    fs::write(out.join("Package.swift"), PACKAGE_SWIFT)?;
    Ok(())
}

/// Tools version 5.10 keeps the generated bindings in Swift 5 language mode;
/// the app itself is Swift 6.
const PACKAGE_SWIFT: &str = r#"// swift-tools-version:5.10
// Written by `cargo xtask core ios` or `cargo xtask fetch ios`. Do not edit.
import PackageDescription

let package = Package(
    name: "SpjallCore",
    platforms: [.iOS(.v17)],
    products: [.library(name: "SpjallCore", targets: ["SpjallCore"])],
    targets: [
        .binaryTarget(name: "SpjallCoreFFI", path: "SpjallCoreFFI.xcframework"),
        .target(name: "SpjallCore", dependencies: ["SpjallCoreFFI"], path: "Sources/SpjallCore"),
    ]
)
"#;

#[cfg(test)]
mod tests {
    use super::*;

    /// One iOS version everywhere: the Rust and C builds, the Swift package
    /// and the Xcode project.
    #[test]
    fn the_ios_deployment_target_agrees() {
        let major = IOS_DEPLOYMENT_TARGET.split('.').next().unwrap();
        assert!(PACKAGE_SWIFT.contains(&format!(".iOS(.v{major})")));
        let project =
            fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../ios/project.yml"))
                .unwrap();
        assert!(project.contains(&format!("iOS: \"{IOS_DEPLOYMENT_TARGET}\"")));
    }

    /// bindgen and the iOS link read cargo's output, which follows
    /// `CARGO_TARGET_DIR`; a hard-coded `core/target` broke a shared one.
    #[test]
    fn the_cargo_target_follows_cargo_target_dir() {
        let core = Path::new("/repo/core");
        assert_eq!(target_dir(core, None), core.join("target"));
        assert_eq!(target_dir(core, Some("".into())), core.join("target"));
        assert_eq!(
            target_dir(core, Some("/cache/spjall-target".into())),
            PathBuf::from("/cache/spjall-target")
        );
        assert_eq!(
            target_dir(core, Some("../shared".into())),
            core.join("../shared")
        );
    }
}
