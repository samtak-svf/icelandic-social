//! The link code a new device shows as a QR and a phone scans (0077):
//! `SPJL1.<linkId>.<deviceKey>.<historyKey>`, the keys in unpadded base64url.
//! Plain text, not a URL, so only the app's own scanner acts on it. The
//! version is the prefix; a later format is a new prefix this one refuses.
//!
//! The browser's side is `begin_device_link`, `device_link_state`,
//! `complete_device_link` and `receive_linked_history` (0064, 0081): it asks
//! as a session, shows the code, and once a phone approved it becomes a
//! device and fetches the history the phone sent.
//!
//! The phone reads the code, asks the server for the request it names, and
//! approves it only when the server's keys are the code's: the person
//! approves the device they are looking at, not one the server substitutes.

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use spjall_mls::group::Device;
use spjall_mls::storage::Provider;
use spjall_store::rusqlite::{OptionalExtension, params};

use crate::account::SignedIn;
use crate::api::{Api, ApiError, Transport, from_base64};
use crate::clock::now;
use crate::history::{HISTORY_PIECE, history_key};
use crate::{Client, ClientError, authed, identity, is_id};

const PREFIX: &str = "SPJL1";
/// Both keys are 32 bytes: the Ed25519 device key and the X25519 history key.
const KEY: usize = 32;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LinkCode {
    pub link_id: String,
    pub device_key: Vec<u8>,
    pub history_key: Vec<u8>,
}

impl LinkCode {
    /// The code `text` spells, or none when it is not one this version reads.
    pub fn parse(text: &str) -> Option<Self> {
        let mut fields = text.trim().split('.');
        let (Some(PREFIX), Some(link_id), Some(device), Some(history), None) = (
            fields.next(),
            fields.next(),
            fields.next(),
            fields.next(),
            fields.next(),
        ) else {
            return None;
        };
        let key = |text: &str| {
            URL_SAFE_NO_PAD
                .decode(text)
                .ok()
                .filter(|key| key.len() == KEY)
        };
        is_link_id(link_id).then_some(())?;
        Some(Self {
            link_id: link_id.into(),
            device_key: key(device)?,
            history_key: key(history)?,
        })
    }
}

impl std::fmt::Display for LinkCode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "{PREFIX}.{}.{}.{}",
            self.link_id,
            URL_SAFE_NO_PAD.encode(&self.device_key),
            URL_SAFE_NO_PAD.encode(&self.history_key),
        )
    }
}

/// Why a link request cannot be approved.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum LinkError {
    /// The text is not a link code this version reads.
    #[error("not a link code")]
    InvalidCode,
    /// The server's request carries other keys than the code.
    #[error("the server's link request does not match the code")]
    KeyMismatch,
    /// Expired, completed, or another account's.
    #[error("the link request is no longer pending")]
    Gone,
    /// Another approval came first (0077).
    #[error("the link request is already approved")]
    AlreadyApproved,
    /// No phone has approved this browser's request yet (0064).
    #[error("no phone has approved the link request yet")]
    NotApproved,
}

/// The request a browser session made for itself (0064), to show as a QR
/// code.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeviceLink {
    /// The text of the QR code (`LinkCode`'s `Display`).
    pub code: String,
    pub link_id: String,
    /// Milliseconds since the epoch.
    pub expires_at: i64,
}

/// Where this browser's link request stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LinkState {
    /// Shown, and no phone has approved it.
    Pending,
    /// A phone approved: `complete_device_link` makes this a device.
    Approved,
    /// Past its time, or the server no longer has it. Ask for a new one.
    Expired,
}

/// What completing a link made of this session (0064, 0081).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Enrolled {
    pub signed_in: SignedIn,
    /// Whether the approving phone sends a history, so
    /// `receive_linked_history` has something to fetch.
    pub history_expected: bool,
    /// The server's 32-byte half of the browser's store key. Not kept here:
    /// the web layer combines it with its own half.
    pub store_key_share: Vec<u8>,
}

/// A pending link request as the phone shows it before approving.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LinkRequest {
    pub browser: Option<String>,
    pub os: Option<String>,
    /// Milliseconds since the epoch.
    pub expires_at: i64,
    pub approved: bool,
}

impl<T: Transport> Client<T> {
    /// The request the link code `code` names, once the server's keys are
    /// shown to be the code's.
    pub fn inspect_link(&self, code: &str) -> Result<LinkRequest, ClientError> {
        let code = LinkCode::parse(code).ok_or(LinkError::InvalidCode)?;
        let api = authed(&self.transport, &self.token, &self.client)?;
        let info = api
            .get_device_link_request(&code.link_id)
            .map_err(refusal)?;
        let same = |text: &str, key: &[u8]| from_base64(text).is_some_and(|k| k == key);
        if info.link_id != code.link_id
            || !same(&info.device_key, &code.device_key)
            || !same(&info.history_key, &code.history_key)
        {
            return Err(LinkError::KeyMismatch.into());
        }
        if info.expires_at <= now() {
            return Err(LinkError::Gone.into());
        }
        Ok(LinkRequest {
            browser: info.browser,
            os: info.os,
            expires_at: info.expires_at,
            approved: info.approved,
        })
    }

    /// Approves the request the link code `code` names with this device's
    /// signature (0077), after `inspect_link`'s checks, then sends the new
    /// device this device's history since `since` when `send` is set.
    /// Returns the sealed size, or 0 when nothing was sent.
    pub fn approve_link(
        &mut self,
        code: &str,
        since: Option<u64>,
        send: bool,
    ) -> Result<u64, ClientError> {
        if self.inspect_link(code)?.approved {
            return Err(LinkError::AlreadyApproved.into());
        }
        let code = LinkCode::parse(code).ok_or(LinkError::InvalidCode)?;
        let signature = self.store.try_write(|tx| {
            let provider = Provider::new(tx);
            let identity = identity(tx, &provider)?;
            Ok::<_, ClientError>(identity.sign_link_approval(&code.link_id, &code.device_key)?)
        })?;
        let api = authed(&self.transport, &self.token, &self.client)?;
        api.approve_device_link_request(&code.link_id, &signature, send)
            .map_err(refusal)?;
        if !send {
            return Ok(0);
        }
        self.send_history(&code.link_id, since, &code.history_key)
    }
}

impl<T: Transport> Client<T> {
    /// Asks, as a browser session, to become a device (0064): makes the
    /// device key and a one-time history key, registers the request and
    /// returns the code a phone scans. Both keys stay in the store, so a
    /// restart goes on with the same link. A new call replaces the request.
    /// A device that is signed in does not link again.
    pub fn begin_device_link(&mut self) -> Result<DeviceLink, ClientError> {
        if self.signed_in()?.is_some() {
            return Err(ClientError::Invalid("already signed in"));
        }
        let device_key = self.device_key()?;
        let history = history_key()?;
        let created = Api::new(&self.transport, None)
            .client(self.client.as_deref())
            .create_device_link_request(&device_key, &history.public)?;
        if !is_link_id(&created.link_id) {
            return Err(ClientError::Protocol(
                "createDeviceLinkRequest answered a bad id",
            ));
        }
        self.store.write(|tx| {
            tx.execute(
                "INSERT OR REPLACE INTO device_link
                     (id, link_id, history_private, expires_at, phase)
                 VALUES (1, ?1, ?2, ?3, 'requested')",
                params![created.link_id, history.private, created.expires_at],
            )
        })?;
        let code = LinkCode {
            link_id: created.link_id.clone(),
            device_key,
            history_key: history.public,
        };
        Ok(DeviceLink {
            code: code.to_string(),
            link_id: created.link_id,
            expires_at: created.expires_at,
        })
    }

    /// The request this session is waiting on: `Gone` when it asked for
    /// none, or has completed it.
    fn requested_link(&mut self) -> Result<(String, i64), ClientError> {
        let row: Option<(String, i64)> = self.store.try_write(|tx| {
            tx.query_row(
                "SELECT link_id, expires_at FROM device_link WHERE phase = 'requested'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(ClientError::from)
        })?;
        row.ok_or_else(|| LinkError::Gone.into())
    }

    /// Whether a phone has approved this session's request yet.
    pub fn device_link_state(&mut self) -> Result<LinkState, ClientError> {
        let (link, expires_at) = self.requested_link()?;
        if expires_at <= now() {
            return Ok(LinkState::Expired);
        }
        let asked = Api::new(&self.transport, None)
            .client(self.client.as_deref())
            .get_device_link_request(&link);
        match asked {
            Ok(info) if info.approved => Ok(LinkState::Approved),
            Ok(_) => Ok(LinkState::Pending),
            Err(error) if error.code() == Some("not_found") => Ok(LinkState::Expired),
            Err(error) => Err(error.into()),
        }
    }

    /// Becomes the device the approved request makes: stores the device
    /// token as `complete_sign_in` does and returns the server's store-key
    /// share. Before an approval it is `NotApproved` and the request stays;
    /// an expired, unknown or already completed one is `Gone`, refused here
    /// without asking the server when this store knows it.
    pub fn complete_device_link(&mut self) -> Result<Enrolled, ClientError> {
        let (link, expires_at) = self.requested_link()?;
        if expires_at <= now() {
            return Err(LinkError::Gone.into());
        }
        let answer = Api::new(&self.transport, None)
            .client(self.client.as_deref())
            .complete_device_link_request(&link);
        let linked = match answer {
            Ok(linked) => linked,
            Err(error) => {
                return Err(match error.code() {
                    Some("not_approved") => LinkError::NotApproved.into(),
                    Some("not_found") => {
                        self.store.write(|tx| {
                            tx.execute("DELETE FROM device_link WHERE phase = 'requested'", [])
                        })?;
                        LinkError::Gone.into()
                    }
                    _ => error.into(),
                });
            }
        };
        let device = Device::new(&linked.account_id, &linked.device_id)
            .ok()
            .filter(|_| {
                is_id(&linked.account_id) && is_id(&linked.device_id) && !linked.token.is_empty()
            })
            .ok_or(ClientError::Protocol(
                "completeDeviceLinkRequest answered a bad id",
            ))?;
        let share = from_base64(&linked.store_key_share)
            .filter(|share| share.len() == KEY)
            .ok_or(ClientError::Protocol(
                "completeDeviceLinkRequest answered a bad store key share",
            ))?;
        self.store.try_write(|tx| {
            tx.execute(
                "UPDATE account SET account_id = ?1, device_id = ?2, device_token = ?3",
                params![linked.account_id, linked.device_id, linked.token],
            )?;
            if linked.history_expected {
                tx.execute("UPDATE device_link SET phase = 'completed'", [])?;
            } else {
                tx.execute("DELETE FROM device_link", [])?;
            }
            Ok::<_, ClientError>(())
        })?;
        self.token = Some(linked.token);
        Ok(Enrolled {
            signed_in: device,
            history_expected: linked.history_expected,
            store_key_share: share,
        })
    }

    /// Fetches the history the approving phone sent, in pieces of at most
    /// 64 MiB (0081), imports it and deletes the server's copy, then drops
    /// the one-time key. Returns how many conversations it brought; 0 and
    /// no request when none is expected or it was received. A failure keeps
    /// the key, so the call can be made again: the phone may still be
    /// uploading (404 `not_found`).
    pub fn receive_linked_history(&mut self) -> Result<usize, ClientError> {
        self.receive_linked_history_in(HISTORY_PIECE)
    }

    /// `receive_linked_history` with pieces of `piece` bytes.
    pub fn receive_linked_history_in(&mut self, piece: u64) -> Result<usize, ClientError> {
        let row: Option<(String, Vec<u8>)> = self.store.try_write(|tx| {
            tx.query_row(
                "SELECT link_id, history_private FROM device_link WHERE phase = 'completed'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(ClientError::from)
        })?;
        let Some((link, private)) = row else {
            return Ok(0);
        };
        let received = self.receive_history_in(&link, &private, piece);
        // Past the server's 24 hours the key opens nothing.
        let over = matches!(
            &received,
            Err(ClientError::Transport(error)) if error.code() == Some("expired")
        );
        if received.is_ok() || over {
            self.store
                .write(|tx| tx.execute("DELETE FROM device_link", []))?;
        }
        Ok(received?.conversations as usize)
    }
}

/// `error` as a `LinkError` when it is a refusal of the link request.
fn refusal(error: ApiError) -> ClientError {
    match error.code() {
        Some("not_found") => LinkError::Gone.into(),
        Some("already_approved") => LinkError::AlreadyApproved.into(),
        _ => error.into(),
    }
}

/// An id the server made: what `OpaqueId` allows (`backend/src/api/common.ts`).
fn is_link_id(text: &str) -> bool {
    (1..=128).contains(&text.len())
        && text
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

#[cfg(test)]
mod tests {
    use super::*;

    fn code() -> LinkCode {
        LinkCode {
            link_id: "dl_a-B9".into(),
            device_key: vec![0xfb; KEY],
            history_key: (0..KEY as u8).collect(),
        }
    }

    #[test]
    fn a_code_reads_back_as_itself() {
        let text = code().to_string();
        assert!(text.starts_with("SPJL1.dl_a-B9."), "{text}");
        assert!(!text.contains(['+', '/', '=']), "{text}");
        assert_eq!(LinkCode::parse(&text), Some(code()));
        assert_eq!(LinkCode::parse(&format!("  {text}\n")), Some(code()));
    }

    #[test]
    fn another_version_is_refused() {
        let text = code().to_string().replacen("SPJL1", "SPJL2", 1);
        assert_eq!(LinkCode::parse(&text), None);
        let text = code().to_string().replacen("SPJL1", "spjl1", 1);
        assert_eq!(LinkCode::parse(&text), None);
    }

    #[test]
    fn a_key_of_another_length_is_refused() {
        for (device, history) in [(31, KEY), (KEY, 33), (0, KEY)] {
            let short = LinkCode {
                device_key: vec![1; device],
                history_key: vec![2; history],
                ..code()
            };
            assert_eq!(
                LinkCode::parse(&short.to_string()),
                None,
                "{device} {history}"
            );
        }
    }

    #[test]
    fn a_key_that_is_not_base64url_is_refused() {
        let text = code().to_string();
        let padded = format!("{text}=");
        let standard = text.replace('_', "/");
        for bad in [padded, standard] {
            assert_eq!(LinkCode::parse(&bad), None, "{bad}");
        }
    }

    #[test]
    fn missing_or_extra_fields_are_refused() {
        let text = code().to_string();
        let (head, _) = text.rsplit_once('.').unwrap();
        for bad in [
            head.to_string(),
            format!("{text}.x"),
            format!("{text}."),
            "SPJL1".into(),
            String::new(),
            "https://spjall.samtak.is/l/abc".into(),
        ] {
            assert_eq!(LinkCode::parse(&bad), None, "{bad}");
        }
    }

    #[test]
    fn a_link_id_outside_the_id_alphabet_is_refused() {
        for id in ["", "dl a", "dl/a", &"x".repeat(129)] {
            let bad = LinkCode {
                link_id: id.into(),
                ..code()
            };
            assert_eq!(LinkCode::parse(&bad.to_string()), None, "{id}");
        }
    }
}
