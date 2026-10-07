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
use spjall_envelope::{Body, Envelope};
use spjall_mls::group::Device;
use spjall_store::rusqlite::{self, OptionalExtension, Transaction, params};

use crate::members::{Person, person};
use crate::read::{advance, read_by, settings};
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
    pub status: Status,
    pub content: Content,
    pub edited: bool,
    pub reactions: Vec<Reaction>,
    /// How many accounts besides the sender have read it; counted for this
    /// account's own messages, and only with read markers on.
    pub read_by: u32,
    /// When it disappears, in milliseconds.
    pub expires_at: Option<u64>,
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

fn json(value: &impl Serialize) -> String {
    serde_json::to_string(value).expect("cards serialize")
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

struct Row<'a> {
    kind: &'a str,
    sender: &'a Device,
    envelope_id: Option<&'a str>,
    ts: u64,
    text: Option<&'a str>,
    reply_to: Option<&'a str>,
    detail: Option<String>,
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
        Body::Text { text } => {
            insert(tx, group, seq, message("text", Some(text), None, None))?;
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
        Body::Edit { target, text } => {
            let Some(t) = own_target(tx, group, &sender.account, target)? else {
                return Ok(None);
            };
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
            let sql = if *remove {
                "DELETE FROM reactions
                 WHERE group_id = ?1 AND seq = ?2 AND account = ?3 AND emoji = ?4"
            } else {
                "INSERT OR IGNORE INTO reactions (group_id, seq, account, emoji)
                 VALUES (?1, ?2, ?3, ?4)"
            };
            if tx.execute(sql, params![group, t as i64, sender.account, emoji])? == 0 {
                return Ok(None);
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
            // This account's messages the reader has now read.
            let mut statement = tx.prepare(
                "SELECT seq FROM timeline
                 WHERE group_id = ?1 AND sender_account = ?2 AND seq > ?3 AND seq <= ?4
                       AND envelope_id IS NOT NULL
                 ORDER BY seq",
            )?;
            let rows = statement.query_map(params![group, me, old as i64, t as i64], |r| {
                r.get::<_, i64>(0).map(|s| s as u64)
            })?;
            rows.collect::<rusqlite::Result<_>>()?
        }
        Body::Typing { .. } | Body::Unknown { .. } => return Ok(None),
    };
    // What this account sends, it has read up to.
    if sender.account == me
        && matches!(
            envelope.body,
            Body::Text { .. } | Body::Reply { .. } | Body::Media { .. }
        )
    {
        advance(tx, group, me, seq)?;
    }
    Ok(Some(changed))
}

/// A card for a commit that changed who is here; none for one that did not.
pub(crate) fn fold_members(
    tx: &Transaction,
    group: &[u8],
    seq: u64,
    by: &Device,
    added: Vec<String>,
    removed: Vec<String>,
    devices: Vec<String>,
) -> rusqlite::Result<Option<u64>> {
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
    let markers = settings(tx)?.read_markers;
    let mut people = People {
        tx,
        known: HashMap::new(),
    };
    let mut statement = tx.prepare(
        "SELECT seq, kind, sender_account, envelope_id, ts, text, reply_to, detail, edited,
                deleted, expires_at
         FROM timeline WHERE group_id = ?1 AND seq < ?2 ORDER BY seq DESC LIMIT ?3",
    )?;
    let rows: Vec<Stored> = statement
        .query_map(
            params![group, before.map_or(i64::MAX, |b| b as i64), limit],
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
                ))
            },
        )?
        .collect::<rusqlite::Result<_>>()?;
    let mut items = Vec::with_capacity(rows.len());
    for (seq, kind, sender, envelope_id, ts, text, reply_to, detail, edited, deleted, expires) in
        rows.into_iter().rev()
    {
        let own = sender == me;
        let content = if deleted {
            Content::Deleted
        } else {
            match kind.as_str() {
                "media" => match detail.as_deref().map(serde_json::from_str::<Body>) {
                    Some(Ok(Body::Media { mime, size, .. })) => Content::Media {
                        mime,
                        size,
                        caption: text,
                    },
                    _ => return Err(ClientError::Protocol("a stored media row")),
                },
                "members" => {
                    let card: MembersCard = detail
                        .as_deref()
                        .and_then(|d| serde_json::from_str(d).ok())
                        .ok_or(ClientError::Protocol("a stored card"))?;
                    Content::Members {
                        added: people.all(&card.added)?,
                        removed: people.all(&card.removed)?,
                        devices: people.all(&card.devices)?,
                    }
                }
                "timer" => {
                    let card: TimerCard = detail
                        .as_deref()
                        .and_then(|d| serde_json::from_str(d).ok())
                        .ok_or(ClientError::Protocol("a stored card"))?;
                    Content::Timer {
                        seconds: card.seconds,
                    }
                }
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
            envelope_id,
            sender: people.get(&sender)?,
            own,
            ts: ts as u64,
            status: Status::Sent,
            content,
            edited,
            reactions,
            expires_at: expires.map(|e| e as u64),
        });
    }
    if before.is_none() {
        items.extend(pending(tx, group, me, &mut people)?);
    }
    Ok(items)
}

fn quote(
    tx: &Transaction,
    group: &[u8],
    people: &mut People,
    envelope_id: String,
) -> rusqlite::Result<Quote> {
    let found: Option<(String, Option<String>)> = tx
        .query_row(
            "SELECT sender_account, text FROM timeline
             WHERE group_id = ?1 AND envelope_id = ?2 AND deleted = 0
             ORDER BY seq LIMIT 1",
            params![group, envelope_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    let (sender, text) = match found {
        Some((sender, text)) => (Some(people.get(&sender)?), text),
        None => (None, None),
    };
    Ok(Quote {
        envelope_id,
        sender,
        text,
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
        let envelope = Envelope::decode(&intent)?;
        let content = match envelope.body {
            Body::Text { text } => Content::Text {
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
                ..
            } => Content::Media {
                mime,
                size,
                caption,
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
            status: if failed {
                Status::Failed
            } else {
                Status::Pending
            },
            content,
            edited: false,
            reactions: Vec::new(),
            read_by: 0,
            expires_at: None,
        });
    }
    Ok(items)
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
mod tests {
    use spjall_store::Store;

    use super::*;

    const GROUP: &[u8] = b"group";

    struct Fold {
        store: Store,
        seq: u64,
        _dir: tempfile::TempDir,
    }

    impl Fold {
        fn new() -> Self {
            let dir = tempfile::tempdir().unwrap();
            let mut store = Store::open(dir.path(), &[3; 32]).unwrap();
            store
                .write(|tx| {
                    tx.execute(
                        "INSERT INTO conversations (group_id, cursor, created_at) VALUES (?1, 0, 0)",
                        [GROUP],
                    )
                })
                .unwrap();
            Self {
                store,
                seq: 0,
                _dir: dir,
            }
        }

        /// Folds `body` from `account`'s device `device` as "a" sees it;
        /// the envelope id is `id`.
        fn apply(&mut self, from: (&str, &str), id: &str, body: Body) -> Option<Vec<u64>> {
            self.seq += 1;
            let seq = self.seq;
            let sender = Device::new(from.0, from.1).unwrap();
            let envelope = Envelope {
                id: id.into(),
                ts: seq,
                body,
            };
            self.store
                .try_write(|tx| fold(tx, GROUP, seq, &sender, &envelope, "a"))
                .unwrap()
        }

        fn items(&mut self) -> Vec<Item> {
            self.store
                .try_write(|tx| items(tx, GROUP, "a", None, 100))
                .unwrap()
        }
    }

    fn text(text: &str) -> Body {
        Body::Text { text: text.into() }
    }

    fn react(target: &str, remove: bool) -> Body {
        Body::Reaction {
            target: target.into(),
            emoji: "❤️".into(),
            remove,
        }
    }

    #[test]
    fn an_edit_of_an_edit_shows_the_last_text() {
        let mut fold = Fold::new();
        fold.apply(("b", "b1"), "m", text("eitt"));
        let edit = |text: &str| Body::Edit {
            target: "m".into(),
            text: text.into(),
        };
        assert_eq!(fold.apply(("b", "b1"), "e1", edit("tvö")), Some(vec![1]));
        // From the sender's other device, too.
        assert_eq!(fold.apply(("b", "b2"), "e2", edit("þrjú")), Some(vec![1]));
        // Never from another account.
        assert_eq!(fold.apply(("c", "c1"), "e3", edit("fjögur")), None);
        let items = fold.items();
        assert_eq!(items.len(), 1);
        assert_eq!(
            items[0].content,
            Content::Text {
                text: "þrjú".into(),
                reply_to: None
            }
        );
        assert!(items[0].edited);
    }

    #[test]
    fn a_deleted_message_takes_no_reaction_and_no_edit() {
        let mut fold = Fold::new();
        fold.apply(("b", "b1"), "m", text("eitt"));
        fold.apply(("a", "a1"), "r", react("m", false));
        let delete = Body::Delete { target: "m".into() };
        assert_eq!(fold.apply(("c", "c1"), "d0", delete.clone()), None);
        assert_eq!(fold.apply(("b", "b1"), "d1", delete.clone()), Some(vec![1]));
        assert_eq!(fold.apply(("b", "b1"), "d2", delete), None);
        assert_eq!(fold.apply(("c", "c1"), "r2", react("m", false)), None);
        let edit = Body::Edit {
            target: "m".into(),
            text: "aftur".into(),
        };
        assert_eq!(fold.apply(("b", "b1"), "e", edit), None);
        let items = fold.items();
        assert_eq!(items[0].content, Content::Deleted);
        assert!(items[0].reactions.is_empty());
    }

    #[test]
    fn a_reaction_is_one_per_account_and_can_be_taken_back() {
        let mut fold = Fold::new();
        fold.apply(("b", "b1"), "m", text("eitt"));
        assert_eq!(
            fold.apply(("a", "a1"), "r1", react("m", false)),
            Some(vec![1])
        );
        // The same from another device of the account changes nothing.
        assert_eq!(fold.apply(("a", "a2"), "r2", react("m", false)), None);
        assert_eq!(
            fold.apply(("c", "c1"), "r3", react("m", false)),
            Some(vec![1])
        );
        let reactions = &fold.items()[0].reactions;
        assert_eq!(reactions.len(), 1);
        assert!(reactions[0].own);
        assert_eq!(reactions[0].people.len(), 2);

        assert_eq!(
            fold.apply(("a", "a2"), "r4", react("m", true)),
            Some(vec![1])
        );
        assert_eq!(fold.apply(("a", "a1"), "r5", react("m", true)), None);
        let reactions = &fold.items()[0].reactions;
        assert!(!reactions[0].own);
        assert_eq!(reactions[0].people[0].account, "c");
        // A reaction to nothing here is dropped.
        assert_eq!(fold.apply(("c", "c1"), "r6", react("x", false)), None);
    }

    #[test]
    fn a_receipt_counts_once_for_all_devices_of_an_account() {
        let mut fold = Fold::new();
        fold.apply(("a", "a1"), "m1", text("eitt"));
        fold.apply(("a", "a2"), "m2", text("tvö"));
        let receipt = |up_to: &str| Body::Receipt {
            up_to: up_to.into(),
        };
        assert_eq!(fold.apply(("b", "b1"), "x1", receipt("m1")), Some(vec![1]));
        assert_eq!(fold.apply(("b", "b2"), "x2", receipt("m1")), None);
        assert_eq!(fold.apply(("b", "b2"), "x3", receipt("m2")), Some(vec![2]));
        // A mark never moves back.
        assert_eq!(fold.apply(("b", "b1"), "x4", receipt("m1")), None);
        let read: Vec<u32> = fold.items().iter().map(|i| i.read_by).collect();
        assert_eq!(read, vec![1, 1]);
        // This account's own receipt moves its own mark, and changes no item.
        fold.apply(("b", "b1"), "m3", text("þrjú"));
        assert_eq!(
            fold.apply(("a", "a2"), "x5", receipt("m3")),
            Some(Vec::new())
        );
        let unread = fold
            .store
            .try_write(|tx| crate::read::unread(tx, GROUP, "a"))
            .unwrap();
        assert_eq!(unread, 0);
    }

    #[test]
    fn typing_and_unknown_kinds_leave_no_item() {
        let mut fold = Fold::new();
        let unknown = Body::Unknown {
            kind: "poll".into(),
        };
        assert_eq!(fold.apply(("b", "b1"), "u", unknown), None);
        assert_eq!(
            fold.apply(("b", "b1"), "t", Body::Typing { active: true }),
            None
        );
        assert!(fold.items().is_empty());
    }
}
