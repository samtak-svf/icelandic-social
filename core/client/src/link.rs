//! The link code a new device shows as a QR and a phone scans (0077):
//! `SPJL1.<linkId>.<deviceKey>.<historyKey>`, the keys in unpadded base64url.
//! Plain text, not a URL, so only the app's own scanner acts on it. The
//! version is the prefix; a later format is a new prefix this one refuses.
//!
//! The phone reads the code, asks the server for the request it names, and
//! approves it only when the server's keys are the code's: the person
//! approves the device they are looking at, not one the server substitutes.

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use spjall_mls::storage::Provider;

use crate::api::{ApiError, Transport, from_base64};
use crate::clock::now;
use crate::{Client, ClientError, authed, identity};

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
        api.approve_device_link_request(&code.link_id, &signature)
            .map_err(refusal)?;
        if !send {
            return Ok(0);
        }
        self.send_history(&code.link_id, since, &code.history_key)
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
