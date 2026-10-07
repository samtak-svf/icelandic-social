//! Read markers, unread counts and the toggles of 0009 (0022). Each
//! account's mark is the highest seq its receipts reached; this account's
//! own mark also moves when it reads or sends here, on any of its devices.

use spjall_store::rusqlite::{self, OptionalExtension, Transaction, params};

/// The toggles of 0009. Off stops both sending and showing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Settings {
    pub read_markers: bool,
    pub typing: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            read_markers: true,
            typing: true,
        }
    }
}

pub(crate) fn settings(tx: &Transaction) -> rusqlite::Result<Settings> {
    Ok(tx
        .query_row(
            "SELECT read_markers, typing FROM settings WHERE id = 1",
            [],
            |r| {
                Ok(Settings {
                    read_markers: r.get(0)?,
                    typing: r.get(1)?,
                })
            },
        )
        .optional()?
        .unwrap_or_default())
}

pub(crate) fn set_settings(tx: &Transaction, settings: Settings) -> rusqlite::Result<()> {
    tx.execute(
        "INSERT INTO settings (id, read_markers, typing) VALUES (1, ?1, ?2)
         ON CONFLICT (id) DO UPDATE SET
             read_markers = excluded.read_markers, typing = excluded.typing",
        params![settings.read_markers, settings.typing],
    )
    .map(drop)
}

pub(crate) fn mark(tx: &Transaction, group: &[u8], account: &str) -> rusqlite::Result<u64> {
    Ok(tx
        .query_row(
            "SELECT seq FROM read_state WHERE group_id = ?1 AND account = ?2",
            params![group, account],
            |r| r.get::<_, i64>(0),
        )
        .optional()?
        .map_or(0, |s| s as u64))
}

/// Moves an account's mark forward to `seq`; the mark it had when it moved.
pub(crate) fn advance(
    tx: &Transaction,
    group: &[u8],
    account: &str,
    seq: u64,
) -> rusqlite::Result<Option<u64>> {
    let old = mark(tx, group, account)?;
    if seq <= old {
        return Ok(None);
    }
    tx.execute(
        "INSERT INTO read_state (group_id, account, seq) VALUES (?1, ?2, ?3)
         ON CONFLICT (group_id, account) DO UPDATE SET seq = excluded.seq",
        params![group, account, seq as i64],
    )?;
    Ok(Some(old))
}

/// Messages from others after this account's mark.
pub(crate) fn unread(tx: &Transaction, group: &[u8], me: &str) -> rusqlite::Result<u32> {
    tx.query_row(
        "SELECT COUNT(*) FROM timeline
         WHERE group_id = ?1 AND seq > ?3 AND sender_account != ?2
               AND kind IN ('text', 'media') AND deleted = 0",
        params![group, me, mark(tx, group, me)? as i64],
        |r| r.get(0),
    )
}

/// How many accounts besides its sender have read the item at `seq`.
pub(crate) fn read_by(
    tx: &Transaction,
    group: &[u8],
    seq: u64,
    sender: &str,
) -> rusqlite::Result<u32> {
    tx.query_row(
        "SELECT COUNT(*) FROM read_state WHERE group_id = ?1 AND account != ?2 AND seq >= ?3",
        params![group, sender, seq as i64],
        |r| r.get(0),
    )
}
