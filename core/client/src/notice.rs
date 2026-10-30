//! Push (0025). The push names nothing: the device that wakes syncs, and
//! `notices()` says what to show and what to clear, so the Android service
//! and the iOS extension show the same. The store keeps how far each
//! conversation was looked at, so the app and the extension, which share
//! it, never show an item twice.

use spjall_store::rusqlite::{self, OptionalExtension, Transaction, params};

use crate::api::{
    Author, Notification, NotificationAction, NotificationKind, NotificationPage, Transport,
    conversation_id,
};
use crate::members::{Person, person};
use crate::mute::{Mute, mute_of};
use crate::read::mark;
use crate::{Client, ClientError, authed, members, now, this_device};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NoticeKind {
    Text,
    Photo,
    File,
    /// A post shared under 0040. Its notice is a fixed sentence: it
    /// carries no text and never names the post (0080).
    Post,
    /// A location (0059). Its notice is a fixed sentence: a notice is shown
    /// on a locked screen, so it never carries the place.
    Location,
}

/// A new message to show: from another account, not blocked, not expired,
/// not in a muted conversation, and not read up to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Notice {
    pub conversation: String,
    /// Everyone there but this account, named ones first: the title, as
    /// the conversation list draws it.
    pub members: Vec<Person>,
    pub seq: u64,
    pub sender: Person,
    pub kind: NoticeKind,
    /// The text, or a file's caption; none for a shared post or a location.
    pub text: Option<String>,
    /// When the server stored it (0048), or the sender's clock for a row
    /// stored before the server gave it; in milliseconds.
    pub ts: u64,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Notices {
    /// Oldest first.
    pub shown: Vec<Notice>,
    /// Conversations whose shown notices are now read, here or on another
    /// device of this account. Cleared before the new ones are shown.
    pub cleared: Vec<String>,
    /// Social notifications to show (0107), oldest first.
    pub social: Vec<SocialNotice>,
    /// Ids of social notifications whose notice is now read, deleted or
    /// gone: take them away before showing the new ones.
    pub social_cleared: Vec<String>,
}

/// A social notification to announce (0107): a row that is unread, has
/// `announce`, and is newer than the last announcement of the same id. The
/// apps write the sentence with the formatter of the list row. It carries no
/// snippet: a notice is shown on a locked screen.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SocialNotice {
    pub notification_id: String,
    pub kind: NotificationKind,
    /// The newest three accounts behind it, newest first.
    pub actors: Vec<Author>,
    pub actor_count: u64,
    /// None for a row about the account itself (0114).
    pub community_id: Option<String>,
    pub post_id: Option<String>,
    pub comment_id: Option<String>,
    /// For `Moderated`, the moderator's action.
    pub action: Option<NotificationAction>,
    /// For `Reaction`, the emoji.
    pub emoji: Option<String>,
    /// Unix milliseconds.
    pub created_at: u64,
}

/// How many notifications `notices()` reads: one short page.
const SOCIAL_PAGE: u32 = 20;

/// Compares the first page with what was announced before. On the first
/// run it records the unread rows and announces none. Afterwards it
/// announces each unread `announce` row not recorded or recorded older, and
/// clears each recorded id whose row is now read or gone. A recorded row
/// older than everything on a page that has a next page is not gone: it only
/// fell off the page, and keeps its notice.
fn fold_social(
    tx: &Transaction,
    page: NotificationPage,
) -> rusqlite::Result<(Vec<SocialNotice>, Vec<String>)> {
    let seeded = tx
        .query_row("SELECT 1 FROM social_notice_seed", [], |_| Ok(()))
        .optional()?
        .is_some();
    let oldest = page.notifications.iter().map(|n| n.created_at).min();
    let record = |n: &Notification| {
        tx.execute(
            "INSERT INTO social_notices (id, created_at) VALUES (?1, ?2)
             ON CONFLICT (id) DO UPDATE SET created_at = excluded.created_at",
            params![n.notification_id, n.created_at as i64],
        )
        .map(drop)
    };
    if !seeded {
        for n in page.notifications.iter().filter(|n| !n.read) {
            record(n)?;
        }
        tx.execute("INSERT INTO social_notice_seed (id) VALUES (1)", [])?;
        return Ok((Vec::new(), Vec::new()));
    }
    let stored: Vec<(String, i64)> = {
        let mut statement =
            tx.prepare("SELECT id, created_at FROM social_notices ORDER BY created_at, id")?;
        let rows = statement.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
        rows.collect::<rusqlite::Result<_>>()?
    };
    let mut cleared = Vec::new();
    for (id, created) in &stored {
        let row = page.notifications.iter().find(|n| &n.notification_id == id);
        let off_page =
            row.is_none() && page.next.is_some() && oldest.is_some_and(|o| (*created as u64) < o);
        if !off_page && row.is_none_or(|n| n.read) {
            tx.execute("DELETE FROM social_notices WHERE id = ?1", params![id])?;
            cleared.push(id.clone());
        }
    }
    let mut shown = Vec::new();
    for n in page.notifications.iter().rev() {
        let last = stored
            .iter()
            .find(|(id, _)| id == &n.notification_id)
            .map(|(_, at)| *at);
        if n.read || !n.announce || last.is_some_and(|at| n.created_at as i64 <= at) {
            continue;
        }
        record(n)?;
        shown.push(SocialNotice {
            notification_id: n.notification_id.clone(),
            kind: n.kind,
            actors: n.actors.clone(),
            actor_count: n.actor_count,
            community_id: n.community_id.clone(),
            post_id: n.post_id.clone(),
            comment_id: n.comment_id.clone(),
            action: n.action,
            emoji: n.emoji.clone(),
            created_at: n.created_at,
        });
    }
    shown.sort_by_key(|n| n.created_at);
    Ok((shown, cleared))
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
    match kind {
        "text" => return NoticeKind::Text,
        "post" => return NoticeKind::Post,
        "location" => return NoticeKind::Location,
        _ => {}
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
                "SELECT seq, kind, sender_account, text, detail, COALESCE(received_at, ts) FROM timeline
                 WHERE group_id = ?1 AND seq > MAX(?2, ?3) AND sender_account != ?4
                       AND kind IN ('text', 'media', 'post', 'location') AND deleted = 0
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
        // A muted conversation shows nothing, and what it held now is
        // looked at: it is not shown when the mute ends (0042).
        let muted = mute_of(tx, &group)? != Mute::Off;
        if let Some((last, ..)) = new.last().filter(|_| !muted) {
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
    /// the token changes; an unchanged token is not sent again. Returns
    /// whether the server still lacks it, so that only then a `sync` is due.
    pub fn set_push_token(&mut self, token: &str, sandbox: bool) -> Result<bool, ClientError> {
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
            )?;
            let sent: bool =
                tx.query_row("SELECT sent FROM push WHERE id = 1", [], |r| r.get(0))?;
            Ok::<_, ClientError>(!sent)
        })
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
        authed(&self.transport, &self.token, &self.client)?
            .set_push_token(&device, &token, sandbox)?;
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
        let mut notices = self.store.try_write(take_notices)?;
        // The social part (0107) reads the server. Whatever goes wrong there
        // leaves it empty: the chat notices above are already recorded as
        // taken, and must not be lost with an error.
        if let Some((social, cleared)) = self.social_notices() {
            notices.social = social;
            notices.social_cleared = cleared;
        }
        Ok(notices)
    }

    /// What `fold_social` finds on the first page, or none when this device
    /// is not registered, the server cannot be reached or answers an error.
    fn social_notices(&mut self) -> Option<(Vec<SocialNotice>, Vec<String>)> {
        let page = authed(&self.transport, &self.token, &self.client)
            .ok()?
            .notifications(None, SOCIAL_PAGE)
            .ok()?;
        self.store
            .try_write(|tx| fold_social(tx, page).map_err(ClientError::from))
            .ok()
    }
}
