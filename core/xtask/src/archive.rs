//! Deterministic zips and checksums. Entries are sorted and every timestamp is
//! the zip epoch, so the same files always give the same bytes.

use std::fs;
use std::io::{Cursor, Read, Write};
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};
use sha2::{Digest, Sha256};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, DateTime, ZipArchive, ZipWriter};

pub fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn options() -> SimpleFileOptions {
    SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .last_modified_time(DateTime::default())
        .unix_permissions(0o644)
}

/// Every file under `dir`, as sorted `/`-separated relative paths.
fn files_under(dir: &Path) -> Result<Vec<String>> {
    fn walk(base: &Path, dir: &Path, out: &mut Vec<String>) -> Result<()> {
        for entry in fs::read_dir(dir).with_context(|| format!("reading {}", dir.display()))? {
            let path = entry?.path();
            if path.is_dir() {
                walk(base, &path, out)?;
            } else {
                let relative = path.strip_prefix(base)?;
                let parts: Vec<_> = relative
                    .components()
                    .map(|c| c.as_os_str().to_string_lossy())
                    .collect();
                out.push(parts.join("/"));
            }
        }
        Ok(())
    }
    let mut out = Vec::new();
    walk(dir, dir, &mut out)?;
    out.sort();
    Ok(out)
}

/// Zips named in-memory entries, in the order given.
pub fn zip_entries(entries: &[(String, Vec<u8>)]) -> Result<Vec<u8>> {
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    for (name, bytes) in entries {
        writer.start_file(name.as_str(), options())?;
        writer.write_all(bytes)?;
    }
    Ok(writer.finish()?.into_inner())
}

/// Zips the contents of `dir` (not `dir` itself).
pub fn zip_dir(dir: &Path) -> Result<Vec<u8>> {
    let mut entries = Vec::new();
    for name in files_under(dir)? {
        let bytes = fs::read(dir.join(&name)).with_context(|| format!("reading {name}"))?;
        entries.push((name, bytes));
    }
    zip_entries(&entries)
}

/// Replaces `dest` with the contents of the zip. Entries that would land
/// outside `dest` are refused before anything is written.
pub fn unzip_into(bytes: &[u8], dest: &Path) -> Result<()> {
    let mut archive = ZipArchive::new(Cursor::new(bytes)).context("not a zip")?;
    let mut files: Vec<(PathBuf, Vec<u8>)> = Vec::new();
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index)?;
        let Some(name) = entry.enclosed_name() else {
            bail!("zip entry {:?} escapes the destination", entry.name());
        };
        if entry.is_dir() {
            continue;
        }
        let mut content = Vec::new();
        entry.read_to_end(&mut content)?;
        files.push((name, content));
    }
    if dest.exists() {
        fs::remove_dir_all(dest).with_context(|| format!("clearing {}", dest.display()))?;
    }
    for (name, content) in files {
        let path = dest.join(name);
        fs::create_dir_all(path.parent().expect("a file has a parent"))?;
        fs::write(&path, content)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha256_matches_a_known_vector() {
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn zip_dir_is_deterministic_and_round_trips() {
        let source = tempfile::tempdir().unwrap();
        fs::create_dir_all(source.path().join("jni/x86")).unwrap();
        fs::write(source.path().join("jni/x86/lib.so"), b"elf").unwrap();
        fs::write(source.path().join("a.txt"), b"a").unwrap();

        let first = zip_dir(source.path()).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(1100));
        fs::write(source.path().join("a.txt"), b"a").unwrap();
        assert_eq!(
            zip_dir(source.path()).unwrap(),
            first,
            "mtime must not change the bytes"
        );

        let dest = tempfile::tempdir().unwrap();
        let target = dest.path().join("out");
        fs::create_dir_all(&target).unwrap();
        fs::write(target.join("stale"), b"old").unwrap();
        unzip_into(&first, &target).unwrap();
        assert_eq!(fs::read(target.join("jni/x86/lib.so")).unwrap(), b"elf");
        assert!(
            !target.join("stale").exists(),
            "unzip replaces the directory"
        );
    }

    #[test]
    fn unzip_refuses_an_escaping_entry_and_writes_nothing() {
        let bytes = zip_entries(&[
            ("ok".into(), b"1".to_vec()),
            ("../evil".into(), b"2".to_vec()),
        ])
        .unwrap();
        let dest = tempfile::tempdir().unwrap();
        let target = dest.path().join("out");
        assert!(unzip_into(&bytes, &target).is_err());
        assert!(!target.exists());
        assert!(!dest.path().join("evil").exists());
    }
}
