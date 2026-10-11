//! Signing in with Google or Kenni, and the calls about the account
//! (decisions 0019 and 0033).
//!
//! `begin_sign_in` makes the PKCE verifier, the `state` and the `nonce`,
//! keeps them in the store and returns the authorize URL for the app to open
//! in Custom Tabs or `ASWebAuthenticationSession`. `complete_sign_in` takes
//! the URL the provider redirected to, checks its `state`, and registers
//! this device with the code; the Worker redeems the code itself. The
//! verifier leaves the device only in that one request. `begin_link` and
//! `complete_link` do the same for an account already signed in, to add
//! Kenni's mark to it (or Google to a Kenni account).

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use sha2::{Digest as _, Sha256};
use spjall_mls::group::{Device, Group};
use spjall_mls::storage::Provider as Mls;
use spjall_store::rusqlite::{self, OptionalExtension, Transaction, params};

use crate::api::conversation_id;
use crate::api::{
    Api, ApiError, Authorization, Inviter, Me, Platform, Provider, Registration, Transport,
};
use crate::block::is_blocked;
use crate::members::members;
use crate::{Client, ClientError, authed, enqueue, is_id, now, this_device};

/// The link host and the app's scheme, as `hosts.link`,
/// `hosts.linkPathPrefix` and `store.urlScheme` in `identifiers/ids.json`
/// name them; a test holds them equal.
const LINK_PREFIX: &str = "https://spjall.samtak.is/l/";
const APP_PREFIX: &str = "is.samtak.spjall://invite/";

/// Where the link host sends Google's callback on to (0033): Google takes
/// only an https redirect for a web client, so `getSignInConfig` names the
/// link host's page and the app is opened here, at `store.urlScheme`.
const GOOGLE_CALLBACK: &str = "is.samtak.spjall:/google";

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
pub(crate) fn encode(text: &str) -> String {
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

/// What a pending sign-in is for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Purpose {
    /// Registering this device.
    SignIn,
    /// Linking the identity to the account this device is signed in as.
    Link,
}

impl Purpose {
    fn name(self) -> &'static str {
        match self {
            Self::SignIn => "sign_in",
            Self::Link => "link",
        }
    }
}

/// The sign-in waiting for its callback.
struct Pending {
    provider: Provider,
    purpose: Purpose,
    verifier: String,
    state: String,
    nonce: String,
    redirect_uri: String,
}

impl Pending {
    /// The URL the app is opened at: Kenni redirects to the app itself,
    /// Google to the link host, which passes the query on.
    fn callback(&self) -> &str {
        match self.provider {
            Provider::Kenni => &self.redirect_uri,
            Provider::Google => GOOGLE_CALLBACK,
        }
    }

    fn authorization<'a>(&'a self, code: &'a str) -> Authorization<'a> {
        Authorization {
            provider: self.provider,
            code,
            verifier: &self.verifier,
            redirect_uri: &self.redirect_uri,
            nonce: &self.nonce,
        }
    }
}

fn pending(tx: &Transaction) -> Result<Option<Pending>, ClientError> {
    let row = tx
        .query_row(
            "SELECT provider, purpose, verifier, state, nonce, redirect_uri FROM sign_in",
            [],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    Pending {
                        provider: Provider::Kenni,
                        purpose: Purpose::SignIn,
                        verifier: r.get(2)?,
                        state: r.get(3)?,
                        nonce: r.get(4)?,
                        redirect_uri: r.get(5)?,
                    },
                ))
            },
        )
        .optional()?;
    Ok(row.map(|(provider, purpose, pending)| Pending {
        // The store's CHECKs allow only these.
        provider: if provider == "google" {
            Provider::Google
        } else {
            Provider::Kenni
        },
        purpose: if purpose == "link" {
            Purpose::Link
        } else {
            Purpose::SignIn
        },
        ..pending
    }))
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

/// The provider's `error` code when it is one (RFC 6749 § 4.1.2.1);
/// anything else is not repeated.
fn provider_error(provider: Provider, error: &str) -> String {
    let who = match provider {
        Provider::Google => "Google",
        Provider::Kenni => "Kenni",
    };
    if !error.is_empty()
        && error.len() <= 64
        && error.bytes().all(|b| b.is_ascii_lowercase() || b == b'_')
    {
        format!("{who} answered {error}")
    } else {
        format!("{who} answered with an error")
    }
}

impl<T: Transport> Client<T> {
    /// Starts a sign-in with `provider`: fetches its configuration, keeps a
    /// new verifier, `state` and `nonce` in the store in place of any
    /// earlier sign-in, and returns the URL to open. It makes the device key
    /// if there is none.
    pub fn begin_sign_in(&mut self, provider: Provider) -> Result<String, ClientError> {
        if self.signed_in()?.is_some() {
            return Err(ClientError::Invalid("already signed in"));
        }
        self.device_key()?;
        self.begin(provider, Purpose::SignIn)
    }

    /// Starts linking `provider` to the account this device is signed in
    /// as (0033); Kenni's adds the mark and the registry's name. The URL is
    /// opened as a sign-in's is, and its callback goes to `complete_link`.
    pub fn begin_link(&mut self, provider: Provider) -> Result<String, ClientError> {
        if self.signed_in()?.is_none() {
            return Err(ClientError::NotRegistered);
        }
        self.begin(provider, Purpose::Link)
    }

    fn begin(&mut self, provider: Provider, purpose: Purpose) -> Result<String, ClientError> {
        let config = Api::new(&self.transport, None)
            .client(self.client.as_deref())
            .sign_in_config(provider)?;
        let pending = Pending {
            provider,
            purpose,
            verifier: random(32),
            state: random(16),
            nonce: random(16),
            redirect_uri: config.redirect_uri,
        };
        self.store.write(|tx| {
            tx.execute(
                "INSERT OR REPLACE INTO sign_in
                     (id, verifier, state, nonce, redirect_uri, created_at, provider, purpose)
                 VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    pending.verifier,
                    pending.state,
                    pending.nonce,
                    pending.redirect_uri,
                    now(),
                    provider.name(),
                    purpose.name(),
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

    /// The pending sign-in a callback answers, and its code or the
    /// provider's refusal.
    ///
    /// A callback for no pending sign-in of this purpose, or whose `state`
    /// is not the pending one, is refused and the sign-in stays pending, so
    /// a forged callback cannot end it. Past that the inner result ends it.
    fn callback(
        &mut self,
        callback: &str,
        purpose: Purpose,
    ) -> Result<(Pending, Result<String, ClientError>), ClientError> {
        let pending = self
            .store
            .try_write(pending)?
            .filter(|p| p.purpose == purpose)
            .ok_or_else(|| ClientError::SignIn("no sign-in is pending".into()))?;
        let query = callback_query(callback, pending.callback())
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
        let code = match (param("error"), param("code")) {
            (Some(error), _) => Err(ClientError::SignIn(provider_error(pending.provider, error))),
            (None, None) | (None, Some("")) => {
                Err(ClientError::SignIn("the callback has no code".into()))
            }
            (None, Some(code)) => Ok(code.to_owned()),
        };
        Ok((pending, code))
    }

    /// Finishes the sign-in with the URL the provider redirected to, and
    /// the invite token that brought the person, if one did.
    ///
    /// Once the callback's state matches, any answer from the server ends
    /// the sign-in; no answer keeps it, so the same call can be made again.
    pub fn complete_sign_in(
        &mut self,
        callback: &str,
        invite: Option<&str>,
        platform: Platform,
    ) -> Result<SignedIn, ClientError> {
        if invite.is_some_and(|t| !is_token(t)) {
            return Err(ClientError::Invalid("invite token"));
        }
        let (pending, code) = self.callback(callback, Purpose::SignIn)?;
        let device_key: Vec<u8> = self.store.try_write(|tx| {
            tx.query_row("SELECT device_key FROM account", [], |r| r.get(0))
                .map_err(ClientError::from)
        })?;
        let answer = code.and_then(|code| {
            Api::new(&self.transport, None)
                .client(self.client.as_deref())
                .register_device(&Registration {
                    authorization: pending.authorization(&code),
                    platform,
                    device_key: &device_key,
                    invite,
                })
                .map_err(ClientError::from)
        });
        let registered = match answer {
            Ok(registered) => Device::new(&registered.account_id, &registered.device_id)
                .map(|device| (device, registered.token))
                .map_err(|_| ClientError::Protocol("registerDevice answered a bad id")),
            Err(error @ ClientError::Transport(ApiError::Unreachable(_))) => return Err(error),
            Err(error) => Err(error),
        };
        // Any answer ends the sign-in: the provider's code is spent either way.
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

    /// Finishes a link with the URL the provider redirected to. Another
    /// account holding the identity is `Refused` with 409 `identity_taken`,
    /// unless Kenni joined this one into it (0035): this device then belongs
    /// to that account, keeps its key, id and token, and forgets the
    /// conversations, names and blocks of the account that is gone, as
    /// `Linked::moved` says. It ends the link as `complete_sign_in` ends a
    /// sign-in.
    pub fn complete_link(&mut self, callback: &str) -> Result<Linked, ClientError> {
        let (pending, code) = self.callback(callback, Purpose::Link)?;
        let this = self.signed_in()?.ok_or(ClientError::NotRegistered)?;
        let answer = code.and_then(|code| {
            Ok(authed(&self.transport, &self.token, &self.client)?
                .link_identity(&pending.authorization(&code))?)
        });
        if let Err(ClientError::Transport(ApiError::Unreachable(_))) = &answer {
            return Err(answer.unwrap_err());
        }
        let into = match answer {
            Ok(Some(account)) if account != this.account => {
                if !is_id(&account) {
                    self.store
                        .write(|tx| tx.execute("DELETE FROM sign_in", []).map(drop))?;
                    return Err(ClientError::Protocol("linkIdentity answered a bad id"));
                }
                Some(account)
            }
            Ok(_) => None,
            Err(error) => {
                self.store
                    .write(|tx| tx.execute("DELETE FROM sign_in", []).map(drop))?;
                return Err(error);
            }
        };
        self.store.try_write(|tx| {
            tx.execute("DELETE FROM sign_in", [])?;
            if let Some(into) = &into {
                moved(tx, into)?;
            }
            Ok::<_, ClientError>(())
        })?;
        Ok(Linked {
            moved: into.is_some(),
        })
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
        Ok(authed(&self.transport, &self.token, &self.client)?.me()?)
    }

    /// Who made an invite, before sign-in; `None` for the operator's. A
    /// link that does not work is `Refused` with 404.
    pub fn resolve_invite(&mut self, token: &str) -> Result<Option<Inviter>, ClientError> {
        if !is_token(token) {
            return Err(ClientError::Invalid("invite token"));
        }
        Ok(Api::new(&self.transport, None)
            .client(self.client.as_deref())
            .resolve_invite(token)?)
    }

    /// The 1:1 an invite link opens (0022): as `open_direct` opens it with
    /// the inviter. The operator's link and this account's own open none.
    pub fn open_invite(&mut self, token: &str) -> Result<String, ClientError> {
        let inviter = self.resolve_invite(token)?.ok_or(ClientError::Invalid(
            "the operator's invite opens no conversation",
        ))?;
        if !is_id(&inviter.account_id) {
            return Err(ClientError::Protocol("an inviter's account id"));
        }
        self.open_direct(&inviter.account_id)
    }

    /// The 1:1 with `account`, as any signed-in account may open it without
    /// a link (0034, 0036): the conversation this account already has with it
    /// alone, or a new one that adds it on the next `sync`. Not with this
    /// account itself, nor with one it blocked.
    pub fn open_direct(&mut self, account: &str) -> Result<String, ClientError> {
        if !is_id(account) {
            return Err(ClientError::Invalid("account id"));
        }
        let found = self.store.try_write(|tx| {
            let (_, me) = this_device(tx)?;
            if account == me.account {
                return Err(ClientError::Invalid("a 1:1 with this account itself"));
            }
            if is_blocked(tx, account)? {
                return Err(ClientError::Invalid(
                    "a 1:1 with an account this one blocked",
                ));
            }
            let mut pair = vec![me.account, account.to_owned()];
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
            None => self.create_conversation(&[account.to_owned()]),
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
        let link = authed(&self.transport, &self.token, &self.client)?.rotate_invite()?;
        self.store.write(|tx| {
            tx.execute("UPDATE account SET invite_link = ?1", [&link])
                .map(drop)
        })?;
        Ok(link)
    }

    /// Ends this account's invite link and leaves it with none.
    pub fn revoke_invite(&mut self) -> Result<(), ClientError> {
        authed(&self.transport, &self.token, &self.client)?.revoke_invite()?;
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
        let answer = authed(&self.transport, &self.token, &self.client)?.revoke_device(device);
        let own = this.device == device;
        match answer {
            Ok(()) if own => self.forget(),
            Err(ApiError::Refused { status: 401, .. }) if own => self.forget(),
            // Its leaf goes from every group on the next sync, so it reads
            // nothing sent after (0028); one it was never in drops the row.
            Ok(()) => {
                let gone = Device::new(&this.account, device)?.identity();
                self.store.try_write(|tx| {
                    let groups: Vec<Vec<u8>> = tx
                        .prepare("SELECT group_id FROM conversations WHERE state = 'active'")?
                        .query_map([], |r| r.get(0))?
                        .collect::<rusqlite::Result<_>>()?;
                    for group in groups {
                        enqueue(tx, &group, "remove_devices", gone.as_bytes())?;
                    }
                    Ok::<_, ClientError>(())
                })
            }
            answer => Ok(answer?),
        }
    }

    /// Deletes the account on the server, then everything in this store.
    pub fn delete_account(&mut self) -> Result<(), ClientError> {
        authed(&self.transport, &self.token, &self.client)?.delete_account()?;
        self.forget()
    }

    /// Empties the store: the device key, the groups, history and the
    /// timeline, the outbox, the names fetched, the toggles, the blocks, the
    /// mutes and the media files. The next sign-in starts as a new device,
    /// and the push token, which belongs to the install, is sent for it.
    fn forget(&mut self) -> Result<(), ClientError> {
        self.store.write(|tx| {
            tx.execute_batch(
                "DELETE FROM outbox;
                 DELETE FROM messages;
                 DELETE FROM conversations;
                 DELETE FROM profiles;
                 DELETE FROM settings;
                 DELETE FROM blocks;
                 DELETE FROM mutes;
                 DELETE FROM sign_in;
                 DELETE FROM account;
                 DELETE FROM kv;
                 UPDATE push SET sent = 0;",
            )
        })?;
        self.token = None;
        match std::fs::remove_dir_all(&self.media) {
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
                Err(crate::MediaError::from(error).into())
            }
            _ => Ok(()),
        }
    }
}

/// What a link did (0035).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Linked {
    /// Kenni joined this account into the one holding the kennitala, and
    /// this device now belongs to it: the app starts its session again.
    pub moved: bool,
}

/// This device now belongs to `into` (0035). The groups, history, outbox,
/// names, blocks and mutes were the account's that is gone; the device key,
/// the toggles and the push token belong to the install and stay. The groups'
/// MLS state goes with them. The other account's conversations take this
/// device in by external commit (0021) on the next sync.
fn moved(tx: &Transaction, into: &str) -> Result<(), ClientError> {
    let provider = Mls::new(tx);
    let groups: Vec<Vec<u8>> = tx
        .prepare("SELECT group_id FROM conversations")?
        .query_map([], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    for group in groups {
        // A `new` group has no MLS state yet.
        if let Ok(mls) = Group::load(&provider, &group) {
            mls.delete(&provider)?;
        }
    }
    tx.execute_batch(
        "DELETE FROM outbox;
         DELETE FROM messages;
         DELETE FROM conversations;
         DELETE FROM profiles;
         DELETE FROM blocks;
         DELETE FROM mutes;",
    )?;
    // The server deleted this device's KeyPackages, whose credentials named
    // the account that is gone: the next sync stocks new ones.
    tx.execute(
        "UPDATE account SET account_id = ?1, key_packages_stocked_at = NULL",
        [into],
    )?;
    Ok(())
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
        assert_eq!(GOOGLE_CALLBACK, format!("{scheme}:/google"));
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
            provider: Provider::Kenni,
            purpose: Purpose::SignIn,
            verifier: "v".repeat(43),
            state: "st".into(),
            nonce: "no".into(),
            redirect_uri: "is.samtak.spjall:/kenni".into(),
        };
        let url = authorize_url(
            "https://idp.test/oidc/auth",
            "@innskraning.is/spjall",
            &pending.redirect_uri,
            "openid national_id",
            &pending,
        );
        assert_eq!(
            url,
            format!(
                "https://idp.test/oidc/auth?response_type=code\
                 &client_id=%40innskraning.is%2Fspjall\
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
        assert_eq!(
            provider_error(Provider::Kenni, "access_denied"),
            "Kenni answered access_denied"
        );
        assert_eq!(
            provider_error(Provider::Google, "<b>x</b>"),
            "Google answered with an error"
        );
    }
}
