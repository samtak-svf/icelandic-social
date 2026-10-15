//! What the screens read, on the store's `Reader` (decision 0056): the
//! list, a timeline, the list's search on this device, the people and the
//! settings. None of it waits for a sync or a send holding the `Client`
//! through a network call, and none of it writes, so a row whose timer is up
//! is left out by the `Reader` rather than purged first.

use spjall_envelope::Envelope;
use spjall_store::Reader;
use spjall_store::rusqlite::{self, Transaction, params};

use crate::api::{conversation_id, group_id};
use crate::directory::{fold_name, query, starts_a_word};
use crate::{
    ClientError, Conversation, Device, Item, Message, Person, STATE, Settings, State,
    conversation_state, members, mute, notice, read, this_device, timeline,
};

/// The reads, on a connection of their own. The app holds one beside its
/// `Client` and behind a lock of its own.
pub struct View {
    reader: Reader,
}

impl View {
    pub(crate) fn new(reader: Reader) -> Self {
        Self { reader }
    }

    /// Every conversation, the one with the newest activity first.
    pub fn conversations(&mut self) -> Result<Vec<Conversation>, ClientError> {
        self.reader.read(conversations)
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

    /// The conversations whose title, the names of the others in it, has a
    /// name matching `search` at the start of a word (0038), in the order
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
                c.members.iter().any(|p| {
                    p.name
                        .as_deref()
                        .is_some_and(|name| starts_a_word(&fold_name(name), &search))
                })
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
}

fn conversations(tx: &Transaction) -> Result<Vec<Conversation>, ClientError> {
    let mut statement = tx.prepare(&format!(
        "SELECT group_id, {STATE}, timer FROM conversations c
         ORDER BY MAX(created_at,
                      COALESCE((SELECT MAX(stored_at) FROM timeline t
                                WHERE t.group_id = c.group_id), 0),
                      COALESCE((SELECT MAX(created_at) FROM outbox o
                                WHERE o.group_id = c.group_id AND o.kind = 'message'),
                               0)) DESC,
                  created_at DESC"
    ))?;
    let rows: Vec<(Vec<u8>, State, Option<u32>)> = statement
        .query_map([], |r| {
            Ok((r.get(0)?, State::parse(&r.get::<_, String>(1)?)?, r.get(2)?))
        })?
        .collect::<rusqlite::Result<_>>()?;
    if rows.is_empty() {
        // Signed out, or none yet.
        return Ok(Vec::new());
    }
    let (_, me) = this_device(tx)?;
    let mut conversations = Vec::with_capacity(rows.len());
    for (group, state, timer) in rows {
        conversations.push(Conversation {
            id: conversation_id(&group),
            state,
            members: notice::others(tx, &group, &me.account)?,
            last: timeline::items(tx, &group, &me.account, None, 1)?.pop(),
            unread: read::unread(tx, &group, &me.account)?,
            timer,
            mute: mute::mute_of(tx, &group)?,
        });
    }
    Ok(conversations)
}
