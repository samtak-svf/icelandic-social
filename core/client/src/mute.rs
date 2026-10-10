//! Mute (0042). A mute is the account's, kept by the server, which owes no
//! push for a muted conversation. This core keeps the server's list, takes
//! each `mute` frame, and leaves muted conversations out of `notices()`.
//! The unread count still rises: a mute silences, it does not hide.

use spjall_store::rusqlite::{self, OptionalExtension, Transaction, params};

use crate::api::{Muted, Transport, conversation_id, group_id};
use crate::{Client, ClientError, Event, authed, now};

/// Whether a conversation is muted, and until when.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mute {
    Off,
    /// Until this time, in Unix milliseconds by the server's clock.
    Until(u64),
    /// Until turned back on.
    Always,
}

/// How long a mute lasts, from when the server takes it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MuteFor {
    Hour,
    EightHours,
    Always,
}

impl MuteFor {
    fn as_str(self) -> &'static str {
        match self {
            Self::Hour => "1h",
            Self::EightHours => "8h",
            Self::Always => "always",
        }
    }
}

/// The mute in force now: one whose end has passed counts as none.
pub(crate) fn mute_of(tx: &Transaction, group: &[u8]) -> rusqlite::Result<Mute> {
    let row: Option<Option<i64>> = tx
        .query_row(
            "SELECT until FROM mutes WHERE group_id = ?1",
            [group],
            |r| r.get(0),
        )
        .optional()?;
    Ok(match row {
        None => Mute::Off,
        Some(None) => Mute::Always,
        Some(Some(until)) if until > now() => Mute::Until(until as u64),
        Some(Some(_)) => Mute::Off,
    })
}

fn store_mute(tx: &Transaction, group: &[u8], until: Option<u64>) -> rusqlite::Result<()> {
    tx.execute(
        "INSERT INTO mutes (group_id, until) VALUES (?1, ?2)
         ON CONFLICT (group_id) DO UPDATE SET until = excluded.until",
        params![group, until.map(|u| u as i64)],
    )
    .map(drop)
}

fn group_of(conversation: &str) -> Result<Vec<u8>, ClientError> {
    group_id(conversation).ok_or(ClientError::UnknownConversation)
}

impl<T: Transport> Client<T> {
    /// Mutes a conversation on every device of this account: the server
    /// sends no push for it until the mute ends, and `notices()` shows none.
    pub fn mute(&mut self, conversation: &str, duration: MuteFor) -> Result<Mute, ClientError> {
        let group = group_of(conversation)?;
        let muted = authed(&self.transport, &self.token, &self.client)?
            .mute(conversation, duration.as_str())?;
        self.store.try_write(|tx| {
            store_mute(tx, &group, muted.until)?;
            Ok::<_, ClientError>(mute_of(tx, &group)?)
        })
    }

    /// Turns notifications back on for a conversation.
    pub fn unmute(&mut self, conversation: &str) -> Result<(), ClientError> {
        let group = group_of(conversation)?;
        authed(&self.transport, &self.token, &self.client)?.unmute(conversation)?;
        self.store.try_write(|tx| {
            tx.execute("DELETE FROM mutes WHERE group_id = ?1", [&group])
                .map(drop)
        })?;
        Ok(())
    }

    /// Takes the server's list, which holds mutes set on this account's
    /// other devices while this one was away.
    pub(crate) fn refresh_mutes(&mut self) -> Result<(), ClientError> {
        let mutes = authed(&self.transport, &self.token, &self.client)?.mutes()?;
        let changed = self.store.try_write(|tx| {
            let before = all_mutes(tx)?;
            tx.execute("DELETE FROM mutes", [])?;
            for Muted {
                conversation_id,
                until,
            } in &mutes
            {
                // An id outside the contract is skipped, not stored.
                if let Some(group) = group_id(conversation_id) {
                    store_mute(tx, &group, *until)?;
                }
            }
            let after = all_mutes(tx)?;
            let mut changed: Vec<Vec<u8>> = before
                .iter()
                .filter(|m| !after.contains(m))
                .chain(after.iter().filter(|m| !before.contains(m)))
                .map(|(group, _)| group.clone())
                .collect();
            changed.sort();
            changed.dedup();
            Ok::<_, ClientError>(changed)
        })?;
        for group in changed {
            self.mute_changed(&group)?;
        }
        Ok(())
    }

    /// A `mute` frame: this account's mute changed on another device.
    pub(crate) fn on_mute(
        &mut self,
        conversation: &str,
        muted: bool,
        until: Option<u64>,
    ) -> Result<(), ClientError> {
        let group = group_id(conversation).ok_or(ClientError::Protocol("conversation id"))?;
        self.store.try_write(|tx| {
            if muted {
                store_mute(tx, &group, until)
            } else {
                tx.execute("DELETE FROM mutes WHERE group_id = ?1", [&group])
                    .map(drop)
            }
        })?;
        self.mute_changed(&group)?;
        Ok(())
    }

    /// The list redraws a row whose mute changed, as it does when only
    /// read state moved.
    fn mute_changed(&mut self, group: &[u8]) -> Result<(), ClientError> {
        let known = self.store.try_write(|tx| {
            tx.query_row(
                "SELECT 1 FROM conversations WHERE group_id = ?1",
                [group],
                |_| Ok(()),
            )
            .optional()
        })?;
        if known.is_some() {
            self.outcome.events.push(Event::Timeline {
                conversation: conversation_id(group),
                changed: Vec::new(),
            });
        }
        Ok(())
    }
}

fn all_mutes(tx: &Transaction) -> rusqlite::Result<Vec<(Vec<u8>, Option<i64>)>> {
    let mut statement = tx.prepare("SELECT group_id, until FROM mutes ORDER BY group_id")?;
    let rows = statement.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
    rows.collect()
}
