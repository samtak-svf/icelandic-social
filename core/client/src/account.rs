//! Signing in with Kenni and the calls about the account (decision 0019).
//!
//! `begin_sign_in` makes the PKCE verifier, the `state` and the `nonce`,
//! keeps them in the store and returns the authorize URL for the app to open
//! in Custom Tabs or `ASWebAuthenticationSession`. `complete_sign_in` takes
//! the URL Kenni redirected to, checks its `state`, and registers this
//! device with the code; the Worker redeems the code with Kenni itself. The
//! verifier leaves the device only in that one request.

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use sha2::{Digest as _, Sha256};
use spjall_mls::group::Device;
use spjall_store::rusqlite::{OptionalExtension, Transaction, params};

use crate::api::conversation_id;
use crate::api::{Api, ApiError, Inviter, Me, Platform, Registration, Transport};
use crate::members::members;
use crate::{Client, ClientError, authed, is_id, now, this_device};

/// The link host and the app's scheme, as `hosts.link`,
/// `hosts.linkPathPrefix` and `store.urlScheme` in `identifiers/ids.json`
/// name them; a test holds them equal.
const LINK_PREFIX: &str = "https://spjall.samtak.is/l/";
const APP_PREFIX: &str = "is.samtak.spjall://invite/";

/// This device as the server registered it.
pub type SignedIn = Device;

/// `n` random bytes, unpadded base64url: 43 characters for 32 bytes, which
/// is what RFC 7636 asks of a verifier, and 22 for 16.
fn random(n: usize) -> String {
    let mut bytes = vec![0u8; n];
    getrandom::fill(&mut bytes).expect("the OS has randomness");
    URL_SAFE_NO_PAD.encode(bytes)
}

/// The S256 challenge of a verifier (RFC 7636 § 4.2).
fn challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

/// Percent-encodes everything but RFC 3986's unreserved characters.
fn encode(text: &str) -> String {
    text.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect()
}

/// Decodes one form-encoded query value; `None` for a broken escape or
/// bytes that are not UTF-8.
fn decode(text: &str) -> Option<String> {
    let mut bytes = Vec::with_capacity(text.len());
    let mut rest = text.as_bytes();
    while let [first, tail @ ..] = rest {
        match first {
            b'%' => {
                let hex = std::str::from_utf8(tail.get(..2)?).ok()?;
                bytes.push(u8::from_str_radix(hex, 16).ok()?);
                rest = &tail[2..];
            }
            b'+' => {
                bytes.push(b' ');
                rest = tail;
            }
            _ => {
                bytes.push(*first);
                rest = tail;
            }
        }
    }
    String::from_utf8(bytes).ok()
}

/// The authorize URL (OpenID Connect Core § 3.1.2.1).
fn authorize_url(
    endpoint: &str,
    client_id: &str,
    redirect_uri: &str,
    scope: &str,
    pending: &Pending,
) -> String {
    let query = [
        ("response_type", "code"),
        ("client_id", client_id),
        ("redirect_uri", redirect_uri),
        ("scope", scope),
        ("state", &pending.state),
        ("nonce", &pending.nonce),
        ("code_challenge", &challenge(&pending.verifier)),
        ("code_challenge_method", "S256"),
    ]
    .iter()
    .map(|(name, value)| format!("{name}={}", encode(value)))
    .collect::<Vec<_>>()
    .join("&");
    let join = if endpoint.contains('?') { '&' } else { '?' };
    format!("{endpoint}{join}{query}")
}

/// The query of a callback to `redirect_uri`, or `None` for any other URL.
fn callback_query(callback: &str, redirect_uri: &str) -> Option<Vec<(String, String)>> {
    let callback = callback.split('#').next()?;
    let query = callback.strip_prefix(redirect_uri)?.strip_prefix('?')?;
    query
        .split('&')
        .filter(|pair| !pair.is_empty())
        .map(|pair| {
            let (name, value) = pair.split_once('=').unwrap_or((pair, ""));
            Some((decode(name)?, decode(value)?))
        })
        .collect()
}

fn is_token(text: &str) -> bool {
    (16..=128).contains(&text.len())
        && text
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// The invite token in a link, from the link host or the app's scheme.
pub fn invite_token(link: &str) -> Option<String> {
    let rest = link
        .strip_prefix(LINK_PREFIX)
        .or_else(|| link.strip_prefix(APP_PREFIX))?;
    let token = rest.split(['?', '#', '/']).next()?;
    is_token(token).then(|| token.to_owned())
}

/// The sign-in waiting for its callback.
struct Pending {
    verifier: String,
    state: String,
    nonce: String,
    redirect_uri: String,
}

fn pending(tx: &Transaction) -> Result<Option<Pending>, ClientError> {
    Ok(tx
        .query_row(
            "SELECT verifier, state, nonce, redirect_uri FROM sign_in",
            [],
            |r| {
                Ok(Pending {
                    verifier: r.get(0)?,
                    state: r.get(1)?,
                    nonce: r.get(2)?,
                    redirect_uri: r.get(3)?,
                })
            },
        )
        .optional()?)
}

fn signed_in(tx: &Transaction) -> Result<Option<Device>, ClientError> {
    let row: Option<(Option<String>, Option<String>)> = tx
        .query_row("SELECT account_id, device_id FROM account", [], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .optional()?;
    match row {
        Some((Some(account), Some(device))) => Ok(Some(Device::new(&account, &device)?)),
        _ => Ok(None),
    }
}

/// Kenni's `error` code when it is one (RFC 6749 § 4.1.2.1); anything else
/// is not repeated.
fn kenni_error(error: &str) -> String {
    if !error.is_empty()
        && error.len() <= 64
        && error.bytes().all(|b| b.is_ascii_lowercase() || b == b'_')
    {
        format!("Kenni answered {error}")
    } else {
        "Kenni answered with an error".into()
    }
}

impl<T: Transport> Client<T> {
    /// Starts a sign-in: fetches the configuration, keeps a new verifier,
    /// `state` and `nonce` in the store in place of any earlier sign-in, and
    /// returns the URL to open. It makes the device key if there is none.
    pub fn begin_sign_in(&mut self) -> Result<String, ClientError> {
        if self.signed_in()?.is_some() {
            return Err(ClientError::Invalid("already signed in"));
        }
        self.device_key()?;
        let config = Api::new(&self.transport, None).sign_in_config()?;
        let pending = Pending {
            verifier: random(32),
            state: random(16),
            nonce: random(16),
            redirect_uri: config.redirect_uri,
        };
        self.store.write(|tx| {
            tx.execute(
                "INSERT OR REPLACE INTO sign_in
                     (id, verifier, state, nonce, redirect_uri, created_at)
                 VALUES (1, ?1, ?2, ?3, ?4, ?5)",
                params![
                    pending.verifier,
                    pending.state,
                    pending.nonce,
                    pending.redirect_uri,
                    now()
                ],
            )
        })?;
        Ok(authorize_url(
            &config.authorization_endpoint,
            &config.client_id,
            &pending.redirect_uri,
            &config.scope,
            &pending,
        ))
    }

    /// Finishes the sign-in with the URL Kenni redirected to, and an invite
    /// token when the person has no account yet.
    ///
    /// A callback whose `state` is not the pending one is refused and the
    /// sign-in stays pending, so a forged callback cannot end it. Once the
    /// state matches, any answer from the server ends it; no answer keeps it,
    /// so the same call can be made again.
    pub fn complete_sign_in(
        &mut self,
        callback: &str,
        invite: Option<&str>,
        platform: Platform,
    ) -> Result<SignedIn, ClientError> {
        if invite.is_some_and(|t| !is_token(t)) {
            return Err(ClientError::Invalid("invite token"));
        }
        let (pending, device_key) = self.store.try_write(|tx| {
            let pending =
                pending(tx)?.ok_or_else(|| ClientError::SignIn("no sign-in is pending".into()))?;
            let key: Vec<u8> = tx.query_row("SELECT device_key FROM account", [], |r| r.get(0))?;
            Ok::<_, ClientError>((pending, key))
        })?;
        let query = callback_query(callback, &pending.redirect_uri)
            .ok_or_else(|| ClientError::SignIn("not the sign-in callback".into()))?;
        let param = |name: &str| {
            query
                .iter()
                .find(|(n, _)| n == name)
                .map(|(_, v)| v.as_str())
        };
        if param("state") != Some(pending.state.as_str()) {
            return Err(ClientError::SignIn(
                "the callback's state does not match".into(),
            ));
        }

        let answer = match (param("error"), param("code")) {
            (Some(error), _) => Err(ClientError::SignIn(kenni_error(error))),
            (None, None) | (None, Some("")) => {
                Err(ClientError::SignIn("the callback has no code".into()))
            }
            (None, Some(code)) => Api::new(&self.transport, None)
                .register_device(&Registration {
                    code,
                    verifier: &pending.verifier,
                    redirect_uri: &pending.redirect_uri,
                    nonce: &pending.nonce,
                    platform,
                    device_key: &device_key,
                    invite,
                })
                .map_err(ClientError::from),
        };
        let registered = match answer {
            Ok(registered) => Device::new(&registered.account_id, &registered.device_id)
                .map(|device| (device, registered.token))
                .map_err(|_| ClientError::Protocol("registerDevice answered a bad id")),
            Err(error @ ClientError::Transport(ApiError::Unreachable(_))) => return Err(error),
            Err(error) => Err(error),
        };
        // Any answer ends the sign-in: Kenni's code is spent either way.
        self.store.try_write(|tx| {
            tx.execute("DELETE FROM sign_in", [])?;
            if let Ok((device, token)) = &registered {
                tx.execute(
                    "UPDATE account SET account_id = ?1, device_id = ?2, device_token = ?3",
                    params![device.account, device.device, token],
                )?;
            }
            Ok::<_, ClientError>(())
        })?;
        let (device, token) = registered?;
        self.token = Some(token);
        Ok(device)
    }

    /// The account and device this store is signed in as.
    pub fn signed_in(&mut self) -> Result<Option<SignedIn>, ClientError> {
        self.store.try_write(signed_in)
    }

    /// The device token, for the WebSocket upgrade's `Authorization`.
    pub fn device_token(&self) -> Option<&str> {
        self.token.as_deref()
    }

    /// This account's name, mark and devices.
    pub fn me(&mut self) -> Result<Me, ClientError> {
        Ok(authed(&self.transport, &self.token)?.me()?)
    }

    /// Who made an invite, before sign-in; `None` for the operator's. A
    /// link that does not work is `Refused` with 404.
    pub fn resolve_invite(&mut self, token: &str) -> Result<Option<Inviter>, ClientError> {
        if !is_token(token) {
            return Err(ClientError::Invalid("invite token"));
        }
        Ok(Api::new(&self.transport, None).resolve_invite(token)?)
    }

    /// The 1:1 an invite link opens (0022): the conversation this account
    /// already has with the inviter alone, or a new one that adds them on
    /// the next `sync`. The operator's link and this account's own open
    /// none.
    pub fn open_invite(&mut self, token: &str) -> Result<String, ClientError> {
        let inviter = self.resolve_invite(token)?.ok_or(ClientError::Invalid(
            "the operator's invite opens no conversation",
        ))?;
        if !is_id(&inviter.account_id) {
            return Err(ClientError::Protocol("an inviter's account id"));
        }
        let found = self.store.try_write(|tx| {
            let (_, me) = this_device(tx)?;
            if inviter.account_id == me.account {
                return Err(ClientError::Invalid("this account's own invite"));
            }
            let mut pair = vec![me.account, inviter.account_id.clone()];
            pair.sort();
            let mut statement = tx.prepare(
                "SELECT group_id FROM conversations WHERE state != 'removed'
                 ORDER BY created_at DESC",
            )?;
            let groups: Vec<Vec<u8>> = statement
                .query_map([], |r| r.get(0))?
                .collect::<Result<_, _>>()?;
            for group in groups {
                if members(tx, &group)? == pair {
                    return Ok(Some(group));
                }
            }
            Ok(None)
        })?;
        match found {
            Some(group) => Ok(conversation_id(&group)),
            None => self.create_conversation(&[inviter.account_id]),
        }
    }

    /// This account's invite link as this device last made it.
    pub fn invite_link(&mut self) -> Result<Option<String>, ClientError> {
        self.store.try_write(|tx| {
            Ok(tx
                .query_row("SELECT invite_link FROM account", [], |r| r.get(0))
                .optional()?
                .flatten())
        })
    }

    /// A new invite link, which ends the one before.
    pub fn rotate_invite(&mut self) -> Result<String, ClientError> {
        let link = authed(&self.transport, &self.token)?.rotate_invite()?;
        self.store.write(|tx| {
            tx.execute("UPDATE account SET invite_link = ?1", [&link])
                .map(drop)
        })?;
        Ok(link)
    }

    /// Ends this account's invite link and leaves it with none.
    pub fn revoke_invite(&mut self) -> Result<(), ClientError> {
        authed(&self.transport, &self.token)?.revoke_invite()?;
        self.store.write(|tx| {
            tx.execute("UPDATE account SET invite_link = NULL", [])
                .map(drop)
        })?;
        Ok(())
    }

    /// Revokes one of this account's devices. Revoking this one signs it
    /// out: the store forgets everything, as it does when the token is
    /// already dead.
    pub fn revoke_device(&mut self, device: &str) -> Result<(), ClientError> {
        let this = self.signed_in()?.ok_or(ClientError::NotRegistered)?;
        let answer = authed(&self.transport, &self.token)?.revoke_device(device);
        let own = this.device == device;
        match answer {
            Ok(()) if own => self.forget(),
            Err(ApiError::Refused { status: 401, .. }) if own => self.forget(),
            answer => Ok(answer?),
        }
    }

    /// Deletes the account on the server, then everything in this store.
    pub fn delete_account(&mut self) -> Result<(), ClientError> {
        authed(&self.transport, &self.token)?.delete_account()?;
        self.forget()
    }

    /// Empties the store: the device key, the groups, history and the
    /// timeline, the outbox, the names fetched and the toggles. The next
    /// sign-in starts as a new device.
    fn forget(&mut self) -> Result<(), ClientError> {
        self.store.write(|tx| {
            tx.execute_batch(
                "DELETE FROM outbox;
                 DELETE FROM messages;
                 DELETE FROM conversations;
                 DELETE FROM profiles;
                 DELETE FROM settings;
                 DELETE FROM sign_in;
                 DELETE FROM account;
                 DELETE FROM kv;",
            )
        })?;
        self.token = None;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_link_prefixes_match_ids_json() {
        let ids: serde_json::Value =
            serde_json::from_str(include_str!("../../../identifiers/ids.json")).unwrap();
        let link = format!(
            "https://{}{}",
            ids["hosts"]["link"].as_str().unwrap(),
            ids["hosts"]["linkPathPrefix"].as_str().unwrap()
        );
        assert_eq!(LINK_PREFIX, link);
        let scheme = ids["store"]["urlScheme"].as_str().unwrap();
        assert_eq!(APP_PREFIX, format!("{scheme}://invite/"));
    }

    #[test]
    fn an_invite_token_comes_from_either_link() {
        let token = "aB3_-".repeat(8);
        let token = token.as_str();
        for link in [
            format!("{LINK_PREFIX}{token}"),
            format!("{LINK_PREFIX}{token}?utm=x"),
            format!("{APP_PREFIX}{token}"),
            format!("{APP_PREFIX}{token}#top"),
        ] {
            assert_eq!(invite_token(&link).as_deref(), Some(token), "{link}");
        }
        for link in [
            format!("https://example.com/l/{token}"),
            format!("{LINK_PREFIX}short"),
            format!("{LINK_PREFIX}{token}%00"),
            LINK_PREFIX.to_owned(),
        ] {
            assert_eq!(invite_token(&link), None, "{link}");
        }
    }

    #[test]
    fn the_challenge_is_rfc_7636s_example() {
        // RFC 7636 Appendix B.
        assert_eq!(
            challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
        assert_eq!(random(32).len(), 43);
        assert_eq!(random(16).len(), 22);
    }

    #[test]
    fn the_authorize_url_carries_every_parameter_encoded() {
        let pending = Pending {
            verifier: "v".repeat(43),
            state: "st".into(),
            nonce: "no".into(),
            redirect_uri: "is.samtak.spjall:/kenni".into(),
        };
        let url = authorize_url(
            "https://idp.test/oidc/auth",
            "@innskraning.is/samtak-spjall",
            &pending.redirect_uri,
            "openid national_id",
            &pending,
        );
        assert_eq!(
            url,
            format!(
                "https://idp.test/oidc/auth?response_type=code\
                 &client_id=%40innskraning.is%2Fsamtak-spjall\
                 &redirect_uri=is.samtak.spjall%3A%2Fkenni\
                 &scope=openid%20national_id&state=st&nonce=no\
                 &code_challenge={}&code_challenge_method=S256",
                challenge(&pending.verifier)
            )
        );
        assert!(
            authorize_url("https://idp.test/a?x=1", "c", "r", "s", &pending)
                .starts_with("https://idp.test/a?x=1&response_type=code")
        );
    }

    #[test]
    fn a_callback_is_read_only_for_its_redirect() {
        let redirect = "is.samtak.spjall:/kenni";
        assert_eq!(
            callback_query("is.samtak.spjall:/kenni?code=a%2Bb+c&state=s#x", redirect),
            Some(vec![
                ("code".into(), "a+b c".into()),
                ("state".into(), "s".into())
            ])
        );
        assert_eq!(
            callback_query("is.samtak.spjall:/other?code=a", redirect),
            None
        );
        assert_eq!(
            callback_query("is.samtak.spjall:/kennix?code=a", redirect),
            None
        );
        assert_eq!(
            callback_query("is.samtak.spjall:/kenni?code=%zz", redirect),
            None
        );
    }

    #[test]
    fn only_an_oauth_error_code_is_repeated() {
        assert_eq!(kenni_error("access_denied"), "Kenni answered access_denied");
        assert_eq!(kenni_error("<b>x</b>"), "Kenni answered with an error");
    }
}
