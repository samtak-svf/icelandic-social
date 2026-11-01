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
use std::io::{self, Read};
use std::path::{Path, PathBuf};

use aes_gcm::aead::{AeadInOut, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce, Tag};
use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use sha2::{Digest as _, Sha256};
use spjall_envelope::{Body, Envelope};
use spjall_store::rusqlite::{self, OptionalExtension, Transaction, params};

use crate::api::{Transport, base64, from_base64, group_id};
use crate::blobs::BlobStore;
use crate::{Client, ClientError, authed, conversation_state, open_conversation};

/// The largest file sent, in plaintext bytes (0023).
pub const MAX_SIZE: u64 = crate::text::limits::MEDIA_BYTES;
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

/// A reader's chunks of one size in order, each with its number and
/// whether it is the last. An empty reader is one empty chunk.
struct Chunks<R> {
    reader: R,
    current: Vec<u8>,
    next: Vec<u8>,
    /// How much of `next` was read ahead; `None` before the first chunk.
    ahead: Option<usize>,
    index: u64,
    done: bool,
}

impl<R: Read> Chunks<R> {
    fn new(reader: R, size: usize) -> Self {
        Self {
            reader,
            current: vec![0; size],
            next: vec![0; size],
            ahead: None,
            index: 0,
            done: false,
        }
    }

    fn advance(&mut self) -> io::Result<Option<(&mut [u8], u64, bool)>> {
        if self.done {
            return Ok(None);
        }
        let len = match self.ahead {
            None => fill(&mut self.reader, &mut self.current)?,
            Some(len) => {
                std::mem::swap(&mut self.current, &mut self.next);
                len
            }
        };
        let next_len = if len == self.current.len() {
            fill(&mut self.reader, &mut self.next)?
        } else {
            0
        };
        let last = next_len == 0;
        self.done = last;
        self.ahead = Some(next_len);
        let index = self.index;
        self.index += 1;
        Ok(Some((&mut self.current[..len], index, last)))
    }
}

/// A `MediaError` carried through `Read`, and taken out again.
fn carried(error: MediaError) -> io::Error {
    io::Error::other(error)
}

pub(crate) fn uncarried(error: io::Error) -> MediaError {
    if error
        .get_ref()
        .is_some_and(|inner| inner.is::<MediaError>())
    {
        *error
            .into_inner()
            .and_then(|inner| inner.downcast().ok())
            .expect("checked above")
    } else {
        MediaError::File(error)
    }
}

/// The sealed form of what `inner` reads: each segment of plaintext and
/// its tag. Reading past `cap` plaintext bytes fails with `TooLarge`.
pub(crate) struct Sealer<R> {
    chunks: Chunks<R>,
    cipher: Aes256Gcm,
    cap: u64,
    size: u64,
    hash: Sha256,
    out: Vec<u8>,
    at: usize,
}

impl<R: Read> Sealer<R> {
    pub(crate) fn new(inner: R, key: &[u8; 32], cap: u64) -> Self {
        Self {
            chunks: Chunks::new(inner, SEGMENT),
            cipher: Aes256Gcm::new(key.into()),
            cap,
            size: 0,
            hash: Sha256::new(),
            out: Vec::with_capacity(SEGMENT + TAG),
            at: 0,
        }
    }

    /// The plaintext size and the hex SHA-256 of what was read.
    pub(crate) fn finish(self) -> (u64, String) {
        (self.size, hex(&self.hash.finalize()))
    }
}

impl<R: Read> Read for Sealer<R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        while self.at == self.out.len() {
            let Some((segment, index, last)) = self.chunks.advance()? else {
                return Ok(0);
            };
            self.size += segment.len() as u64;
            if self.size > self.cap {
                return Err(carried(MediaError::TooLarge));
            }
            let tag = self
                .cipher
                .encrypt_inout_detached(&nonce(index, last), b"", (&mut *segment).into())
                .expect("a segment is far below the AES-GCM limit");
            self.out.clear();
            self.out.extend_from_slice(segment);
            self.out.extend_from_slice(&tag);
            self.hash.update(&self.out);
            self.at = 0;
        }
        let n = buf.len().min(self.out.len() - self.at);
        buf[..n].copy_from_slice(&self.out[self.at..self.at + n]);
        self.at += n;
        Ok(n)
    }
}

/// The plaintext of what `inner` reads, each segment checked before any of
/// it is given out. A segment that does not open fails with `Tampered`,
/// reading past `cap` plaintext bytes with `TooLarge`. Only a read that
/// ends (`Ok(0)`) has checked the last segment.
pub(crate) struct Opener<R> {
    chunks: Chunks<R>,
    cipher: Aes256Gcm,
    cap: u64,
    size: u64,
    hash: Sha256,
    out: Vec<u8>,
    at: usize,
}

impl<R: Read> Opener<R> {
    pub(crate) fn new(inner: R, key: &[u8; 32], cap: u64) -> Self {
        Self {
            chunks: Chunks::new(inner, SEGMENT + TAG),
            cipher: Aes256Gcm::new(key.into()),
            cap,
            size: 0,
            hash: Sha256::new(),
            out: Vec::with_capacity(SEGMENT),
            at: 0,
        }
    }

    /// The hex SHA-256 of the sealed bytes read.
    pub(crate) fn sha256(self) -> String {
        hex(&self.hash.finalize())
    }
}

impl<R: Read> Read for Opener<R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        while self.at == self.out.len() {
            let Some((segment, index, last)) = self.chunks.advance()? else {
                return Ok(0);
            };
            self.hash.update(&*segment);
            let Some(split) = segment.len().checked_sub(TAG) else {
                return Err(carried(MediaError::Tampered));
            };
            let (plain, tag) = segment.split_at_mut(split);
            self.size += plain.len() as u64;
            if self.size > self.cap {
                return Err(carried(MediaError::TooLarge));
            }
            let tag = Tag::try_from(&*tag).map_err(|_| carried(MediaError::Tampered))?;
            self.cipher
                .decrypt_inout_detached(&nonce(index, last), b"", (&mut *plain).into(), &tag)
                .map_err(|_| carried(MediaError::Tampered))?;
            self.out.clear();
            self.out.extend_from_slice(plain);
            self.at = 0;
        }
        let n = buf.len().min(self.out.len() - self.at);
        buf[..n].copy_from_slice(&self.out[self.at..self.at + n]);
        self.at += n;
        Ok(n)
    }
}

/// Seals the file at `from` into `to`: its size, and the hex SHA-256 of
/// what was written.
pub(crate) fn seal(
    blobs: &dyn BlobStore,
    from: &Path,
    to: &Path,
    key: &[u8; 32],
) -> Result<(u64, String), MediaError> {
    if blobs.len(from)? > MAX_SIZE {
        return Err(MediaError::TooLarge);
    }
    let mut sealer = Sealer::new(blobs.open_read(from)?, key, MAX_SIZE);
    let mut out = blobs.create_write(to)?;
    io::copy(&mut sealer, &mut out).map_err(uncarried)?;
    out.finish()?;
    Ok(sealer.finish())
}

/// Opens the blob at `from` into `to`, checking each segment and the
/// SHA-256 of the whole. On an error `to` may hold part of the file.
pub(crate) fn open(
    blobs: &dyn BlobStore,
    from: &Path,
    to: &Path,
    key: &[u8],
    sha256: &str,
) -> Result<(), MediaError> {
    let key: &[u8; 32] = key.try_into().map_err(|_| MediaError::Tampered)?;
    let mut opener = Opener::new(blobs.open_read(from)?, key, MAX_SIZE);
    let mut out = blobs.create_write(to)?;
    io::copy(&mut opener, &mut out).map_err(uncarried)?;
    if opener.sha256() != sha256.to_ascii_lowercase() {
        return Err(MediaError::Tampered);
    }
    out.finish()?;
    Ok(())
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// 128 random bits, as the API's `mediaId` takes them.
pub(crate) fn object_id() -> String {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).expect("the OS has randomness");
    URL_SAFE_NO_PAD.encode(bytes)
}

/// An id another member chose is checked before it names a file.
pub(crate) fn is_object(id: &str) -> bool {
    id.len() == 22
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// The name a file is kept under: its object id, with an extension the
/// apps' viewers know it by. The extension comes from this list only.
pub(crate) fn file_name(object: &str, mime: &str) -> String {
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

pub(crate) fn remove(blobs: &dyn BlobStore, path: &Path) {
    // Gone already is fine; anything else is retried by the next sweep.
    let _ = blobs.remove_file(path);
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
        self.upload_and_send(conversation, path, mime, caption, name, false)
    }

    /// `send_media`, and a forwarded file (0041): always a new object id
    /// and a new key, uploaded into `conversation`, so an object and its
    /// key never serve two conversations (0023).
    pub(crate) fn upload_and_send(
        &mut self,
        conversation: &str,
        path: &Path,
        mime: &str,
        caption: Option<String>,
        name: Option<String>,
        forwarded: bool,
    ) -> Result<String, ClientError> {
        let group = group_id(conversation).ok_or(ClientError::UnknownConversation)?;
        self.store.try_write(|tx| open_conversation(tx, &group))?;
        let outgoing = self.media.join("out");
        self.blobs
            .create_dir_all(&outgoing)
            .map_err(MediaError::from)?;
        let object = object_id();
        let sealed = outgoing.join(&object);
        let mut key = [0u8; 32];
        getrandom::fill(&mut key).expect("the OS has randomness");
        let sent = (|| {
            let (size, sha256) = seal(&*self.blobs, path, &sealed, &key)?;
            authed(&self.transport, &self.token, &self.client)?.put_media(
                conversation,
                &object,
                &sealed,
            )?;
            self.blobs
                .copy(path, &self.media.join(file_name(&object, mime)))
                .map_err(MediaError::from)?;
            Ok::<_, ClientError>(Body::Media {
                object,
                mime: mime.to_owned(),
                size,
                key: base64(&key),
                sha256,
                caption,
                name,
                forwarded,
            })
        })();
        remove(&*self.blobs, &sealed);
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
        if self.blobs.exists(&kept) {
            return Ok(kept);
        }
        let key = from_base64(&key).ok_or(MediaError::Tampered)?;
        let incoming = self.media.join("in");
        self.blobs
            .create_dir_all(&incoming)
            .map_err(MediaError::from)?;
        let (blob, plain) = (
            incoming.join(format!("{object}.blob")),
            incoming.join(&object),
        );
        let opened = (|| {
            authed(&self.transport, &self.token, &self.client)?.get_media(
                conversation,
                &object,
                &blob,
            )?;
            open(&*self.blobs, &blob, &plain, &key, &sha256)?;
            self.blobs.rename(&plain, &kept).map_err(MediaError::from)?;
            Ok::<_, ClientError>(())
        })();
        remove(&*self.blobs, &blob);
        remove(&*self.blobs, &plain);
        opened.map(|()| kept)
    }

    /// Deletes the kept files no item or queued send names any more.
    pub(crate) fn sweep_media(&mut self) -> Result<(), ClientError> {
        let Ok(paths) = self.blobs.list_files(&self.media) else {
            return Ok(());
        };
        let kept = self.store.try_write(kept)?;
        for path in paths {
            let object = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
            if !kept.contains(object) {
                remove(&*self.blobs, &path);
            }
        }
        Ok(())
    }

    /// Deletes the files of these objects.
    pub(crate) fn remove_media(&self, objects: &[String]) {
        let Ok(paths) = self.blobs.list_files(&self.media) else {
            return;
        };
        for path in paths {
            let object = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
            if objects.iter().any(|o| o == object) {
                remove(&*self.blobs, &path);
            }
        }
    }
}

#[cfg(test)]
#[allow(clippy::disallowed_methods)]
mod tests {
    use super::*;
    use crate::blobs::{FsBlobs, MemBlobs};
    use std::fs::{self, File};

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
            let (size, sha256) =
                seal(&FsBlobs, &self.path("plain"), &self.path("blob"), &key).unwrap();
            assert_eq!(size, plain.len() as u64);
            open(
                &FsBlobs,
                &self.path("blob"),
                &self.path("out"),
                &key,
                &sha256,
            )
            .unwrap();
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
        let (_, sha256) = seal(&FsBlobs, &files.path("plain"), &files.path("blob"), &key).unwrap();
        let blob = fs::read(files.path("blob")).unwrap();
        let whole = SEGMENT + TAG;
        let opens = |bytes: &[u8], sha256: &str| {
            fs::write(files.path("bad"), bytes).unwrap();
            open(
                &FsBlobs,
                &files.path("bad"),
                &files.path("out"),
                &key,
                sha256,
            )
            .is_ok()
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
        assert!(
            open(
                &FsBlobs,
                &files.path("bad"),
                &files.path("out"),
                &[8u8; 32],
                &sha256
            )
            .is_err()
        );
    }

    #[test]
    fn a_file_over_25_mb_is_refused_before_it_is_read() {
        let files = Files::new();
        let file = File::create(files.path("big")).unwrap();
        file.set_len(MAX_SIZE + 1).unwrap();
        assert!(matches!(
            seal(
                &FsBlobs,
                &files.path("big"),
                &files.path("blob"),
                &[0u8; 32]
            ),
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

    /// A blob sealed by an earlier build opens with this one: the same key
    /// and file always seal to the same bytes (0023).
    #[test]
    fn a_fixed_file_seals_to_fixed_bytes() {
        let dir = tempfile::tempdir().unwrap();
        let (from, to) = (dir.path().join("in"), dir.path().join("out"));
        let file: Vec<u8> = (0..(SEGMENT as u32 + 1000))
            .map(|i| (i % 251) as u8)
            .collect();
        std::fs::write(&from, &file).unwrap();
        let (_, sha) = seal(&FsBlobs, &from, &to, &[7; 32]).unwrap();
        assert_eq!(
            sha,
            "fdf931059e0548899ec4dcc3d12bb97e5c995459f5e98f47bfc991cb98fc109c"
        );
        let mem = MemBlobs::new();
        mem.put(Path::new("in"), file.clone());
        let (mem_size, mem_sha) = seal(&mem, Path::new("in"), Path::new("out"), &[7; 32]).unwrap();
        assert_eq!(mem_size, file.len() as u64);
        assert_eq!(mem_sha, sha);
        open(
            &mem,
            Path::new("out"),
            Path::new("plain"),
            &[7; 32],
            &mem_sha,
        )
        .unwrap();
        assert_eq!(mem.get(Path::new("plain")).unwrap(), file);
    }
}
