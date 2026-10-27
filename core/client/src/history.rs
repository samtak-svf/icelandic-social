//! History from a sibling device (0064, 0074). At linking, the phone seals
//! its conversations, their timelines and the files it holds to the new
//! device's one-time X25519 key, and the server carries a blob it cannot
//! read.
//!
//! A blob is `MAGIC`, `VERSION`, the HPKE `enc` (32 bytes) and the stream
//! sealed with the key HPKE exports, in the segments media use (`media.rs`):
//! cut, reordered or grown, it does not open. The plaintext is frames, each
//! a kind, a big-endian `u64` length and that many bytes: the records first,
//! then each file as its object id and its bytes, newest first while they
//! fit under the cap, then an end frame. A file past the cap travels only
//! as its message, which names the object, its key and its hash, so the new
//! device fetches it again while the server still has it (0023).
//!
//! Import reads the whole stream before it writes a row: the files go to a
//! staging folder, the rows in one transaction, and only then the files to
//! where `media()` looks. Importing twice changes nothing the first did not.

use std::collections::{HashMap, HashSet, VecDeque};
use std::io::{self, Cursor, Read, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use spjall_envelope::{Body, PhotoRef};
use spjall_mls::hpke;
use spjall_store::rusqlite::{self, Transaction, params};

use crate::api::{Piece, Transport, base64, from_base64};
use crate::blobs::BlobStore;
use crate::clock::now;
use crate::media::{MediaError, Opener, Sealer, file_name, is_object, remove, uncarried};
use crate::{Client, ClientError, authed};

/// The largest history, in plaintext bytes (0064).
pub const MAX_HISTORY: u64 = 1024 * 1024 * 1024;

/// How much of a history one request fetches (0081): the size of a part
/// the server names, so a browser's synchronous request holds one at most.
pub const HISTORY_PIECE: u64 = 64 * 1024 * 1024;
const MAGIC: &[u8; 4] = b"SPJH";
const VERSION: u8 = 1;
/// What the HPKE key is bound to, so it opens nothing but a history.
const INFO: &[u8] = b"spjall history v1";
const HEADER: usize = MAGIC.len() + 1 + hpke::KEY;

const END: u8 = 0;
const RECORD: u8 = 1;
const OBJECT: u8 = 2;
const FILE: u8 = 3;
const FRAME: u64 = 9;
/// The largest record; a row is far smaller.
const MAX_RECORD: u64 = 4 * 1024 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum HistoryError {
    #[error("file: {0}")]
    File(#[from] io::Error),
    /// The rows alone are over the cap.
    #[error("the history is over the limit")]
    TooLarge,
    /// Not a history, another version of one, or sealed to another key.
    #[error("the history does not open")]
    Tampered,
}

impl From<MediaError> for HistoryError {
    fn from(error: MediaError) -> Self {
        match error {
            MediaError::File(error) => Self::File(error),
            MediaError::TooLarge => Self::TooLarge,
            MediaError::Tampered => Self::Tampered,
        }
    }
}

/// The new device's one-time key: the public half goes in the link QR, the
/// private half opens the history and is then dropped.
pub struct HistoryKey {
    pub private: Vec<u8>,
    pub public: Vec<u8>,
}

pub fn history_key() -> Result<HistoryKey, HistoryError> {
    let (private, public) =
        hpke::key_pair().map_err(|e| HistoryError::File(io::Error::other(e.to_string())))?;
    Ok(HistoryKey {
        private: private.to_vec(),
        public: public.to_vec(),
    })
}

/// What an import added.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct Imported {
    pub conversations: u32,
    pub items: u32,
    pub files: u32,
}

/// A row of history. Groups travel in base64; fields a later version adds
/// are ignored by an older one.
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "t", rename_all = "snake_case")]
enum Record {
    Conversation {
        group: String,
        removed: bool,
        created_at: i64,
        timer: Option<i64>,
        /// The group's name and photo (0078, 0094): folded state a linked
        /// device cannot rebuild from the cards, which only say they
        /// changed. Absent in a history from before #327.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        name: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        photo: Option<PhotoRef>,
    },
    Item {
        group: String,
        seq: i64,
        kind: String,
        sender_account: String,
        sender_device: String,
        envelope_id: Option<String>,
        ts: i64,
        stored_at: i64,
        text: Option<String>,
        reply_to: Option<String>,
        detail: Option<String>,
        edited: bool,
        deleted: bool,
        expires_at: Option<i64>,
        received_at: Option<i64>,
    },
    Reaction {
        group: String,
        seq: i64,
        account: String,
        emoji: String,
    },
    Read {
        group: String,
        account: String,
        seq: i64,
    },
    Member {
        group: String,
        account: String,
    },
    Profile {
        account: String,
        name: Option<String>,
        verified: bool,
        fetched_at: i64,
    },
}

fn frame(kind: u8, len: u64) -> [u8; FRAME as usize] {
    let mut header = [0u8; FRAME as usize];
    header[0] = kind;
    header[1..].copy_from_slice(&len.to_be_bytes());
    header
}

fn push(out: &mut Vec<u8>, kind: u8, payload: &[u8]) {
    out.extend_from_slice(&frame(kind, payload.len() as u64));
    out.extend_from_slice(payload);
}

/// The object and type of a media item's body.
fn media_of(detail: Option<&str>) -> Option<(String, String)> {
    match serde_json::from_str(detail?) {
        Ok(Body::Media { object, mime, .. }) if is_object(&object) => Some((object, mime)),
        _ => None,
    }
}

/// Media objects with their mime types, newest first.
type Objects = Vec<(String, String)>;

/// The records of everything since `since` (ms), and the files they name.
fn records(tx: &Transaction, since: Option<u64>) -> rusqlite::Result<(Vec<u8>, Objects)> {
    let mut out = Vec::new();
    let mut add = |record: Record| {
        push(
            &mut out,
            RECORD,
            &serde_json::to_vec(&record).expect("a record serialises"),
        );
    };
    let now = now();
    let since = since.unwrap_or(0) as i64;
    // A conversation the server does not have yet cannot be joined.
    let mut statement = tx.prepare(
        "SELECT group_id, state, created_at, timer, name, photo FROM conversations
         WHERE state != 'new' ORDER BY created_at",
    )?;
    let mut groups = Vec::new();
    for row in statement.query_map([], |r| {
        Ok((
            r.get::<_, Vec<u8>>(0)?,
            r.get::<_, String>(1)?,
            r.get(2)?,
            r.get(3)?,
            r.get::<_, Option<String>>(4)?,
            r.get::<_, Option<String>>(5)?,
        ))
    })? {
        let (group, state, created_at, timer, name, photo) = row?;
        add(Record::Conversation {
            group: base64(&group),
            removed: state == "removed",
            created_at,
            timer,
            name,
            photo: photo.and_then(|p| serde_json::from_str(&p).ok()),
        });
        groups.push(group);
    }
    let mut media = Vec::new();
    for group in &groups {
        let id = base64(group);
        let mut statement = tx.prepare(
            "SELECT seq, kind, sender_account, sender_device, envelope_id, ts, stored_at, text,
                    reply_to, detail, edited, deleted, expires_at, received_at
             FROM main.timeline
             WHERE group_id = ?1 AND ts >= ?2 AND (expires_at IS NULL OR expires_at > ?3)
             ORDER BY seq",
        )?;
        let rows = statement.query_map(params![group, since, now], |r| {
            Ok(Record::Item {
                group: id.clone(),
                seq: r.get(0)?,
                kind: r.get(1)?,
                sender_account: r.get(2)?,
                sender_device: r.get(3)?,
                envelope_id: r.get(4)?,
                ts: r.get(5)?,
                stored_at: r.get(6)?,
                text: r.get(7)?,
                reply_to: r.get(8)?,
                detail: r.get(9)?,
                edited: r.get(10)?,
                deleted: r.get(11)?,
                expires_at: r.get(12)?,
                received_at: r.get(13)?,
            })
        })?;
        let mut seqs = HashSet::new();
        for item in rows {
            let item = item?;
            if let Record::Item {
                kind,
                detail,
                deleted: false,
                ts,
                ..
            } = &item
                && kind == "media"
                && let Some((object, mime)) = media_of(detail.as_deref())
            {
                media.push((*ts, object, mime));
            }
            if let Record::Item { seq, .. } = &item {
                seqs.insert(*seq);
            }
            add(item);
        }
        let mut statement =
            tx.prepare("SELECT seq, account, emoji FROM reactions WHERE group_id = ?1")?;
        for row in
            statement.query_map([group], |r| Ok((r.get::<_, i64>(0)?, r.get(1)?, r.get(2)?)))?
        {
            let (seq, account, emoji) = row?;
            if seqs.contains(&seq) {
                add(Record::Reaction {
                    group: id.clone(),
                    seq,
                    account,
                    emoji,
                });
            }
        }
        let mut statement =
            tx.prepare("SELECT account, seq FROM read_state WHERE group_id = ?1")?;
        for row in statement.query_map([group], |r| Ok((r.get(0)?, r.get(1)?)))? {
            let (account, seq) = row?;
            add(Record::Read {
                group: id.clone(),
                account,
                seq,
            });
        }
        let mut statement = tx.prepare("SELECT account FROM members WHERE group_id = ?1")?;
        for account in statement.query_map([group], |r| r.get(0))? {
            add(Record::Member {
                group: id.clone(),
                account: account?,
            });
        }
    }
    // The photo is the device's own cache; the new device fetches it.
    let mut statement = tx.prepare("SELECT account, name, verified, fetched_at FROM profiles")?;
    for row in statement.query_map([], |r| {
        Ok(Record::Profile {
            account: r.get(0)?,
            name: r.get(1)?,
            verified: r.get(2)?,
            fetched_at: r.get(3)?,
        })
    })? {
        add(row?);
    }
    media.sort_by_key(|m| std::cmp::Reverse(m.0));
    Ok((out, media.into_iter().map(|(_, o, m)| (o, m)).collect()))
}

enum Part {
    Bytes(Vec<u8>),
    File { path: PathBuf, len: u64 },
}

/// The plaintext of a history, read part by part: a file is opened only
/// when the stream reaches it, so no copy of it is written anywhere.
struct Plain<'a> {
    blobs: &'a dyn BlobStore,
    parts: VecDeque<Part>,
    current: Option<Box<dyn Read + 'a>>,
}

impl Read for Plain<'_> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        loop {
            if let Some(reader) = &mut self.current {
                let n = reader.read(buf)?;
                if n > 0 || buf.is_empty() {
                    return Ok(n);
                }
                self.current = None;
            }
            self.current = match self.parts.pop_front() {
                None => return Ok(0),
                Some(Part::Bytes(bytes)) => Some(Box::new(Cursor::new(bytes))),
                Some(Part::File { path, len }) => Some(Box::new(Exact {
                    inner: self.blobs.open_read(&path)?.take(len),
                    left: len,
                })),
            };
        }
    }
}

/// Exactly `left` bytes: a file that shrank after it was measured fails
/// rather than shifting every frame after it.
struct Exact<R> {
    inner: R,
    left: u64,
}

impl<R: Read> Read for Exact<R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let n = self.inner.read(buf)?;
        if n == 0 && self.left > 0 && !buf.is_empty() {
            return Err(io::ErrorKind::UnexpectedEof.into());
        }
        self.left -= n as u64;
        Ok(n)
    }
}

/// What a whole stream held, before any of it is written.
#[derive(Default)]
struct Stream {
    records: Vec<Record>,
    /// Object id to staged file.
    files: HashMap<String, PathBuf>,
}

fn tampered(error: io::Error) -> HistoryError {
    match uncarried(error) {
        MediaError::File(error) if error.kind() == io::ErrorKind::UnexpectedEof => {
            HistoryError::Tampered
        }
        error => error.into(),
    }
}

fn read_frame(reader: &mut impl Read) -> Result<(u8, u64), HistoryError> {
    let mut header = [0u8; FRAME as usize];
    reader.read_exact(&mut header).map_err(tampered)?;
    let len = u64::from_be_bytes(header[1..].try_into().expect("8 bytes"));
    Ok((header[0], len))
}

/// The objects the records name, with their types.
fn named(records: &[Record]) -> HashMap<String, String> {
    records
        .iter()
        .filter_map(|record| match record {
            Record::Item {
                kind,
                detail,
                deleted: false,
                ..
            } if kind == "media" => media_of(detail.as_deref()),
            _ => None,
        })
        .collect()
}

fn read_stream(
    blobs: &dyn BlobStore,
    reader: &mut impl Read,
    staging: &Path,
) -> Result<Stream, HistoryError> {
    let mut read = Stream::default();
    let mut objects: Option<HashMap<String, String>> = None;
    loop {
        match read_frame(reader)? {
            (RECORD, len) if objects.is_none() && len <= MAX_RECORD => {
                let mut bytes = vec![0; len as usize];
                reader.read_exact(&mut bytes).map_err(tampered)?;
                read.records
                    .push(serde_json::from_slice(&bytes).map_err(|_| HistoryError::Tampered)?);
            }
            (OBJECT, 22) => {
                let objects = objects.get_or_insert_with(|| named(&read.records));
                let mut id = [0u8; 22];
                reader.read_exact(&mut id).map_err(tampered)?;
                let id = String::from_utf8(id.to_vec()).map_err(|_| HistoryError::Tampered)?;
                if !objects.contains_key(&id) || read.files.contains_key(&id) {
                    return Err(HistoryError::Tampered);
                }
                let (FILE, len) = read_frame(reader)? else {
                    return Err(HistoryError::Tampered);
                };
                let path = staging.join(&id);
                let mut out = blobs.create_write(&path)?;
                let copied = io::copy(&mut reader.take(len), &mut out).map_err(tampered)?;
                if copied != len {
                    return Err(HistoryError::Tampered);
                }
                out.finish()?;
                read.files.insert(id, path);
            }
            (END, 0) => {
                // Only a read that ends has checked the last segment.
                if reader.read(&mut [0u8; 1]).map_err(tampered)? != 0 {
                    return Err(HistoryError::Tampered);
                }
                return Ok(read);
            }
            _ => return Err(HistoryError::Tampered),
        }
    }
}

fn group(id: &str) -> Result<Vec<u8>, ClientError> {
    from_base64(id).ok_or(HistoryError::Tampered.into())
}

/// Writes the rows, in one transaction. A conversation this device already
/// has keeps its state and cursor; a new one is `stale`, so the next `sync`
/// joins it, or `removed` as it was. Its cursor is the newest seq imported:
/// a refused join forgets only a conversation still at 0, and a join sets
/// the cursor to its own seq.
fn write(tx: &Transaction, records: &[Record]) -> Result<Imported, ClientError> {
    let mut imported = Imported::default();
    let now = now();
    let mut newest: HashMap<&str, i64> = HashMap::new();
    for record in records {
        if let Record::Item { group, seq, .. } = record {
            let at = newest.entry(group).or_default();
            *at = (*at).max(*seq);
        }
    }
    let mut new = HashSet::new();
    for record in records {
        match record {
            Record::Conversation {
                group: id,
                removed,
                created_at,
                timer,
                name,
                photo,
            } => {
                let cursor = newest.get(id.as_str()).copied().unwrap_or(0);
                // Kept as a member's message would be: a name or a photo
                // that one would not take is left out.
                let name = name
                    .as_deref()
                    .and_then(crate::timeline::group_name)
                    .flatten();
                let photo = photo
                    .as_ref()
                    .filter(|p| crate::timeline::usable_photo(p))
                    .map(|p| serde_json::to_string(p).expect("a photo ref serializes"));
                // A photo is fetched by the next sync, as a folded one is.
                let photo_ready = if photo.is_some() { 2 } else { 0 };
                let inserted = tx.execute(
                    "INSERT INTO conversations (group_id, state, cursor, created_at, timer, noticed,
                                                name, photo, photo_ready)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?3, ?6, ?7, ?8)
                     ON CONFLICT (group_id) DO NOTHING",
                    params![
                        group(id)?,
                        if *removed { "removed" } else { "stale" },
                        cursor,
                        created_at,
                        timer,
                        name,
                        photo,
                        photo_ready,
                    ],
                )?;
                if inserted == 1 {
                    new.insert(id.as_str());
                    imported.conversations += 1;
                }
            }
            Record::Item {
                group: id,
                seq,
                kind,
                sender_account,
                sender_device,
                envelope_id,
                ts,
                stored_at,
                text,
                reply_to,
                detail,
                edited,
                deleted,
                expires_at,
                received_at,
            } => {
                if expires_at.is_some_and(|at| at <= now) {
                    continue;
                }
                imported.items += tx.execute(
                    "INSERT INTO timeline (group_id, seq, kind, sender_account, sender_device,
                                           envelope_id, ts, stored_at, text, reply_to, detail,
                                           edited, deleted, expires_at, received_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
                     ON CONFLICT (group_id, seq) DO NOTHING",
                    params![
                        group(id)?,
                        seq,
                        kind,
                        sender_account,
                        sender_device,
                        envelope_id,
                        ts,
                        stored_at,
                        text,
                        reply_to,
                        detail,
                        edited,
                        deleted,
                        expires_at,
                        received_at,
                    ],
                )? as u32;
            }
            Record::Reaction {
                group: id,
                seq,
                account,
                emoji,
            } => {
                tx.execute(
                    "INSERT INTO reactions (group_id, seq, account, emoji)
                     SELECT ?1, ?2, ?3, ?4
                     WHERE EXISTS (SELECT 1 FROM timeline WHERE group_id = ?1 AND seq = ?2)
                     ON CONFLICT DO NOTHING",
                    params![group(id)?, seq, account, emoji],
                )?;
            }
            Record::Read {
                group: id,
                account,
                seq,
            } => {
                tx.execute(
                    "INSERT INTO read_state (group_id, account, seq) VALUES (?1, ?2, ?3)
                     ON CONFLICT (group_id, account) DO UPDATE SET seq = MAX(seq, excluded.seq)",
                    params![group(id)?, account, seq],
                )?;
            }
            // A join rewrites the members from the group; until then, those
            // the phone knew.
            Record::Member { group: id, account } if new.contains(id.as_str()) => {
                tx.execute(
                    "INSERT INTO members (group_id, account) VALUES (?1, ?2)
                     ON CONFLICT DO NOTHING",
                    params![group(id)?, account],
                )?;
            }
            Record::Member { .. } => {}
            Record::Profile {
                account,
                name,
                verified,
                fetched_at,
            } => {
                tx.execute(
                    "INSERT INTO profiles (account, name, verified, fetched_at)
                     VALUES (?1, ?2, ?3, ?4) ON CONFLICT DO NOTHING",
                    params![account, name, verified, fetched_at],
                )?;
            }
        }
    }
    Ok(imported)
}

/// The rows, then each file in `media` (newest first) that still fits
/// under `cap` with everything before it, then the end. A file that is
/// gone or does not fit stays a reference in its row.
fn parts(
    blobs: &dyn BlobStore,
    media_dir: &Path,
    rows: Vec<u8>,
    media: Objects,
    cap: u64,
) -> Result<VecDeque<Part>, HistoryError> {
    let mut used = rows.len() as u64 + FRAME;
    if used > cap {
        return Err(HistoryError::TooLarge);
    }
    let mut parts = VecDeque::from([Part::Bytes(rows)]);
    for (object, mime) in media {
        let path = media_dir.join(file_name(&object, &mime));
        let Ok(len) = blobs.len(&path) else {
            continue;
        };
        let cost = FRAME + object.len() as u64 + FRAME + len;
        if used + cost > cap {
            continue;
        }
        used += cost;
        let mut header = Vec::with_capacity(2 * FRAME as usize + object.len());
        push(&mut header, OBJECT, object.as_bytes());
        header.extend_from_slice(&frame(FILE, len));
        parts.push_back(Part::Bytes(header));
        parts.push_back(Part::File { path, len });
    }
    parts.push_back(Part::Bytes(frame(END, 0).to_vec()));
    Ok(parts)
}

impl<T: Transport> Client<T> {
    /// Seals this device's history since `since` (ms; all of it when none)
    /// to `recipient`, the new device's public key, into `to`. Files newest
    /// first go in while the whole stays under 1 GiB. Returns the blob's size.
    pub fn export_history(
        &mut self,
        since: Option<u64>,
        recipient: &[u8],
        to: &Path,
    ) -> Result<u64, ClientError> {
        let (rows, media) = self.store.try_write(|tx| records(tx, since))?;
        let parts = parts(&*self.blobs, &self.media, rows, media, MAX_HISTORY)?;
        let (enc, key) = hpke::seal_key(recipient, INFO).map_err(|_| HistoryError::Tampered)?;
        let plain = Plain {
            blobs: &*self.blobs,
            parts,
            current: None,
        };
        let mut sealer = Sealer::new(plain, &key, MAX_HISTORY);
        let mut out = self.blobs.create_write(to).map_err(HistoryError::from)?;
        let written = (|| {
            out.write_all(MAGIC)?;
            out.write_all(&[VERSION])?;
            out.write_all(&enc)?;
            io::copy(&mut sealer, &mut out)
        })()
        .map_err(|error| HistoryError::from(uncarried(error)))?;
        out.finish().map_err(HistoryError::from)?;
        Ok(HEADER as u64 + written)
    }

    /// Opens the history at `from` with the private half of this device's
    /// one-time key and adds it to the store. Nothing is written unless all
    /// of it opens; importing it again adds nothing.
    pub fn import_history(&mut self, from: &Path, private: &[u8]) -> Result<Imported, ClientError> {
        self.import_parts(&[from.to_path_buf()], private)
    }

    /// `import_history` over a history held in `parts`, read one after the
    /// other as if they were one file.
    fn import_parts(&mut self, parts: &[PathBuf], private: &[u8]) -> Result<Imported, ClientError> {
        let mut reader = Chain {
            blobs: &*self.blobs,
            parts: parts.iter().collect(),
            current: None,
        };
        let mut header = [0u8; HEADER];
        reader.read_exact(&mut header).map_err(tampered)?;
        if &header[..MAGIC.len()] != MAGIC || header[MAGIC.len()] != VERSION {
            return Err(HistoryError::Tampered.into());
        }
        let key = hpke::open_key(&header[MAGIC.len() + 1..], private, INFO)
            .map_err(|_| HistoryError::Tampered)?;
        let staging = self.media.join("history");
        let _ = self.blobs.remove_dir_all(&staging);
        self.blobs
            .create_dir_all(&staging)
            .map_err(HistoryError::from)?;
        let mut opener = Opener::new(reader, &key, MAX_HISTORY);
        let result = (|| {
            let read = read_stream(&*self.blobs, &mut opener, &staging)?;
            let objects = named(&read.records);
            let mut imported = self.store.try_write(|tx| write(tx, &read.records))?;
            for (object, staged) in &read.files {
                let kept = self.media.join(file_name(object, &objects[object]));
                if !self.blobs.exists(&kept) {
                    self.blobs
                        .rename(staged, &kept)
                        .map_err(HistoryError::from)?;
                    imported.files += 1;
                }
            }
            Ok::<_, ClientError>(imported)
        })();
        let _ = self.blobs.remove_dir_all(&staging);
        result
    }

    /// Sends this device's history since `since` to the device the link
    /// `link` makes, sealed to `recipient`, the link's one-time public key:
    /// exported, then uploaded in the parts the server asks for (0074).
    /// Only the phone that approved the link may. Returns the sealed size.
    pub fn send_history(
        &mut self,
        link: &str,
        since: Option<u64>,
        recipient: &[u8],
    ) -> Result<u64, ClientError> {
        let outgoing = self.media.join("out");
        self.blobs
            .create_dir_all(&outgoing)
            .map_err(HistoryError::from)?;
        let (sealed, part) = (outgoing.join("history"), outgoing.join("history.part"));
        let sent = (|| {
            let size = self.export_history(since, recipient, &sealed)?;
            let api = authed(&self.transport, &self.token, &self.client)?;
            let transfer = api.create_history_transfer(link, size)?;
            let mut reader = self.blobs.open_read(&sealed).map_err(HistoryError::from)?;
            for number in 1..=transfer.parts {
                let mut out = self.blobs.create_write(&part).map_err(HistoryError::from)?;
                io::copy(&mut (&mut reader).take(transfer.part_size), &mut out)
                    .map_err(HistoryError::from)?;
                out.finish().map_err(HistoryError::from)?;
                api.put_history_part(link, number, &part)?;
            }
            api.complete_history_transfer(link)?;
            Ok::<_, ClientError>(size)
        })();
        remove(&*self.blobs, &part);
        remove(&*self.blobs, &sealed);
        sent
    }

    /// Receives the history the phone that approved `link` sent this
    /// device, opens it with the private half of the link's one-time key,
    /// and then deletes it from the server (0074).
    ///
    /// It is fetched in pieces of `HISTORY_PIECE` bytes (0081), so a
    /// transport never holds more than one in memory.
    pub fn receive_history(&mut self, link: &str, private: &[u8]) -> Result<Imported, ClientError> {
        self.receive_history_in(link, private, HISTORY_PIECE)
    }

    /// `receive_history` with pieces of `piece` bytes.
    ///
    /// Each piece is a `Range` request written to its own file. A piece
    /// shorter than asked for, or a 416, ends the file; a 200 is the whole
    /// file from a server that ignores ranges (0081). The pieces are read
    /// back as one stream, never joined on disk.
    pub fn receive_history_in(
        &mut self,
        link: &str,
        private: &[u8],
        piece: u64,
    ) -> Result<Imported, ClientError> {
        let piece = piece.max(1);
        let incoming = self.media.join("in");
        let _ = self.blobs.remove_dir_all(&incoming);
        self.blobs
            .create_dir_all(&incoming)
            .map_err(HistoryError::from)?;
        let received = (|| {
            let mut parts: Vec<PathBuf> = Vec::new();
            let mut first = 0u64;
            let api = authed(&self.transport, &self.token, &self.client)?;
            loop {
                // The server keeps at most `MAX_HISTORY` of ciphertext and
                // framing; a server that goes on is broken, not generous.
                if first > MAX_HISTORY + MAX_RECORD {
                    return Err(HistoryError::TooLarge.into());
                }
                let part = incoming.join(format!("history.{}", parts.len()));
                match api.get_history_range(link, first, first + piece - 1, &part)? {
                    Piece::Past => break,
                    Piece::Whole => {
                        parts = vec![part];
                        break;
                    }
                    Piece::Slice => {
                        let size = self.blobs.len(&part).map_err(HistoryError::from)?;
                        parts.push(part);
                        if size < piece {
                            break;
                        }
                        first += piece;
                    }
                }
            }
            if parts.is_empty() {
                return Err(HistoryError::Tampered.into());
            }
            let imported = self.import_parts(&parts, private)?;
            // Kept on a failure: the server deletes it after 24 hours, and
            // it opens only with the key this device drops.
            let _ = authed(&self.transport, &self.token, &self.client)?.delete_history(link);
            Ok::<_, ClientError>(imported)
        })();
        let _ = self.blobs.remove_dir_all(&incoming);
        received
    }
}

/// Files read one after the other as one.
struct Chain<'a> {
    blobs: &'a dyn BlobStore,
    parts: VecDeque<&'a PathBuf>,
    current: Option<Box<dyn Read>>,
}

impl Read for Chain<'_> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        loop {
            let Some(reader) = &mut self.current else {
                let Some(next) = self.parts.pop_front() else {
                    return Ok(0);
                };
                self.current = Some(self.blobs.open_read(next)?);
                continue;
            };
            match reader.read(buf)? {
                0 => self.current = None,
                n => return Ok(n),
            }
        }
    }
}

#[cfg(test)]
mod tests;
