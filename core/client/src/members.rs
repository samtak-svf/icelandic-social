//! The accounts in each conversation, and the names the server gave them
//! (0022). The roster is MLS's, written after each commit this device
//! processes; a name is never taken from an envelope.

use spjall_mls::group::Group;
use spjall_store::rusqlite::{self, OptionalExtension, Transaction, params};

use crate::api::Profile;
use crate::{ClientError, accounts, now};

/// An account as the screens show it: the name and mark the server gave,
/// none until the core has fetched them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Person {
    pub account: String,
    pub name: Option<String>,
    pub verified: bool,
}

/// How long a fetched profile is shown before it is fetched again.
const PROFILE_TTL_MS: i64 = 24 * 60 * 60 * 1000;

pub(crate) fn set_members(
    tx: &Transaction,
    group: &[u8],
    accounts: &[String],
) -> rusqlite::Result<()> {
    tx.execute("DELETE FROM members WHERE group_id = ?1", [group])?;
    for account in accounts {
        tx.execute(
            "INSERT OR IGNORE INTO members (group_id, account) VALUES (?1, ?2)",
            params![group, account],
        )?;
    }
    Ok(())
}

/// The roster as MLS holds it now.
pub(crate) fn refresh_members(
    tx: &Transaction,
    group: &[u8],
    mls: &Group,
) -> Result<(), ClientError> {
    let accounts = accounts(mls.devices()?);
    set_members(tx, group, &accounts)?;
    // The server named no one it did not share a conversation with; now it
    // may, so those are fetched again.
    for account in &accounts {
        tx.execute(
            "DELETE FROM profiles WHERE account = ?1 AND name IS NULL",
            [account],
        )?;
    }
    Ok(())
}

/// The accounts in a group, sorted.
pub(crate) fn members(tx: &Transaction, group: &[u8]) -> rusqlite::Result<Vec<String>> {
    let mut statement =
        tx.prepare("SELECT account FROM members WHERE group_id = ?1 ORDER BY account")?;
    let rows = statement.query_map([group], |r| r.get(0))?;
    rows.collect()
}

pub(crate) fn person(tx: &Transaction, account: &str) -> rusqlite::Result<Person> {
    let profile: Option<(Option<String>, bool)> = tx
        .query_row(
            "SELECT name, verified FROM profiles WHERE account = ?1",
            [account],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    let (name, verified) = profile.unwrap_or((None, false));
    Ok(Person {
        account: account.to_owned(),
        name,
        verified,
    })
}

pub(crate) fn people_of(tx: &Transaction, accounts: &[String]) -> rusqlite::Result<Vec<Person>> {
    accounts.iter().map(|a| person(tx, a)).collect()
}

/// Every account met through a shared conversation, named ones first.
pub(crate) fn people(tx: &Transaction, me: &str) -> rusqlite::Result<Vec<Person>> {
    let mut statement = tx.prepare(
        "SELECT DISTINCT m.account FROM members m LEFT JOIN profiles p USING (account)
         WHERE m.account != ?1
         ORDER BY p.name IS NULL, p.name, m.account",
    )?;
    let accounts: Vec<String> = statement
        .query_map([me], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    people_of(tx, &accounts)
}

/// Accounts met whose profile is missing or old, this account's own among
/// them: its name shows in reply quotes, cards and previews too.
pub(crate) fn unfetched(tx: &Transaction) -> rusqlite::Result<Vec<String>> {
    let mut statement = tx.prepare(
        "SELECT DISTINCT m.account FROM members m LEFT JOIN profiles p USING (account)
         WHERE p.fetched_at IS NULL OR p.fetched_at < ?1
         ORDER BY m.account",
    )?;
    let rows = statement.query_map([now() - PROFILE_TTL_MS], |r| r.get(0))?;
    rows.collect()
}

/// What the server answered; `None` for an account it would not name.
pub(crate) fn store_profile(
    tx: &Transaction,
    account: &str,
    profile: Option<&Profile>,
) -> rusqlite::Result<()> {
    tx.execute(
        "INSERT INTO profiles (account, name, verified, fetched_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT (account) DO UPDATE SET
             name = excluded.name, verified = excluded.verified, fetched_at = excluded.fetched_at",
        params![
            account,
            profile.and_then(|p| p.name.as_deref()),
            profile.is_some_and(|p| p.verified),
            now()
        ],
    )
    .map(drop)
}
