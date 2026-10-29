//! What the screens read, on the store's `Reader` (decision 0056): who this
//! device is signed in as and its token, the list, a timeline, the list's
//! search on this device, the people and the settings. None of it waits for a sync or a send holding the `Client`
//! through a network call, and none of it writes, so a row whose timer is up
//! is left out by the `Reader` rather than purged first.

use std::path::{Path, PathBuf};

use spjall_envelope::Envelope;
use spjall_store::Reader;
use spjall_store::rusqlite::{self, OptionalExtension, Transaction, params};

use crate::api::{conversation_id, group_id};
use crate::directory::{fold_name, query, starts_a_word};
use crate::group_photo;
use crate::{
    ClientError, Conversation, Device, Item, Message, Person, STATE, Settings, SignedIn, State,
    account, conversation_state, members, mute, notice, read, this_device, timeline,
};

/// The reads, on a connection of their own. The app holds one beside its
/// `Client` and behind a lock of its own.
pub struct View {
    reader: Reader,
    /// The store's folder for decrypted files, where a group's photo is kept.
    media: PathBuf,
}

impl View {
    pub(crate) fn new(reader: Reader, media: PathBuf) -> Self {
        Self { reader, media }
    }

    /// The account and device this store is signed in as, if it is: what
    /// an app asks first at every start, so it never waits for a sync.
    pub fn signed_in(&mut self) -> Result<Option<SignedIn>, ClientError> {
        self.reader.read(account::signed_in)
    }

    /// The device token as stored, which the `Client` writes in the same
    /// transaction as it changes its own (sign-in, signing out).
    pub fn device_token(&mut self) -> Result<Option<String>, ClientError> {
        self.reader.read(|tx| {
            Ok(tx
                .query_row("SELECT device_token FROM account", [], |r| r.get(0))
                .optional()?
                .flatten())
        })
    }

    /// Every conversation, the one with the newest activity first.
    pub fn conversations(&mut self) -> Result<Vec<Conversation>, ClientError> {
        self.reader.read(|tx| conversations(tx, &self.media))
    }

    /// Up to `limit` items before the item `before` (or the newest), oldest
    /// first; the newest page ends with what is still being sent (0022).
    pub fn timeline(
        &mut self,
        conversation: &str,
        before: Option<u64>,
        limit: u32,
    ) -> Result<Vec<Item>, ClientError> {
        let group = group_id(conversation).ok_or(ClientError::UnknownConversation)?;
        self.reader.read(|tx| {
            conversation_state(tx, &group)?;
            let (_, me) = this_device(tx)?;
            timeline::items(tx, &group, &me.account, before, limit)
        })
    }

    /// The photos and files of a conversation (0055), up to `limit` before
    /// the item `before` (or the newest), newest first. Read from this
    /// device's store alone; what a timer ended is already left out.
    pub fn shared(
        &mut self,
        conversation: &str,
        before: Option<u64>,
        limit: u32,
    ) -> Result<Vec<Item>, ClientError> {
        let group = group_id(conversation).ok_or(ClientError::UnknownConversation)?;
        self.reader.read(|tx| {
            conversation_state(tx, &group)?;
            let (_, me) = this_device(tx)?;
            timeline::shared(tx, &group, &me.account, before, limit)
        })
    }

    /// The conversations whose title, the group's name or the names of the
    /// others in it, has a word starting with `search` (0038, 0078), in the order
    /// of `conversations`. Read from this device alone, never the server; a
    /// blank search keeps every conversation.
    pub fn search_conversations(&mut self, search: &str) -> Result<Vec<Conversation>, ClientError> {
        let search = query(Some(search))?.map(fold_name);
        let all = self.conversations()?;
        let Some(search) = search else {
            return Ok(all);
        };
        Ok(all
            .into_iter()
            .filter(|c| {
                c.name
                    .iter()
                    .chain(c.members.iter().filter_map(|p| p.name.as_ref()))
                    .any(|name| starts_a_word(&fold_name(name), &search))
            })
            .collect())
    }

    /// The accounts met through shared conversations: whom a new
    /// conversation can be started with.
    pub fn people(&mut self) -> Result<Vec<Person>, ClientError> {
        self.reader.read(|tx| {
            let (_, me) = this_device(tx)?;
            Ok(members::people(tx, &me.account)?)
        })
    }

    /// Up to `limit` messages before `before` (or the newest), oldest first.
    pub fn history(
        &mut self,
        conversation: &str,
        before: Option<u64>,
        limit: u32,
    ) -> Result<Vec<Message>, ClientError> {
        let group = group_id(conversation).ok_or(ClientError::UnknownConversation)?;
        self.reader.read(|tx| {
            let (_, me) = this_device(tx)?;
            let mut statement = tx.prepare(
                "SELECT seq, sender_account, sender_device, envelope FROM messages
                 WHERE group_id = ?1 AND seq < ?2 AND hidden = 0 ORDER BY seq DESC LIMIT ?3",
            )?;
            let rows = statement.query_map(
                params![group, before.map_or(i64::MAX, |b| b as i64), limit],
                |r| {
                    Ok((
                        r.get::<_, i64>(0)? as u64,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, Vec<u8>>(3)?,
                    ))
                },
            )?;
            let mut messages = Vec::new();
            for row in rows {
                let (seq, account, device, envelope) = row?;
                let sender = Device::new(&account, &device)?;
                messages.push(Message {
                    conversation: conversation.to_owned(),
                    seq,
                    own: sender == me,
                    sender,
                    envelope: Envelope::decode(&envelope)?,
                });
            }
            messages.reverse();
            Ok(messages)
        })
    }

    pub fn settings(&mut self) -> Result<Settings, ClientError> {
        Ok(self.reader.read(read::settings)?)
    }

    /// This account's invite link as this device last made it.
    pub fn invite_link(&mut self) -> Result<Option<String>, ClientError> {
        Ok(self.reader.read(read::invite_link)?)
    }
}

fn conversations(tx: &Transaction, media: &Path) -> Result<Vec<Conversation>, ClientError> {
    let mut statement = tx.prepare(&format!(
        "SELECT group_id, {STATE}, timer, name, photo_ready FROM conversations c
         ORDER BY MAX(created_at,
                      COALESCE((SELECT MAX(stored_at) FROM timeline t
                                WHERE t.group_id = c.group_id), 0),
                      COALESCE((SELECT MAX(created_at) FROM outbox o
                                WHERE o.group_id = c.group_id AND o.kind = 'message'),
                               0)) DESC,
                  created_at DESC"
    ))?;
    /// group, state, timer, name, photo ready.
    type Row = (Vec<u8>, State, Option<u32>, Option<String>, bool);
    let rows: Vec<Row> = statement
        .query_map([], |r| {
            Ok((
                r.get(0)?,
                State::parse(&r.get::<_, String>(1)?)?,
                r.get(2)?,
                r.get(3)?,
                r.get::<_, u8>(4)? == 1,
            ))
        })?
        .collect::<rusqlite::Result<_>>()?;
    if rows.is_empty() {
        // Signed out, or none yet.
        return Ok(Vec::new());
    }
    let (_, me) = this_device(tx)?;
    let mut conversations = Vec::with_capacity(rows.len());
    for (group, state, timer, name, photo_ready) in rows {
        conversations.push(Conversation {
            id: conversation_id(&group),
            state,
            name,
            members: notice::others(tx, &group, &me.account)?,
            last: timeline::items(tx, &group, &me.account, None, 1)?.pop(),
            unread: read::unread(tx, &group, &me.account)?,
            timer,
            photo: photo_ready.then(|| group_photo::path_of(media, &conversation_id(&group))),
            mute: mute::mute_of(tx, &group)?,
        });
    }
    Ok(conversations)
}
