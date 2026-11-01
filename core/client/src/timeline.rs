//! The timeline of 0022: each conversation folded once, in the transaction
//! that stores the message, into rows the apps draw as they are. An item's
//! id is its seq. Edits, deletes and reactions change the row they address;
//! receipts move read marks; a commit or a timer change is a card.
//!
//! Only a sender changes its own messages: an edit or a delete addresses an
//! envelope id of the same account. A reaction or a receipt can address
//! anyone's. Anything that addresses no row here is dropped.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use spjall_envelope::{Body, Envelope, PhotoRef, is_place};
use spjall_mls::group::Device;
use spjall_store::rusqlite::{self, OptionalExtension, Transaction, params};

use crate::members::{Person, person};
use crate::read::{advance, landing, read_by, read_here, settings};
use crate::{ClientError, now};

/// Where an item stands: on the server, or still in the outbox.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    Sent,
    /// Queued, or sent and not yet fetched back.
    Pending,
    /// The last send got no answer; `retry()` sends it again.
    Failed,
}

/// The message a reply quotes; `sender` and `text` are none when it is not
/// on this device, or deleted.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Quote {
    pub envelope_id: String,
    pub sender: Option<Person>,
    pub text: Option<String>,
    /// The post, when the quoted message is a shared post (0040); its
    /// `text` is then none, and the app draws the fixed line of 0044.
    pub post_id: Option<String>,
    /// The quoted message is a location (0059); its `text` is none, and the
    /// app draws "Staðsetning", never the place.
    pub location: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Content {
    Text {
        text: String,
        reply_to: Option<Quote>,
    },
    Media {
        mime: String,
        size: u64,
        caption: Option<String>,
        /// The sender's name for the file, cut to something safe to name a
        /// copy with; `None` when it had none or nothing safe was left.
        name: Option<String>,
    },
    /// Deleted for everyone.
    Deleted,
    /// A commit changed who is here: accounts added or removed, and new
    /// devices of accounts already here (the "new device" of 0006).
    Members {
        added: Vec<Person>,
        removed: Vec<Person>,
        devices: Vec<Person>,
    },
    /// The disappearing timer was set, or turned off.
    Timer { seconds: Option<u32> },
    /// The group was named, or its name cleared (0078).
    Name { name: Option<String> },
    /// The group's photo was set or replaced (`set`), or cleared (0094).
    /// The picture is `Conversation::photo`, never part of the card.
    Photo { set: bool },
    /// A post shared here under 0040: only its id. Since 0080 the app resolves
    /// it as a card (#288), which shows only what the post's own access
    /// check shows; where that fails, a fixed line.
    Post { post_id: String },
    /// A place sent once (0059), in WGS 84 microdegrees, and the fix's
    /// radius in metres when the system gave one.
    Location {
        lat_e6: i32,
        lon_e6: i32,
        accuracy: Option<u32>,
    },
    /// A stored row this core cannot decode (0051), with its code from the
    /// vocabulary of 0049. It keeps the row's place; nothing of its content
    /// is shown.
    Unreadable { code: String },
}

impl Content {
    fn unreadable(reason: &'static str) -> Self {
        Self::Unreadable {
            code: format!("protocol/{reason}"),
        }
    }
}

/// One emoji on an item: who put it there, and whether this account did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Reaction {
    pub emoji: String,
    pub own: bool,
    pub people: Vec<Person>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Item {
    /// The id, and the order. Pending until the server answers.
    pub seq: Option<u64>,
    /// None for a card.
    pub envelope_id: Option<String>,
    /// The sender, or the account whose commit a card shows.
    pub sender: Person,
    /// Sent by this account, from any of its devices.
    pub own: bool,
    /// The sender's clock, in milliseconds; never used for order.
    pub ts: u64,
    /// When the server stored it, in milliseconds by its clock, never
    /// earlier than the item before (0048). None while it is being sent,
    /// and for rows stored before the server gave it.
    pub received_at: Option<u64>,
    pub status: Status,
    pub content: Content,
    pub edited: bool,
    pub reactions: Vec<Reaction>,
    /// How many accounts besides the sender have read it; counted for this
    /// account's own messages, and only with read markers on.
    pub read_by: u32,
    /// The members besides this account who have read up to here and no
    /// further (0125); empty with read markers off and while being sent.
    pub read_here: Vec<Person>,
    /// When it disappears, in milliseconds.
    pub expires_at: Option<u64>,
    /// A copy of a message from another conversation (0041). Its author
    /// is not known here: `sender` is who forwarded it.
    pub forwarded: bool,
}

/// What a text row keeps besides its text: only the forward mark, so far.
#[derive(Default, Serialize, Deserialize)]
struct TextMarks {
    #[serde(default)]
    forwarded: bool,
}

/// Why a message cannot be forwarded (0041).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Unforwardable {
    /// It is under a disappearing timer.
    Disappearing,
    /// It was deleted for everyone.
    Deleted,
    /// No text or file at that seq on this device: a shared post (0044), a
    /// card, a hidden message, one not fetched yet, or nothing.
    NotAMessage,
}

/// The content a forward copies, as it reads now.
pub(crate) enum Forwardable {
    Text(String),
    Media {
        mime: String,
        caption: Option<String>,
        name: Option<String>,
    },
    Location {
        lat_e6: i32,
        lon_e6: i32,
        accuracy: Option<u32>,
    },
}

#[derive(Serialize, Deserialize)]
struct MembersCard {
    added: Vec<String>,
    removed: Vec<String>,
    devices: Vec<String>,
}

#[derive(Serialize, Deserialize)]
struct TimerCard {
    seconds: Option<u32>,
}

#[derive(Serialize, Deserialize)]
struct NameCard {
    name: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct PhotoCard {
    set: bool,
}

/// A photo ref another member sent, if it names something this device may
/// fetch and show: an object id of ours, a JPEG (all the core ever seals),
/// no larger than the core makes one (0094).
pub(crate) fn usable_photo(photo: &PhotoRef) -> bool {
    crate::media::is_object(&photo.id)
        && photo.mime == "image/jpeg"
        && photo.size <= crate::group_photo::MAX_BYTES
}

fn set_photo(tx: &Transaction, group: &[u8], photo: &Option<PhotoRef>) -> rusqlite::Result<()> {
    let photo = photo
        .as_ref()
        .map(|p| serde_json::to_string(p).expect("a photo ref serializes"));
    tx.execute(
        "UPDATE conversations SET photo = ?2, photo_ready = 2 WHERE group_id = ?1",
        params![group, photo],
    )
    .map(drop)
}

/// The photo a conversation has now, if it has one.
pub(crate) fn photo_of(tx: &Transaction, group: &[u8]) -> rusqlite::Result<Option<PhotoRef>> {
    let json: Option<String> = tx.query_row(
        "SELECT photo FROM conversations WHERE group_id = ?1",
        [group],
        |r| r.get(0),
    )?;
    Ok(json.and_then(|j| serde_json::from_str(&j).ok()))
}

/// A group's name as it is kept (0078): trimmed, 1 to 64 characters, no
/// control characters. `Some(None)` for a blank one, which clears the
/// name; `None` for a name that is not allowed.
pub(crate) fn group_name(sent: &str) -> Option<Option<String>> {
    let name = sent.trim();
    if name.is_empty() {
        return Some(None);
    }
    let fits = crate::text::text_length(name) <= crate::text::limits::GROUP_NAME_CHARS;
    (fits && !name.chars().any(char::is_control)).then(|| Some(name.to_owned()))
}

/// A file name a peer sent, as a name and never a path: the last component,
/// without control characters, at most 120 characters. `None` when nothing
/// usable is left.
pub(crate) fn file_name(sent: &str) -> Option<String> {
    let last = sent.rsplit(['/', '\\']).next().unwrap_or_default();
    let name: String = last.chars().filter(|c| !c.is_control()).take(120).collect();
    let name = name.trim();
    (!name.is_empty() && name != "." && name != "..").then(|| name.to_owned())
}

fn json(value: &impl Serialize) -> String {
    serde_json::to_string(value).expect("cards serialize")
}

fn is_group(tx: &Transaction, group: &[u8]) -> rusqlite::Result<bool> {
    Ok(crate::members::members(tx, group)?.len() > 2)
}

fn set_name(tx: &Transaction, group: &[u8], name: &Option<String>) -> rusqlite::Result<()> {
    tx.execute(
        "UPDATE conversations SET name = ?2 WHERE group_id = ?1",
        params![group, name],
    )
    .map(drop)
}

/// A card a settings envelope writes: no envelope id, so it takes no
/// reaction, receipt or expiry.
fn card(
    tx: &Transaction,
    group: &[u8],
    seq: u64,
    sender: &Device,
    ts: u64,
    kind: &'static str,
    detail: String,
) -> rusqlite::Result<()> {
    insert(
        tx,
        group,
        seq,
        Row {
            kind,
            sender,
            envelope_id: None,
            ts,
            text: None,
            reply_to: None,
            detail: Some(detail),
        },
    )
}

/// A message row of this account addressed by an edit or a delete.
fn own_target(
    tx: &Transaction,
    group: &[u8],
    account: &str,
    envelope_id: &str,
) -> rusqlite::Result<Option<u64>> {
    tx.query_row(
        "SELECT seq FROM timeline
         WHERE group_id = ?1 AND envelope_id = ?2 AND sender_account = ?3 AND deleted = 0
         ORDER BY seq LIMIT 1",
        params![group, envelope_id, account],
        |r| r.get::<_, i64>(0).map(|s| s as u64),
    )
    .optional()
}

/// Any message row with this envelope id, the first if two senders used it.
fn target(tx: &Transaction, group: &[u8], envelope_id: &str) -> rusqlite::Result<Option<u64>> {
    tx.query_row(
        "SELECT seq FROM timeline WHERE group_id = ?1 AND envelope_id = ?2
         ORDER BY seq LIMIT 1",
        params![group, envelope_id],
        |r| r.get::<_, i64>(0).map(|s| s as u64),
    )
    .optional()
}

/// The emoji `account` shows on the message `envelope_id` as this device
/// sees it (0101): the folded rows, with the queued reactions of `group`'s
/// outbox applied over them in order, an add replacing and a remove taking
/// back, as the fold and the overlay do.
pub(crate) fn own_reactions(
    tx: &Transaction,
    group: &[u8],
    account: &str,
    envelope_id: &str,
) -> Result<Vec<String>, ClientError> {
    let mut shown: Vec<String> = match target(tx, group, envelope_id)? {
        Some(t) => tx
            .prepare(
                "SELECT emoji FROM reactions
                 WHERE group_id = ?1 AND seq = ?2 AND account = ?3 ORDER BY emoji",
            )?
            .query_map(params![group, t as i64, account], |r| r.get(0))?
            .collect::<rusqlite::Result<_>>()?,
        None => Vec::new(),
    };
    let mut statement = tx.prepare(
        "SELECT intent FROM outbox WHERE group_id = ?1 AND kind = 'message' ORDER BY id",
    )?;
    let queued: Vec<Vec<u8>> = statement
        .query_map([group], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    for intent in queued {
        if let Ok(Envelope {
            body:
                Body::Reaction {
                    target,
                    emoji,
                    remove,
                },
            ..
        }) = Envelope::decode(&intent)
            && target == envelope_id
            && !emoji.is_empty()
        {
            if remove {
                shown.retain(|e| *e != emoji);
            } else {
                shown = vec![emoji];
            }
        }
    }
    Ok(shown)
}

struct Row<'a> {
    kind: &'a str,
    sender: &'a Device,
    envelope_id: Option<&'a str>,
    ts: u64,
    text: Option<&'a str>,
    reply_to: Option<&'a str>,
    detail: Option<String>,
}

/// Gives the row at `seq` the time the server stored it, raised to the row
/// before's so times never go back along `seq` (0048). A row that has a time
/// keeps it, and a seq with no row (an edit, a reaction) changes nothing.
pub(crate) fn received(tx: &Transaction, group: &[u8], seq: u64, at: u64) -> rusqlite::Result<()> {
    tx.execute(
        "UPDATE timeline SET received_at = MAX(?3, COALESCE(
             (SELECT MAX(received_at) FROM timeline WHERE group_id = ?1 AND seq < ?2), 0))
         WHERE group_id = ?1 AND seq = ?2 AND received_at IS NULL",
        params![group, seq as i64, at as i64],
    )?;
    Ok(())
}

fn insert(tx: &Transaction, group: &[u8], seq: u64, row: Row) -> rusqlite::Result<()> {
    let message = row.envelope_id.is_some();
    let timer: Option<i64> = tx.query_row(
        "SELECT timer FROM conversations WHERE group_id = ?1",
        [group],
        |r| r.get(0),
    )?;
    let stored_at = now();
    let expires_at = timer.filter(|_| message).map(|t| stored_at + t * 1000);
    tx.execute(
        "INSERT INTO timeline (group_id, seq, kind, sender_account, sender_device, envelope_id,
                               ts, stored_at, text, reply_to, detail, expires_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
         ON CONFLICT (group_id, seq) DO NOTHING",
        params![
            group,
            seq as i64,
            row.kind,
            row.sender.account,
            row.sender.device,
            row.envelope_id,
            row.ts as i64,
            stored_at,
            row.text,
            row.reply_to,
            row.detail,
            expires_at,
        ],
    )
    .map(drop)
}

/// Folds one stored envelope; the seqs whose items changed, or none when
/// nothing a screen shows did. An empty list means only read state moved.
pub(crate) fn fold(
    tx: &Transaction,
    group: &[u8],
    seq: u64,
    sender: &Device,
    envelope: &Envelope,
    me: &str,
) -> Result<Option<Vec<u64>>, ClientError> {
    let message = |kind, text, reply_to, detail| Row {
        kind,
        sender,
        envelope_id: Some(&envelope.id),
        ts: envelope.ts,
        text,
        reply_to,
        detail,
    };
    let changed = match &envelope.body {
        Body::Text { text, forwarded } => {
            let marks = forwarded.then(|| json(&TextMarks { forwarded: true }));
            insert(tx, group, seq, message("text", Some(text), None, marks))?;
            vec![seq]
        }
        Body::Reply { to, text } => {
            insert(tx, group, seq, message("text", Some(text), Some(to), None))?;
            vec![seq]
        }
        body @ Body::Media { caption, .. } => {
            let detail = serde_json::to_string(body).expect("a body serializes");
            insert(
                tx,
                group,
                seq,
                message("media", caption.as_deref(), None, Some(detail)),
            )?;
            vec![seq]
        }
        body @ Body::Post { .. } => {
            let detail = serde_json::to_string(body).expect("a body serializes");
            insert(tx, group, seq, message("post", None, None, Some(detail)))?;
            vec![seq]
        }
        // A place off the globe is skipped as an unknown kind is (0059).
        Body::Location { lat_e6, lon_e6, .. } if !is_place(*lat_e6, *lon_e6) => return Ok(None),
        body @ Body::Location { .. } => {
            let detail = serde_json::to_string(body).expect("a body serializes");
            insert(
                tx,
                group,
                seq,
                message("location", None, None, Some(detail)),
            )?;
            vec![seq]
        }
        Body::Edit { target, text } => {
            let Some(t) = own_target(tx, group, &sender.account, target)? else {
                return Ok(None);
            };
            // A share has no text of its own to edit (0040), nor a place (0059).
            let kind: String = tx.query_row(
                "SELECT kind FROM timeline WHERE group_id = ?1 AND seq = ?2",
                params![group, t as i64],
                |r| r.get(0),
            )?;
            if kind == "post" || kind == "location" {
                return Ok(None);
            }
            tx.execute(
                "UPDATE timeline SET text = ?3, edited = 1 WHERE group_id = ?1 AND seq = ?2",
                params![group, t as i64, text],
            )?;
            vec![t]
        }
        Body::Delete { target } => {
            let Some(t) = own_target(tx, group, &sender.account, target)? else {
                return Ok(None);
            };
            tx.execute(
                "UPDATE timeline SET deleted = 1, text = NULL, reply_to = NULL, detail = NULL
                 WHERE group_id = ?1 AND seq = ?2",
                params![group, t as i64],
            )?;
            tx.execute(
                "DELETE FROM reactions WHERE group_id = ?1 AND seq = ?2",
                params![group, t as i64],
            )?;
            vec![t]
        }
        Body::Reaction {
            target: id,
            emoji,
            remove,
        } => {
            let Some(t) = target(tx, group, id)? else {
                return Ok(None);
            };
            let deleted: bool = tx.query_row(
                "SELECT deleted FROM timeline WHERE group_id = ?1 AND seq = ?2",
                params![group, t as i64],
                |r| r.get(0),
            )?;
            if deleted || emoji.is_empty() {
                return Ok(None);
            }
            if *remove {
                // Takes back only the emoji named: a late remove of an old
                // one does not undo the one that replaced it.
                if tx.execute(
                    "DELETE FROM reactions
                     WHERE group_id = ?1 AND seq = ?2 AND account = ?3 AND emoji = ?4",
                    params![group, t as i64, sender.account, emoji],
                )? == 0
                {
                    return Ok(None);
                }
            } else {
                // One reaction per person (0101): the newest add replaces the
                // earlier one, and envelopes fold in server order, so every
                // device ends on the same emoji.
                let same: bool = tx.query_row(
                    "SELECT COUNT(*) = 1 AND MAX(emoji = ?4) FROM reactions
                     WHERE group_id = ?1 AND seq = ?2 AND account = ?3",
                    params![group, t as i64, sender.account, emoji],
                    |r| r.get(0),
                )?;
                if same {
                    return Ok(None);
                }
                tx.execute(
                    "DELETE FROM reactions WHERE group_id = ?1 AND seq = ?2 AND account = ?3",
                    params![group, t as i64, sender.account],
                )?;
                tx.execute(
                    "INSERT INTO reactions (group_id, seq, account, emoji)
                     VALUES (?1, ?2, ?3, ?4)",
                    params![group, t as i64, sender.account, emoji],
                )?;
            }
            vec![t]
        }
        Body::Disappearing { seconds } => {
            let seconds = seconds.filter(|s| *s > 0);
            tx.execute(
                "UPDATE conversations SET timer = ?2 WHERE group_id = ?1",
                params![group, seconds],
            )?;
            insert(
                tx,
                group,
                seq,
                Row {
                    kind: "timer",
                    sender,
                    envelope_id: None,
                    ts: envelope.ts,
                    text: None,
                    reply_to: None,
                    detail: Some(json(&TimerCard { seconds })),
                },
            )?;
            vec![seq]
        }
        Body::Receipt { up_to } => {
            let Some(t) = target(tx, group, up_to)? else {
                return Ok(None);
            };
            let Some(old) = advance(tx, group, &sender.account, t)? else {
                return Ok(None);
            };
            if sender.account == me {
                return Ok(Some(Vec::new()));
            }
            // This account's messages the reader has now read, and the two
            // where the reader's face was and now is (0125).
            let mut statement = tx.prepare(
                "SELECT seq FROM timeline
                 WHERE group_id = ?1 AND sender_account = ?2 AND seq > ?3 AND seq <= ?4
                       AND envelope_id IS NOT NULL
                 ORDER BY seq",
            )?;
            let rows = statement.query_map(params![group, me, old as i64, t as i64], |r| {
                r.get::<_, i64>(0).map(|s| s as u64)
            })?;
            let mut changed = rows.collect::<rusqlite::Result<Vec<u64>>>()?;
            changed.extend(landing(tx, group, old)?);
            changed.extend(landing(tx, group, t)?);
            changed.sort_unstable();
            changed.dedup();
            changed
        }
        Body::Name { name } => {
            let Some(name) = name.as_deref().map_or(Some(None), group_name) else {
                return Ok(None);
            };
            if !is_group(tx, group)? {
                return Ok(None);
            }
            set_name(tx, group, &name)?;
            card(
                tx,
                group,
                seq,
                sender,
                envelope.ts,
                "name",
                json(&NameCard { name }),
            )?;
            vec![seq]
        }
        // A photo is a group's (0094): one sent to two is dropped, and so is
        // one that names nothing this device could open.
        Body::Photo { photo } => {
            if photo.as_ref().is_some_and(|p| !usable_photo(p)) || !is_group(tx, group)? {
                return Ok(None);
            }
            set_photo(tx, group, photo)?;
            card(
                tx,
                group,
                seq,
                sender,
                envelope.ts,
                "photo",
                json(&PhotoCard {
                    set: photo.is_some(),
                }),
            )?;
            vec![seq]
        }
        // A snapshot for whoever joined (0078): what it changes takes, and
        // a card shows the name if it changed, else the photo, else the
        // timer. One that changes nothing writes nothing.
        Body::Settings { name, timer, photo } => {
            let Some(name) = name.as_deref().map_or(Some(None), group_name) else {
                return Ok(None);
            };
            let timer = timer.filter(|s| *s > 0);
            let (was_name, was_timer): (Option<String>, Option<u32>) = tx.query_row(
                "SELECT name, timer FROM conversations WHERE group_id = ?1",
                [group],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )?;
            let group_of_many = is_group(tx, group)?;
            let renamed = name != was_name && group_of_many;
            let retimed = timer != was_timer;
            let photo = photo.clone().filter(usable_photo);
            // A snapshot never clears: one from before 0094 has no photo to send.
            let repictured = group_of_many && photo.is_some() && photo != photo_of(tx, group)?;
            if renamed {
                set_name(tx, group, &name)?;
            }
            if repictured {
                set_photo(tx, group, &photo)?;
            }
            if retimed {
                tx.execute(
                    "UPDATE conversations SET timer = ?2 WHERE group_id = ?1",
                    params![group, timer],
                )?;
            }
            let (kind, detail) = if renamed {
                ("name", json(&NameCard { name }))
            } else if repictured {
                (
                    "photo",
                    json(&PhotoCard {
                        set: photo.is_some(),
                    }),
                )
            } else if retimed {
                ("timer", json(&TimerCard { seconds: timer }))
            } else {
                return Ok(None);
            };
            card(tx, group, seq, sender, envelope.ts, kind, detail)?;
            vec![seq]
        }
        // The leaver's devices are no longer served: the next check
        // removes them, and its commit writes the card (0078).
        Body::Leave {} => {
            if sender.account != me {
                tx.execute(
                    "UPDATE conversations SET devices_checked_at = NULL WHERE group_id = ?1",
                    [group],
                )?;
            }
            return Ok(None);
        }
        Body::Typing { .. } | Body::Unknown { .. } => return Ok(None),
    };
    // What this account sends, it has read up to.
    if sender.account == me
        && matches!(
            envelope.body,
            Body::Text { .. }
                | Body::Reply { .. }
                | Body::Media { .. }
                | Body::Post { .. }
                | Body::Location { .. }
        )
    {
        advance(tx, group, me, seq)?;
    }
    Ok(Some(changed))
}

/// The conversations and seqs removed by the purge, and the media objects
/// the removed rows held.
pub(crate) type Purged = (Vec<(Vec<u8>, Vec<u64>)>, Vec<String>);

/// Deletes every row whose disappearing time is up at `now`, from the
/// timeline (its reactions with it) and the history (0022).
pub(crate) fn purge(tx: &Transaction, now: i64) -> rusqlite::Result<Purged> {
    let mut statement = tx.prepare(
        "SELECT group_id, seq, detail FROM timeline
         WHERE expires_at <= ?1 ORDER BY group_id, seq",
    )?;
    let rows = statement.query_map([now], |r| {
        Ok((
            r.get::<_, Vec<u8>>(0)?,
            r.get::<_, i64>(1)? as u64,
            r.get::<_, Option<String>>(2)?,
        ))
    })?;
    let mut removed: Vec<(Vec<u8>, Vec<u64>)> = Vec::new();
    let mut objects = Vec::new();
    for row in rows {
        let (group, seq, detail) = row?;
        if let Some(Ok(Body::Media { object, .. })) =
            detail.as_deref().map(serde_json::from_str::<Body>)
        {
            objects.push(object);
        }
        match removed.last_mut() {
            Some((last, seqs)) if *last == group => seqs.push(seq),
            _ => removed.push((group, vec![seq])),
        }
    }
    tx.execute("DELETE FROM timeline WHERE expires_at <= ?1", [now])?;
    tx.execute("DELETE FROM messages WHERE expires_at <= ?1", [now])?;
    Ok((removed, objects))
}

/// A card for a commit that changed who is here; none for one that did not.
pub(crate) fn fold_members(
    tx: &Transaction,
    group: &[u8],
    seq: u64,
    by: &Device,
    mut added: Vec<String>,
    removed: Vec<String>,
    devices: Vec<String>,
) -> rusqlite::Result<Option<u64>> {
    // The commit that first fills a new conversation is not news: a 1:1 or a
    // group starts with the people it was made for (#68).
    let first: bool = tx.query_row(
        "SELECT NOT EXISTS (SELECT 1 FROM timeline WHERE group_id = ?1)",
        [group],
        |r| r.get(0),
    )?;
    if first {
        added.clear();
    }
    if added.is_empty() && removed.is_empty() && devices.is_empty() {
        return Ok(None);
    }
    insert(
        tx,
        group,
        seq,
        Row {
            kind: "members",
            sender: by,
            envelope_id: None,
            ts: now() as u64,
            text: None,
            reply_to: None,
            detail: Some(json(&MembersCard {
                added,
                removed,
                devices,
            })),
        },
    )?;
    Ok(Some(seq))
}

/// Looks people up once per call.
struct People<'t, 'c> {
    tx: &'t Transaction<'c>,
    known: HashMap<String, Person>,
}

impl People<'_, '_> {
    fn get(&mut self, account: &str) -> rusqlite::Result<Person> {
        if let Some(found) = self.known.get(account) {
            return Ok(found.clone());
        }
        let found = person(self.tx, account)?;
        self.known.insert(account.to_owned(), found.clone());
        Ok(found)
    }

    fn all(&mut self, accounts: &[String]) -> rusqlite::Result<Vec<Person>> {
        accounts.iter().map(|a| self.get(a)).collect()
    }
}

type Stored = (
    u64,
    String,
    String,
    Option<String>,
    i64,
    Option<String>,
    Option<String>,
    Option<String>,
    bool,
    bool,
    Option<i64>,
    Option<i64>,
);

/// Up to `limit` items before `before` (or the newest), oldest first. The
/// newest page ends with what the outbox still holds.
pub(crate) fn items(
    tx: &Transaction,
    group: &[u8],
    me: &str,
    before: Option<u64>,
    limit: u32,
) -> Result<Vec<Item>, ClientError> {
    let mut items = stored(tx, group, me, before, limit, false)?;
    let mut people = People {
        tx,
        known: HashMap::new(),
    };
    if before.is_none() {
        items.extend(pending(tx, group, me, &mut people)?);
    }
    overlay(tx, group, me, &mut people, &mut items)?;
    Ok(items)
}

/// What this device has queued and the server has not yet sent back, laid
/// over the items read: an own reaction added or taken back, an edit's text,
/// a delete (0099). Each is applied as the fold would, in outbox order, and
/// idempotently, so an echo folded while the row is still queued, or after it
/// is gone, leaves the same item.
fn overlay(
    tx: &Transaction,
    group: &[u8],
    me: &str,
    people: &mut People,
    items: &mut [Item],
) -> Result<(), ClientError> {
    let mut statement = tx.prepare(
        "SELECT intent FROM outbox WHERE group_id = ?1 AND kind = 'message' ORDER BY id",
    )?;
    let rows: Vec<Vec<u8>> = statement
        .query_map([group], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    for intent in rows {
        // A row that does not decode is shown by `pending`.
        let Ok(envelope) = Envelope::decode(&intent) else {
            continue;
        };
        let (target, change) = match envelope.body {
            Body::Reaction {
                target,
                emoji,
                remove,
            } if !emoji.is_empty() => (target, Queued::Reaction { emoji, remove }),
            Body::Edit { target, text } => (target, Queued::Edit(text)),
            Body::Delete { target } => (target, Queued::Delete),
            _ => continue,
        };
        let Some(item) = items
            .iter_mut()
            .find(|i| i.envelope_id.as_deref() == Some(target.as_str()))
        else {
            continue;
        };
        if item.content == Content::Deleted {
            continue;
        }
        match change {
            Queued::Reaction { emoji, remove } => {
                let mine = people.get(me)?;
                let at = item.reactions.iter().position(|r| r.emoji == emoji);
                if remove {
                    if let Some(at) = at {
                        let reaction = &mut item.reactions[at];
                        reaction.people.retain(|p| p.account != me);
                        reaction.own = false;
                        if reaction.people.is_empty() {
                            item.reactions.remove(at);
                        }
                    }
                } else {
                    // One reaction per person (0101): an add replaces the
                    // earlier one, as the fold does.
                    for other in item.reactions.iter_mut().filter(|r| r.emoji != emoji) {
                        other.people.retain(|p| p.account != me);
                        other.own = false;
                    }
                    item.reactions.retain(|r| !r.people.is_empty());
                    let at = item.reactions.iter().position(|r| r.emoji == emoji);
                    let at = at.unwrap_or_else(|| {
                        item.reactions.push(Reaction {
                            emoji,
                            own: false,
                            people: Vec::new(),
                        });
                        item.reactions.len() - 1
                    });
                    let reaction = &mut item.reactions[at];
                    if !reaction.people.iter().any(|p| p.account == me) {
                        reaction.people.push(mine);
                        reaction.people.sort_by(|a, b| a.account.cmp(&b.account));
                    }
                    reaction.own = true;
                }
                // The order `reactions` reads in: most used first, ties by emoji.
                item.reactions.sort_by(|a, b| a.emoji.cmp(&b.emoji));
                item.reactions
                    .sort_by_key(|r| std::cmp::Reverse(r.people.len()));
            }
            Queued::Edit(text) if item.own => match &mut item.content {
                Content::Text { text: shown, .. } => {
                    *shown = text;
                    item.edited = true;
                }
                Content::Media { caption, .. } => {
                    *caption = Some(text);
                    item.edited = true;
                }
                _ => {}
            },
            Queued::Delete if item.own => {
                item.content = Content::Deleted;
                item.reactions.clear();
                item.forwarded = false;
            }
            _ => {}
        }
    }
    Ok(())
}

/// A queued envelope that changes an item already there.
enum Queued {
    Reaction { emoji: String, remove: bool },
    Edit(String),
    Delete,
}

/// The photos and files of a conversation (0055), up to `limit` before
/// `before`, newest first: the timeline's own rows, read the same way, without
/// what was deleted for everyone or what the outbox holds.
pub(crate) fn shared(
    tx: &Transaction,
    group: &[u8],
    me: &str,
    before: Option<u64>,
    limit: u32,
) -> Result<Vec<Item>, ClientError> {
    let mut items = stored(tx, group, me, before, limit, true)?;
    items.reverse();
    Ok(items)
}

/// Up to `limit` stored items before `before`, oldest first; with `media`,
/// only the photos and files still there.
fn stored(
    tx: &Transaction,
    group: &[u8],
    me: &str,
    before: Option<u64>,
    limit: u32,
    media: bool,
) -> Result<Vec<Item>, ClientError> {
    let markers = settings(tx)?.read_markers;
    let mut here = if markers && !media {
        read_here(tx, group, me)?
    } else {
        HashMap::new()
    };
    let mut people = People {
        tx,
        known: HashMap::new(),
    };
    let mut statement = tx.prepare(
        "SELECT seq, kind, sender_account, envelope_id, ts, text, reply_to, detail, edited,
                deleted, expires_at, received_at
         FROM timeline WHERE group_id = ?1 AND seq < ?2
           AND (?4 = 0 OR (kind = 'media' AND deleted = 0))
         ORDER BY seq DESC LIMIT ?3",
    )?;
    let rows: Vec<Stored> = statement
        .query_map(
            params![group, before.map_or(i64::MAX, |b| b as i64), limit, media],
            |r| {
                Ok((
                    r.get::<_, i64>(0)? as u64,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                    r.get(6)?,
                    r.get(7)?,
                    r.get(8)?,
                    r.get(9)?,
                    r.get(10)?,
                    r.get(11)?,
                ))
            },
        )?
        .collect::<rusqlite::Result<_>>()?;
    let mut items = Vec::with_capacity(rows.len());
    for (
        seq,
        kind,
        sender,
        envelope_id,
        ts,
        text,
        reply_to,
        detail,
        edited,
        deleted,
        expires,
        received_at,
    ) in rows.into_iter().rev()
    {
        let own = sender == me;
        let mut unreadable = None;
        let forwarded = match (kind.as_str(), detail.as_deref()) {
            ("text", Some(d)) => match serde_json::from_str::<TextMarks>(d) {
                Ok(marks) => marks.forwarded,
                Err(_) => {
                    unreadable = Some("a stored text row");
                    false
                }
            },
            ("media" | "post" | "location", Some(d)) => matches!(
                serde_json::from_str(d),
                Ok(Body::Media {
                    forwarded: true,
                    ..
                } | Body::Post {
                    forwarded: true,
                    ..
                } | Body::Location {
                    forwarded: true,
                    ..
                })
            ),
            _ => false,
        };
        let content = if deleted {
            Content::Deleted
        } else if let Some(reason) = unreadable {
            Content::unreadable(reason)
        } else {
            match kind.as_str() {
                "media" => match detail.as_deref().map(serde_json::from_str::<Body>) {
                    Some(Ok(Body::Media {
                        mime, size, name, ..
                    })) => Content::Media {
                        mime,
                        size,
                        caption: text,
                        name: name.as_deref().and_then(file_name),
                    },
                    _ => Content::unreadable("a stored media row"),
                },
                "post" => match detail.as_deref().map(serde_json::from_str::<Body>) {
                    Some(Ok(Body::Post { post_id, .. })) => Content::Post { post_id },
                    _ => Content::unreadable("a stored post row"),
                },
                "location" => match detail.as_deref().map(serde_json::from_str::<Body>) {
                    Some(Ok(Body::Location {
                        lat_e6,
                        lon_e6,
                        accuracy,
                        ..
                    })) => Content::Location {
                        lat_e6,
                        lon_e6,
                        accuracy,
                    },
                    _ => Content::unreadable("a stored location row"),
                },
                "members" => match detail
                    .as_deref()
                    .and_then(|d| serde_json::from_str::<MembersCard>(d).ok())
                {
                    Some(card) => Content::Members {
                        added: people.all(&card.added)?,
                        removed: people.all(&card.removed)?,
                        devices: people.all(&card.devices)?,
                    },
                    None => Content::unreadable("a stored card"),
                },
                "timer" => match detail
                    .as_deref()
                    .and_then(|d| serde_json::from_str::<TimerCard>(d).ok())
                {
                    Some(card) => Content::Timer {
                        seconds: card.seconds,
                    },
                    None => Content::unreadable("a stored card"),
                },
                "name" => match detail
                    .as_deref()
                    .and_then(|d| serde_json::from_str::<NameCard>(d).ok())
                {
                    Some(card) => Content::Name { name: card.name },
                    None => Content::unreadable("a stored card"),
                },
                "photo" => match detail
                    .as_deref()
                    .and_then(|d| serde_json::from_str::<PhotoCard>(d).ok())
                {
                    Some(card) => Content::Photo { set: card.set },
                    None => Content::unreadable("a stored card"),
                },
                _ => Content::Text {
                    text: text.unwrap_or_default(),
                    reply_to: reply_to
                        .map(|id| quote(tx, group, &mut people, id))
                        .transpose()?,
                },
            }
        };
        let reactions = if envelope_id.is_some() {
            reactions(tx, group, seq, me, &mut people)?
        } else {
            Vec::new()
        };
        items.push(Item {
            seq: Some(seq),
            read_by: if own && markers && envelope_id.is_some() {
                read_by(tx, group, seq, me)?
            } else {
                0
            },
            read_here: here
                .remove(&seq)
                .unwrap_or_default()
                .iter()
                .map(|account| people.get(account))
                .collect::<rusqlite::Result<_>>()?,
            envelope_id,
            sender: people.get(&sender)?,
            own,
            ts: ts as u64,
            received_at: received_at.map(|r| r as u64),
            status: Status::Sent,
            content,
            edited,
            reactions,
            expires_at: expires.map(|e| e as u64),
            forwarded,
        });
    }
    Ok(items)
}

fn quote(
    tx: &Transaction,
    group: &[u8],
    people: &mut People,
    envelope_id: String,
) -> rusqlite::Result<Quote> {
    let found: Option<(String, String, Option<String>, Option<String>)> = tx
        .query_row(
            "SELECT sender_account, kind, text, detail FROM timeline
             WHERE group_id = ?1 AND envelope_id = ?2 AND deleted = 0
             ORDER BY seq LIMIT 1",
            params![group, envelope_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()?;
    let Some((sender, kind, text, detail)) = found else {
        return Ok(Quote {
            envelope_id,
            sender: None,
            text: None,
            post_id: None,
            location: false,
        });
    };
    let post_id = match (kind.as_str(), detail.as_deref().map(serde_json::from_str)) {
        ("post", Some(Ok(Body::Post { post_id, .. }))) => Some(post_id),
        _ => None,
    };
    Ok(Quote {
        envelope_id,
        sender: Some(people.get(&sender)?),
        text,
        post_id,
        location: kind == "location",
    })
}

fn reactions(
    tx: &Transaction,
    group: &[u8],
    seq: u64,
    me: &str,
    people: &mut People,
) -> rusqlite::Result<Vec<Reaction>> {
    let mut statement = tx.prepare(
        "SELECT emoji, account FROM reactions WHERE group_id = ?1 AND seq = ?2
         ORDER BY emoji, account",
    )?;
    let rows: Vec<(String, String)> = statement
        .query_map(params![group, seq as i64], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;
    let mut grouped: Vec<Reaction> = Vec::new();
    for (emoji, account) in rows {
        if grouped.last().is_none_or(|r| r.emoji != emoji) {
            grouped.push(Reaction {
                emoji,
                own: false,
                people: Vec::new(),
            });
        }
        let reaction = grouped.last_mut().expect("pushed above");
        reaction.own |= account == me;
        reaction.people.push(people.get(&account)?);
    }
    // The most used first; ties keep the emoji order.
    grouped.sort_by_key(|r| std::cmp::Reverse(r.people.len()));
    Ok(grouped)
}

/// What this device has queued here and the server has not yet sent back.
fn pending(
    tx: &Transaction,
    group: &[u8],
    me: &str,
    people: &mut People,
) -> Result<Vec<Item>, ClientError> {
    let mut statement = tx.prepare(
        "SELECT intent, seq, failed FROM outbox
         WHERE group_id = ?1 AND kind = 'message' ORDER BY id",
    )?;
    let rows: Vec<(Vec<u8>, Option<i64>, bool)> = statement
        .query_map([group], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
        .collect::<rusqlite::Result<_>>()?;
    let sender = people.get(me)?;
    let mut items = Vec::new();
    for (intent, seq, failed) in rows {
        let envelope = match Envelope::decode(&intent) {
            Ok(envelope) => envelope,
            Err(error) => {
                // Its id and time are inside what failed to decode; the
                // row's place in the outbox is all it keeps.
                items.push(Item {
                    seq: seq.map(|s| s as u64),
                    envelope_id: None,
                    sender: sender.clone(),
                    own: true,
                    ts: 0,
                    received_at: None,
                    status: if failed {
                        Status::Failed
                    } else {
                        Status::Pending
                    },
                    content: Content::Unreadable { code: error.code() },
                    edited: false,
                    reactions: Vec::new(),
                    read_by: 0,
                    read_here: Vec::new(),
                    expires_at: None,
                    forwarded: false,
                });
                continue;
            }
        };
        let forwarded = matches!(
            envelope.body,
            Body::Text {
                forwarded: true,
                ..
            } | Body::Media {
                forwarded: true,
                ..
            } | Body::Post {
                forwarded: true,
                ..
            } | Body::Location {
                forwarded: true,
                ..
            }
        );
        let content = match envelope.body {
            Body::Text { text, .. } => Content::Text {
                text,
                reply_to: None,
            },
            Body::Reply { to, text } => Content::Text {
                text,
                reply_to: Some(quote(tx, group, people, to)?),
            },
            Body::Media {
                mime,
                size,
                caption,
                name,
                ..
            } => Content::Media {
                mime,
                size,
                caption,
                name: name.as_deref().and_then(file_name),
            },
            Body::Post { post_id, .. } => Content::Post { post_id },
            Body::Location {
                lat_e6,
                lon_e6,
                accuracy,
                ..
            } => Content::Location {
                lat_e6,
                lon_e6,
                accuracy,
            },
            // Edits, deletes, reactions and receipts show once they are back.
            _ => continue,
        };
        items.push(Item {
            seq: seq.map(|s| s as u64),
            envelope_id: Some(envelope.id),
            sender: sender.clone(),
            own: true,
            ts: envelope.ts,
            received_at: None,
            status: if failed {
                Status::Failed
            } else {
                Status::Pending
            },
            content,
            edited: false,
            reactions: Vec::new(),
            read_by: 0,
            read_here: Vec::new(),
            expires_at: None,
            forwarded,
        });
    }
    Ok(items)
}

/// kind, text, detail, deleted, expires_at of the row a forward reads.
type ForwardRow = (String, Option<String>, Option<String>, bool, Option<i64>);

/// The content of the message at `seq` a forward copies: its text as it
/// reads now (the last edit, a reply without its quote), or its file.
/// Refused under a timer, deleted, or for anything but a message (0041);
/// a shared post is not one to forward (0044).
pub(crate) fn forwardable(
    tx: &Transaction,
    group: &[u8],
    seq: u64,
) -> Result<Forwardable, ClientError> {
    let row: Option<ForwardRow> = tx
        .query_row(
            "SELECT kind, text, detail, deleted, expires_at FROM timeline
             WHERE group_id = ?1 AND seq = ?2",
            params![group, seq as i64],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .optional()?;
    let Some((kind, text, detail, deleted, expires_at)) = row else {
        return Err(ClientError::CannotForward(Unforwardable::NotAMessage));
    };
    if expires_at.is_some() {
        return Err(ClientError::CannotForward(Unforwardable::Disappearing));
    }
    if deleted {
        return Err(ClientError::CannotForward(Unforwardable::Deleted));
    }
    match kind.as_str() {
        "text" => Ok(Forwardable::Text(text.unwrap_or_default())),
        "media" => match detail.as_deref().map(serde_json::from_str::<Body>) {
            Some(Ok(Body::Media { mime, name, .. })) => Ok(Forwardable::Media {
                mime,
                caption: text,
                // The name as this device shows it, never a path.
                name: name.as_deref().and_then(file_name),
            }),
            _ => Err(ClientError::Protocol("a stored media row")),
        },
        "location" => match detail.as_deref().map(serde_json::from_str::<Body>) {
            Some(Ok(Body::Location {
                lat_e6,
                lon_e6,
                accuracy,
                ..
            })) => Ok(Forwardable::Location {
                lat_e6,
                lon_e6,
                accuracy,
            }),
            _ => Err(ClientError::Protocol("a stored location row")),
        },
        _ => Err(ClientError::CannotForward(Unforwardable::NotAMessage)),
    }
}

/// The envelope id to put in a receipt for everything up to `seq`.
pub(crate) fn receipt_target(
    tx: &Transaction,
    group: &[u8],
    seq: u64,
) -> rusqlite::Result<Option<String>> {
    tx.query_row(
        "SELECT envelope_id FROM timeline
         WHERE group_id = ?1 AND seq <= ?2 AND envelope_id IS NOT NULL
         ORDER BY seq DESC LIMIT 1",
        params![group, seq as i64],
        |r| r.get(0),
    )
    .optional()
}

#[cfg(test)]
mod tests;
