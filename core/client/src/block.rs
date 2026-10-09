//! Block (0024). The server refuses the blocked account new contact; this
//! core removes it from the 1:1s the two share and keeps its messages in
//! shared groups hidden. Hidden messages are still decrypted, so the group
//! stays in step, but they make no item, count or event.

use spjall_store::rusqlite::{self, OptionalExtension, Transaction, params};

use crate::api::{ApiError, Profile, Transport};
use crate::members::{Person, people_of, store_profile};
use crate::{Client, ClientError, Outcome, STATE, authed, enqueue, is_id, now, this_device};

pub(crate) fn is_blocked(tx: &Transaction, account: &str) -> rusqlite::Result<bool> {
    Ok(tx
        .query_row("SELECT 1 FROM blocks WHERE account = ?1", [account], |_| {
            Ok(())
        })
        .optional()?
        .is_some())
}

/// The conversations this device can still send to whose only accounts
/// are this one and `other`.
fn one_to_ones(tx: &Transaction, other: &str) -> rusqlite::Result<Vec<Vec<u8>>> {
    let mut statement = tx.prepare(&format!(
        "SELECT group_id FROM conversations c
         WHERE {STATE} IN ('new', 'active')
               AND (SELECT COUNT(*) FROM members m WHERE m.group_id = c.group_id) = 2
               AND EXISTS (SELECT 1 FROM members m
                           WHERE m.group_id = c.group_id AND m.account = ?1)"
    ))?;
    let rows = statement.query_map([other], |r| r.get(0))?;
    rows.collect()
}

impl<T: Transport> Client<T> {
    /// Blocks an account: the server refuses it new contact, and this
    /// account's 1:1s with it end with a remove commit, sent now.
    pub fn block(&mut self, account: &str) -> Result<Outcome, ClientError> {
        if !is_id(account) {
            return Err(ClientError::Invalid("account id"));
        }
        let me = self
            .store
            .try_write(|tx| Ok::<_, ClientError>(this_device(tx)?.1))?;
        if me.account == account {
            return Err(ClientError::Invalid("an account cannot block itself"));
        }
        authed(&self.transport, &self.token, &self.client)?.block(account)?;
        let ended = self.store.try_write(|tx| {
            let new = tx.execute(
                "INSERT INTO blocks (account, blocked_at) VALUES (?1, ?2)
                 ON CONFLICT (account) DO NOTHING",
                params![account, now()],
            )?;
            // Already blocked here: its removals were queued then.
            if new == 0 {
                return Ok(Vec::new());
            }
            let ended = one_to_ones(tx, account)?;
            for group in &ended {
                enqueue(tx, group, "remove", account.as_bytes())?;
            }
            Ok::<_, ClientError>(ended)
        })?;
        for group in ended {
            self.sync_one(&group)?;
        }
        Ok(std::mem::take(&mut self.outcome))
    }

    /// Lifts a block. New group messages show again; hidden ones stay
    /// hidden, and an ended 1:1 stays ended.
    pub fn unblock(&mut self, account: &str) -> Result<(), ClientError> {
        if !is_id(account) {
            return Err(ClientError::Invalid("account id"));
        }
        authed(&self.transport, &self.token, &self.client)?.unblock(account)?;
        self.store.try_write(|tx| {
            tx.execute("DELETE FROM blocks WHERE account = ?1", [account])
                .map(drop)
        })?;
        Ok(())
    }

    /// The accounts this one blocked, newest first, as the server lists
    /// them; as this device last knew them when the server does not answer.
    pub fn blocked(&mut self) -> Result<Vec<Person>, ClientError> {
        match self.refresh_blocks() {
            Ok(()) | Err(ClientError::Transport(ApiError::Unreachable(_))) => {}
            Err(error) => return Err(error),
        }
        self.store.try_write(|tx| {
            let mut statement =
                tx.prepare("SELECT account FROM blocks ORDER BY blocked_at DESC, account")?;
            let accounts: Vec<String> = statement
                .query_map([], |r| r.get(0))?
                .collect::<rusqlite::Result<_>>()?;
            Ok::<_, ClientError>(people_of(tx, &accounts)?)
        })
    }

    /// Takes the server's list, which holds blocks set on this account's
    /// other devices, with the names it gives.
    pub(crate) fn refresh_blocks(&mut self) -> Result<(), ClientError> {
        let blocked = authed(&self.transport, &self.token, &self.client)?.blocks()?;
        self.store.try_write(|tx| {
            tx.execute("DELETE FROM blocks", [])?;
            for b in &blocked {
                tx.execute(
                    "INSERT OR REPLACE INTO blocks (account, blocked_at) VALUES (?1, ?2)",
                    params![b.account_id, b.blocked_at as i64],
                )?;
                let profile = Profile {
                    name: b.name.clone(),
                    verified: b.verified,
                };
                store_profile(tx, &b.account_id, Some(&profile))?;
            }
            Ok(())
        })
    }
}
