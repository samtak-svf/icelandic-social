//! Push (0025). The push names nothing: the device that wakes syncs, and
//! `notices()` says what to show and what to clear, so the Android service
//! and the iOS extension show the same. The store keeps how far each
//! conversation was looked at, so the app and the extension, which share
//! it, never show an item twice.

use spjall_store::rusqlite::{self, OptionalExtension, Transaction, params};

use crate::api::{Transport, conversation_id};
use crate::members::{Person, person};
use crate::read::mark;
use crate::{Client, ClientError, authed, members, now, this_device};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NoticeKind {
    Text,
    Photo,
    File,
}

/// A new message to show: from another account, not blocked, not expired,
/// and not read up to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Notice {
    pub conversation: String,
    /// Everyone there but this account, named ones first: the title, as
    /// the conversation list draws it.
    pub members: Vec<Person>,
    pub seq: u64,
    pub sender: Person,
    pub kind: NoticeKind,
    /// The text, or a file's caption.
    pub text: Option<String>,
    /// The sender's clock, in milliseconds.
    pub ts: u64,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Notices {
    /// Oldest first.
    pub shown: Vec<Notice>,
    /// Conversations whose shown notices are now read, here or on another
    /// device of this account. Cleared before the new ones are shown.
    pub cleared: Vec<String>,
}

/// Everyone in the group but `me`, named ones first.
pub(crate) fn others(tx: &Transaction, group: &[u8], me: &str) -> rusqlite::Result<Vec<Person>> {
    let accounts: Vec<String> = members::members(tx, group)?
        .into_iter()
        .filter(|a| a != me)
        .collect();
    let mut people = members::people_of(tx, &accounts)?;
    people.sort_by(|a, b| {
        (a.name.is_none(), &a.name, &a.account).cmp(&(b.name.is_none(), &b.name, &b.account))
    });
    Ok(people)
}

fn kind(kind: &str, detail: Option<&str>) -> NoticeKind {
    if kind == "text" {
        return NoticeKind::Text;
    }
    let mime = detail
        .and_then(|d| serde_json::from_str::<serde_json::Value>(d).ok())
        .and_then(|d| d.get("mime")?.as_str().map(str::to_owned))
        .unwrap_or_default();
    if mime.starts_with("image/") {
        NoticeKind::Photo
    } else {
        NoticeKind::File
    }
}

fn take_notices(tx: &Transaction) -> Result<Notices, ClientError> {
    let mut notices = Notices::default();
    let rows: Vec<(Vec<u8>, i64, Option<i64>)> = {
        let mut statement =
            tx.prepare("SELECT group_id, noticed, shown FROM conversations ORDER BY created_at")?;
        let rows = statement.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
        rows.collect::<rusqlite::Result<_>>()?
    };
    if rows.is_empty() {
        return Ok(notices);
    }
    let (_, me) = this_device(tx)?;
    let at = now();
    for (group, noticed, mut shown) in rows {
        let read = mark(tx, &group, &me.account)? as i64;
        let id = conversation_id(&group);
        if shown.is_some_and(|s| read >= s) {
            notices.cleared.push(id.clone());
            shown = None;
        }
        type Row = (i64, String, String, Option<String>, Option<String>, i64);
        let new: Vec<Row> = {
            let mut statement = tx.prepare(
                "SELECT seq, kind, sender_account, text, detail, ts FROM timeline
                 WHERE group_id = ?1 AND seq > MAX(?2, ?3) AND sender_account != ?4
                       AND kind IN ('text', 'media') AND deleted = 0
                       AND (expires_at IS NULL OR expires_at > ?5)
                       AND sender_account NOT IN (SELECT account FROM blocks)
                 ORDER BY seq",
            )?;
            let rows = statement.query_map(params![group, noticed, read, me.account, at], |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                ))
            })?;
            rows.collect::<rusqlite::Result<_>>()?
        };
        if let Some((last, ..)) = new.last() {
            shown = Some(*last);
            let members = others(tx, &group, &me.account)?;
            for (seq, k, sender, text, detail, ts) in new {
                notices.shown.push(Notice {
                    conversation: id.clone(),
                    members: members.clone(),
                    seq: seq as u64,
                    sender: person(tx, &sender)?,
                    kind: kind(&k, detail.as_deref()),
                    text,
                    ts: ts as u64,
                });
            }
        }
        tx.execute(
            "UPDATE conversations
             SET noticed = MAX(noticed, COALESCE((SELECT MAX(seq) FROM timeline
                                                  WHERE group_id = ?1), 0)),
                 shown = ?2
             WHERE group_id = ?1",
            params![group, shown],
        )?;
    }
    Ok(notices)
}

impl<T: Transport> Client<T> {
    /// Keeps this device's push token and sends it on the next `sync`,
    /// until the server has it. The apps call it on every launch and when
    /// the token changes; an unchanged token is not sent again.
    pub fn set_push_token(&mut self, token: &str, sandbox: bool) -> Result<(), ClientError> {
        if token.is_empty() || token.len() > 4096 {
            return Err(ClientError::Invalid("push token"));
        }
        self.store.try_write(|tx| {
            tx.execute(
                "INSERT INTO push (id, token, sandbox, sent) VALUES (1, ?1, ?2, 0)
                 ON CONFLICT (id) DO UPDATE SET
                     token = excluded.token, sandbox = excluded.sandbox, sent = 0
                 WHERE token != excluded.token OR sandbox != excluded.sandbox",
                params![token, sandbox],
            )
            .map(drop)
        })?;
        Ok(())
    }

    /// Sends a token the server does not have yet.
    pub(crate) fn send_push_token(&mut self) -> Result<(), ClientError> {
        let unsent: Option<(String, String, bool)> = self.store.try_write(|tx| {
            let token: Option<(String, bool)> = tx
                .query_row(
                    "SELECT token, sandbox FROM push WHERE id = 1 AND sent = 0",
                    [],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()?;
            let Some((token, sandbox)) = token else {
                return Ok::<_, ClientError>(None);
            };
            Ok(Some((this_device(tx)?.1.device, token, sandbox)))
        })?;
        let Some((device, token, sandbox)) = unsent else {
            return Ok(());
        };
        authed(&self.transport, &self.token)?.set_push_token(&device, &token, sandbox)?;
        self.store.try_write(|tx| {
            tx.execute(
                "UPDATE push SET sent = 1 WHERE id = 1 AND token = ?1 AND sandbox = ?2",
                params![token, sandbox],
            )
            .map(drop)
        })?;
        Ok(())
    }

    /// What to show after a push woke this device and `sync` ran, and
    /// which notifications to take away. Each new item is shown once,
    /// whichever process asks: the app in the foreground calls it too,
    /// and shows nothing, so what it had on screen is never shown later.
    pub fn notices(&mut self) -> Result<Notices, ClientError> {
        self.purge()?;
        self.store.try_write(take_notices)
    }
}
