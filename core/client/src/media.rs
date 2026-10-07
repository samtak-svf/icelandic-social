//! Photos and files as encrypted blobs (0023). Each file has its own
//! AES-256-GCM key and is sealed in 64 KiB segments. A segment's nonce is
//! its number and whether it is the last, so a blob cut short, reordered or
//! grown does not open. The key and the SHA-256 of the blob travel inside
//! MLS in `Body::Media`; the server holds only the blob.
//!
//! Files are kept in the store's `media/` folder by object id: the copy a
//! send keeps, and what `media()` decrypts. They go with their rows, by the
//! disappearing purge or a delete for everyone.

use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{self, BufWriter, Read, Write};
use std::path::{Path, PathBuf};

use aes_gcm::aead::{AeadInPlace, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce, Tag};
use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use sha2::{Digest as _, Sha256};
use spjall_envelope::{Body, Envelope};
use spjall_store::rusqlite::{self, OptionalExtension, Transaction, params};

use crate::api::{Transport, base64, from_base64, group_id};
use crate::{Client, ClientError, authed, conversation_state, open_conversation};

/// The largest file sent, in plaintext bytes (0023).
pub const MAX_SIZE: u64 = 25 * 1024 * 1024;
const SEGMENT: usize = 64 * 1024;
const TAG: usize = 16;

#[derive(Debug, thiserror::Error)]
pub enum MediaError {
    #[error("file: {0}")]
    File(#[from] io::Error),
    #[error("the file is over 25 MB")]
    TooLarge,
    /// The blob is not the one the message names, or does not open.
    #[error("the file does not match its message")]
    Tampered,
}

fn nonce(index: u64, last: bool) -> Nonce<aes_gcm::aead::consts::U12> {
    let mut nonce = [0u8; 12];
    nonce[..8].copy_from_slice(&index.to_be_bytes());
    nonce[11] = u8::from(last);
    nonce.into()
}

/// Reads until `buf` is full or the end; how many bytes it read.
fn fill(reader: &mut impl Read, buf: &mut [u8]) -> io::Result<usize> {
    let mut n = 0;
    while n < buf.len() {
        match reader.read(&mut buf[n..]) {
            Ok(0) => break,
            Ok(k) => n += k,
            Err(e) if e.kind() == io::ErrorKind::Interrupted => {}
            Err(e) => return Err(e),
        }
    }
    Ok(n)
}

/// Hands `each` the reader's chunks of `size` bytes in order, with their
/// number and whether each is the last. An empty reader is one empty chunk.
fn chunks(
    mut reader: impl Read,
    size: usize,
    mut each: impl FnMut(&mut [u8], u64, bool) -> Result<(), MediaError>,
) -> Result<(), MediaError> {
    let mut current = vec![0; size];
    let mut next = vec![0; size];
    let mut len = fill(&mut reader, &mut current)?;
    let mut index = 0;
    loop {
        let next_len = if len == size {
            fill(&mut reader, &mut next)?
        } else {
            0
        };
        let last = next_len == 0;
        each(&mut current[..len], index, last)?;
        if last {
            return Ok(());
        }
        std::mem::swap(&mut current, &mut next);
        len = next_len;
        index += 1;
    }
}

/// Seals the file at `from` into `to`: its size, and the hex SHA-256 of
/// what was written.
pub(crate) fn seal(from: &Path, to: &Path, key: &[u8; 32]) -> Result<(u64, String), MediaError> {
    let input = File::open(from)?;
    if input.metadata()?.len() > MAX_SIZE {
        return Err(MediaError::TooLarge);
    }
    let cipher = Aes256Gcm::new(key.into());
    let mut out = BufWriter::new(File::create(to)?);
    let mut hash = Sha256::new();
    let mut size = 0u64;
    chunks(input, SEGMENT, |segment, index, last| {
        size += segment.len() as u64;
        if size > MAX_SIZE {
            return Err(MediaError::TooLarge);
        }
        let tag = cipher
            .encrypt_in_place_detached(&nonce(index, last), b"", segment)
            .expect("a segment is far below the AES-GCM limit");
        for part in [&*segment, tag.as_slice()] {
            hash.update(part);
            out.write_all(part)?;
        }
        Ok(())
    })?;
    out.into_inner().map_err(|e| e.into_error())?.sync_all()?;
    Ok((size, hex(&hash.finalize())))
}

/// Opens the blob at `from` into `to`, checking each segment and the
/// SHA-256 of the whole. On an error `to` may hold part of the file.
pub(crate) fn open(from: &Path, to: &Path, key: &[u8], sha256: &str) -> Result<(), MediaError> {
    let key: &[u8; 32] = key.try_into().map_err(|_| MediaError::Tampered)?;
    let cipher = Aes256Gcm::new(key.into());
    let mut out = BufWriter::new(File::create(to)?);
    let mut hash = Sha256::new();
    let mut size = 0u64;
    chunks(File::open(from)?, SEGMENT + TAG, |segment, index, last| {
        hash.update(&*segment);
        let Some(split) = segment.len().checked_sub(TAG) else {
            return Err(MediaError::Tampered);
        };
        let (plain, tag) = segment.split_at_mut(split);
        size += plain.len() as u64;
        if size > MAX_SIZE {
            return Err(MediaError::TooLarge);
        }
        cipher
            .decrypt_in_place_detached(&nonce(index, last), b"", plain, Tag::from_slice(tag))
            .map_err(|_| MediaError::Tampered)?;
        out.write_all(plain)?;
        Ok(())
    })?;
    if hex(&hash.finalize()) != sha256.to_ascii_lowercase() {
        return Err(MediaError::Tampered);
    }
    out.into_inner().map_err(|e| e.into_error())?.sync_all()?;
    Ok(())
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// 128 random bits, as the API's `mediaId` takes them.
fn object_id() -> String {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).expect("the OS has randomness");
    URL_SAFE_NO_PAD.encode(bytes)
}

/// An id another member chose is checked before it names a file.
fn is_object(id: &str) -> bool {
    id.len() == 22
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// The name a file is kept under: its object id, with an extension the
/// apps' viewers know it by. The extension comes from this list only.
fn file_name(object: &str, mime: &str) -> String {
    let extension = match mime.to_ascii_lowercase().as_str() {
        "image/jpeg" => "jpg",
        "image/png" => "png",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/heic" => "heic",
        "image/heif" => "heif",
        "video/mp4" => "mp4",
        "video/quicktime" => "mov",
        "audio/mpeg" => "mp3",
        "audio/mp4" => "m4a",
        "application/pdf" => "pdf",
        "text/plain" => "txt",
        "application/zip" => "zip",
        _ => "bin",
    };
    format!("{object}.{extension}")
}

fn remove(path: &Path) {
    // Gone already is fine; anything else is retried by the next sweep.
    let _ = fs::remove_file(path);
}

/// The objects this device may still show: in the timeline or the outbox.
fn kept(tx: &Transaction) -> Result<HashSet<String>, ClientError> {
    let mut objects = HashSet::new();
    let mut statement =
        tx.prepare("SELECT detail FROM timeline WHERE kind = 'media' AND detail IS NOT NULL")?;
    for detail in statement.query_map([], |r| r.get::<_, String>(0))? {
        if let Ok(Body::Media { object, .. }) = serde_json::from_str(&detail?) {
            objects.insert(object);
        }
    }
    let mut statement = tx.prepare("SELECT intent FROM outbox WHERE kind = 'message'")?;
    for intent in statement.query_map([], |r| r.get::<_, Vec<u8>>(0))? {
        if let Ok(Envelope {
            body: Body::Media { object, .. },
            ..
        }) = Envelope::decode(&intent?)
        {
            objects.insert(object);
        }
    }
    Ok(objects)
}

/// The media body of the item at `seq`, if it is one and not deleted.
fn media_at(tx: &Transaction, group: &[u8], seq: u64) -> rusqlite::Result<Option<String>> {
    tx.query_row(
        "SELECT detail FROM timeline
         WHERE group_id = ?1 AND seq = ?2 AND kind = 'media' AND deleted = 0",
        params![group, seq as i64],
        |r| r.get(0),
    )
    .optional()
    .map(Option::flatten)
}

impl<T: Transport> Client<T> {
    /// Encrypts the file at `path`, uploads it and queues its message,
    /// which the next `sync` sends. The file is copied into the store's
    /// media folder, so this device shows it without fetching it back.
    /// Returns the envelope id, as `send` does.
    pub fn send_media(
        &mut self,
        conversation: &str,
        path: &Path,
        mime: &str,
        caption: Option<String>,
        name: Option<String>,
    ) -> Result<String, ClientError> {
        let group = group_id(conversation).ok_or(ClientError::UnknownConversation)?;
        self.store.try_write(|tx| open_conversation(tx, &group))?;
        let outgoing = self.media.join("out");
        fs::create_dir_all(&outgoing).map_err(MediaError::from)?;
        let object = object_id();
        let sealed = outgoing.join(&object);
        let mut key = [0u8; 32];
        getrandom::fill(&mut key).expect("the OS has randomness");
        let sent = (|| {
            let (size, sha256) = seal(path, &sealed, &key)?;
            authed(&self.transport, &self.token)?.put_media(conversation, &object, &sealed)?;
            fs::copy(path, self.media.join(file_name(&object, mime))).map_err(MediaError::from)?;
            Ok::<_, ClientError>(Body::Media {
                object,
                mime: mime.to_owned(),
                size,
                key: base64(&key),
                sha256,
                caption,
                name,
            })
        })();
        remove(&sealed);
        self.send(conversation, sent?)
    }

    /// The file of the media item at `seq`, downloaded, checked and
    /// decrypted on first use. The path stays valid until the item expires
    /// or is deleted.
    pub fn media(&mut self, conversation: &str, seq: u64) -> Result<PathBuf, ClientError> {
        let group = group_id(conversation).ok_or(ClientError::UnknownConversation)?;
        let detail = self.store.try_write(|tx| {
            conversation_state(tx, &group)?;
            Ok::<_, ClientError>(media_at(tx, &group, seq)?)
        })?;
        let Some(Ok(Body::Media {
            object,
            mime,
            key,
            sha256,
            ..
        })) = detail.as_deref().map(serde_json::from_str::<Body>)
        else {
            return Err(ClientError::Invalid("no media item at that seq"));
        };
        if !is_object(&object) {
            return Err(MediaError::Tampered.into());
        }
        let kept = self.media.join(file_name(&object, &mime));
        if kept.exists() {
            return Ok(kept);
        }
        let key = from_base64(&key).ok_or(MediaError::Tampered)?;
        let incoming = self.media.join("in");
        fs::create_dir_all(&incoming).map_err(MediaError::from)?;
        let (blob, plain) = (
            incoming.join(format!("{object}.blob")),
            incoming.join(&object),
        );
        let opened = (|| {
            authed(&self.transport, &self.token)?.get_media(conversation, &object, &blob)?;
            open(&blob, &plain, &key, &sha256)?;
            fs::rename(&plain, &kept).map_err(MediaError::from)?;
            Ok::<_, ClientError>(())
        })();
        remove(&blob);
        remove(&plain);
        opened.map(|()| kept)
    }

    /// Deletes the kept files no item or queued send names any more.
    pub(crate) fn sweep_media(&mut self) -> Result<(), ClientError> {
        let Ok(entries) = fs::read_dir(&self.media) else {
            return Ok(());
        };
        let kept = self.store.try_write(kept)?;
        for entry in entries.flatten() {
            let path = entry.path();
            let object = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
            if path.is_file() && !kept.contains(object) {
                remove(&path);
            }
        }
        Ok(())
    }

    /// Deletes the files of these objects.
    pub(crate) fn remove_media(&self, objects: &[String]) {
        let Ok(entries) = fs::read_dir(&self.media) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let object = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
            if objects.iter().any(|o| o == object) {
                remove(&path);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Files(tempfile::TempDir);

    impl Files {
        fn new() -> Self {
            Self(tempfile::tempdir().unwrap())
        }

        fn path(&self, name: &str) -> PathBuf {
            self.0.path().join(name)
        }

        fn round_trip(&self, plain: &[u8]) -> Vec<u8> {
            let key = [7u8; 32];
            fs::write(self.path("plain"), plain).unwrap();
            let (size, sha256) = seal(&self.path("plain"), &self.path("blob"), &key).unwrap();
            assert_eq!(size, plain.len() as u64);
            open(&self.path("blob"), &self.path("out"), &key, &sha256).unwrap();
            fs::read(self.path("out")).unwrap()
        }
    }

    #[test]
    fn a_file_opens_as_it_was_sealed_at_every_segment_edge() {
        let files = Files::new();
        for len in [0, 1, SEGMENT - 1, SEGMENT, SEGMENT + 1, 3 * SEGMENT] {
            let plain: Vec<u8> = (0..len).map(|i| (i % 251) as u8).collect();
            assert_eq!(files.round_trip(&plain), plain, "{len} bytes");
            let blob = fs::metadata(files.path("blob")).unwrap().len() as usize;
            assert_eq!(blob, len + TAG * len.div_ceil(SEGMENT).max(1));
        }
    }

    #[test]
    fn a_blob_changed_cut_or_reordered_does_not_open() {
        let files = Files::new();
        let key = [7u8; 32];
        let plain = vec![1u8; 2 * SEGMENT + 10];
        fs::write(files.path("plain"), &plain).unwrap();
        let (_, sha256) = seal(&files.path("plain"), &files.path("blob"), &key).unwrap();
        let blob = fs::read(files.path("blob")).unwrap();
        let whole = SEGMENT + TAG;
        let opens = |bytes: &[u8], sha256: &str| {
            fs::write(files.path("bad"), bytes).unwrap();
            open(&files.path("bad"), &files.path("out"), &key, sha256).is_ok()
        };
        assert!(opens(&blob, &sha256));
        // Each is checked with the hash it would need, so the segment
        // checks are what refuse it.
        let mut flipped = blob.clone();
        flipped[5] ^= 1;
        let cut = &blob[..2 * whole];
        let mut swapped = blob[whole..2 * whole].to_vec();
        swapped.extend_from_slice(&blob[..whole]);
        swapped.extend_from_slice(&blob[2 * whole..]);
        for bad in [flipped.as_slice(), cut, &swapped, &blob[..TAG - 1]] {
            let sha256 = hex(&Sha256::digest(bad));
            assert!(!opens(bad, &sha256));
        }
        // The right blob under another message's hash.
        assert!(!opens(&blob, &hex(&Sha256::digest(b"other"))));
        // Another key.
        fs::write(files.path("bad"), &blob).unwrap();
        assert!(open(&files.path("bad"), &files.path("out"), &[8u8; 32], &sha256).is_err());
    }

    #[test]
    fn a_file_over_25_mb_is_refused_before_it_is_read() {
        let files = Files::new();
        let file = File::create(files.path("big")).unwrap();
        file.set_len(MAX_SIZE + 1).unwrap();
        assert!(matches!(
            seal(&files.path("big"), &files.path("blob"), &[0u8; 32]),
            Err(MediaError::TooLarge)
        ));
    }

    #[test]
    fn an_object_id_is_22_url_safe_characters_and_others_are_refused() {
        let id = object_id();
        assert!(is_object(&id), "{id}");
        assert_ne!(object_id(), id);
        for bad in [
            "../../spjall.db",
            "",
            "a/bcdefghijklmnopqrstu",
            &"a".repeat(23),
        ] {
            assert!(!is_object(bad), "{bad}");
        }
        assert_eq!(file_name(&id, "IMAGE/JPEG"), format!("{id}.jpg"));
        assert_eq!(file_name(&id, "text/html"), format!("{id}.bin"));
    }
}
