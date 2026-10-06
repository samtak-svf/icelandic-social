//! Sign-in and the account calls (0019) against the in-memory relay: PKCE,
//! `state` and the pending sign-in in the store, the token on each request,
//! and what this device forgets when it ends.

#[path = "support/relay.rs"]
#[allow(dead_code)]
mod relay;

use std::sync::Arc;

use relay::{Link, REDIRECT, Relay};
use spjall_client::api::{ApiError, Method, Platform};
use spjall_client::{Client, ClientError};
use tempfile::TempDir;

const KEY: [u8; 32] = [7; 32];

struct Phone {
    relay: Arc<Relay>,
    account: String,
    device: String,
    dir: TempDir,
    client: Client<Link>,
}

impl Phone {
    fn new(relay: &Arc<Relay>, account: &str, device: &str) -> Self {
        let dir = tempfile::tempdir().unwrap();
        let client = Client::open(dir.path(), &KEY, relay.link(account, device)).unwrap();
        Self {
            relay: relay.clone(),
            account: account.into(),
            device: device.into(),
            dir,
            client,
        }
    }

    fn reopen(&mut self) {
        let link = self.relay.link(&self.account, &self.device);
        self.client = Client::open(self.dir.path(), &KEY, link).unwrap();
    }

    fn complete(&mut self, callback: &str) -> Result<spjall_client::SignedIn, ClientError> {
        self.client
            .complete_sign_in(callback, None, Platform::Android)
    }

    fn sign_in(&mut self) {
        let url = self.client.begin_sign_in().unwrap();
        self.complete(&relay::kenni(&url)).unwrap();
    }
}

fn state_of(url: &str) -> String {
    url.split(['?', '&'])
        .find_map(|p| p.strip_prefix("state="))
        .unwrap()
        .to_owned()
}

fn sign_in_error(result: Result<impl std::fmt::Debug, ClientError>) -> String {
    match result {
        Err(ClientError::SignIn(why)) => why,
        other => panic!("expected a sign-in error, got {other:?}"),
    }
}

#[test]
fn signing_in_registers_the_device_and_the_token_goes_on_each_request() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    assert_eq!(a1.client.signed_in().unwrap(), None);
    assert!(matches!(
        a1.client.stock_key_packages(1),
        Err(ClientError::NotRegistered)
    ));

    let url = a1.client.begin_sign_in().unwrap();
    assert!(url.starts_with("https://kenni.test/oidc/auth?response_type=code&"));
    assert!(url.contains("&code_challenge_method=S256"));
    let device = a1.complete(&relay::kenni(&url)).unwrap();
    assert_eq!(
        (device.account.as_str(), device.device.as_str()),
        ("a", "a1")
    );
    assert_eq!(a1.client.signed_in().unwrap(), Some(device));
    assert_eq!(a1.client.device_token(), Some("token-a1"));
    assert!(relay.registered("a1"));

    assert_eq!(a1.client.stock_key_packages(2).unwrap(), 2);
    let requests = relay.requests("a1");
    let (before, after) = requests.split_at(2);
    assert!(before.iter().all(|r| r.bearer.is_none()));
    assert!(
        after
            .iter()
            .all(|r| r.bearer.as_deref() == Some("token-a1"))
    );

    // Still signed in after a restart, and not signed in twice.
    a1.reopen();
    assert_eq!(a1.client.device_token(), Some("token-a1"));
    assert!(matches!(
        a1.client.begin_sign_in(),
        Err(ClientError::Invalid(_))
    ));
}

#[test]
fn the_verifier_is_sent_only_to_register_the_device() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let url = a1.client.begin_sign_in().unwrap();
    a1.complete(&relay::kenni(&url)).unwrap();
    a1.client.stock_key_packages(1).unwrap();
    a1.client.me().unwrap();

    let requests = relay.requests("a1");
    let register = requests
        .iter()
        .find(|r| r.method == Method::Post && r.path == "/v1/devices")
        .unwrap();
    let body: serde_json::Value = serde_json::from_str(register.body.as_deref().unwrap()).unwrap();
    let verifier = body["codeVerifier"].as_str().unwrap();
    assert_eq!(verifier.len(), 43);
    assert_eq!(body["redirectUri"], REDIRECT);
    assert_eq!(body["platform"], "android");
    assert_eq!(body["nonce"].as_str().unwrap().len(), 22);
    assert!(url.contains(&format!("nonce={}", body["nonce"].as_str().unwrap())));

    assert!(
        !url.contains(verifier),
        "the authorize URL holds only the challenge"
    );
    let elsewhere = requests
        .iter()
        .filter(|r| !std::ptr::eq(*r, register))
        .filter(|r| r.path.contains(verifier) || r.body.as_deref().unwrap_or("").contains(verifier))
        .count();
    assert_eq!(elsewhere, 0);
    // A request's debug form, which is what a log would show, holds
    // neither the verifier nor the token.
    for request in &requests {
        let shown = format!("{request:?}");
        assert!(
            !shown.contains(verifier) && !shown.contains("token-a1"),
            "{shown}"
        );
    }
}

#[test]
fn a_callback_with_another_state_is_refused_and_the_sign_in_waits_on() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let url = a1.client.begin_sign_in().unwrap();
    let state = state_of(&url);

    let forged = format!("{REDIRECT}?code=stolen&state=not-{state}");
    assert!(sign_in_error(a1.complete(&forged)).contains("state"));
    let unstated = format!("{REDIRECT}?code=stolen");
    assert!(sign_in_error(a1.complete(&unstated)).contains("state"));
    let elsewhere = format!("https://evil.test/kenni?code=stolen&state={state}");
    assert!(sign_in_error(a1.complete(&elsewhere)).contains("callback"));
    assert!(!relay.registered("a1"));

    a1.complete(&relay::kenni(&url)).unwrap();
    assert!(relay.registered("a1"));
}

#[test]
fn a_sign_in_survives_the_process_ending_while_the_browser_is_open() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let url = a1.client.begin_sign_in().unwrap();
    a1.reopen();
    a1.complete(&relay::kenni(&url)).unwrap();
    assert_eq!(a1.client.device_token(), Some("token-a1"));
}

#[test]
fn a_new_sign_in_replaces_the_pending_one() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let first = a1.client.begin_sign_in().unwrap();
    let second = a1.client.begin_sign_in().unwrap();
    assert_ne!(state_of(&first), state_of(&second));
    assert!(sign_in_error(a1.complete(&relay::kenni(&first))).contains("state"));
    a1.complete(&relay::kenni(&second)).unwrap();
}

#[test]
fn no_answer_keeps_the_sign_in_and_any_answer_ends_it() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let url = a1.client.begin_sign_in().unwrap();
    relay.fail_next("a1", 1);
    assert!(matches!(
        a1.complete(&relay::kenni(&url)),
        Err(ClientError::Transport(ApiError::Unreachable(_)))
    ));
    a1.complete(&relay::kenni(&url)).unwrap();

    // Kenni said no.
    let mut b1 = Phone::new(&relay, "b", "b1");
    let url = b1.client.begin_sign_in().unwrap();
    let denied = format!("{REDIRECT}?error=access_denied&state={}", state_of(&url));
    assert_eq!(
        sign_in_error(b1.complete(&denied)),
        "Kenni answered access_denied"
    );
    assert!(sign_in_error(b1.complete(&relay::kenni(&url))).contains("no sign-in"));

    // The Worker said no.
    let url = b1.client.begin_sign_in().unwrap();
    let refused = format!("{REDIRECT}?code=refused&state={}", state_of(&url));
    assert!(matches!(
        b1.complete(&refused),
        Err(ClientError::Transport(ApiError::Refused {
            status: 403,
            ..
        }))
    ));
    assert!(sign_in_error(b1.complete(&relay::kenni(&url))).contains("no sign-in"));
    assert!(!relay.registered("b1"));
}

#[test]
fn an_invite_is_made_resolved_used_and_revoked() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    a1.sign_in();
    assert_eq!(a1.client.invite_link().unwrap(), None);
    let link = a1.client.rotate_invite().unwrap();
    assert_eq!(
        a1.client.invite_link().unwrap().as_deref(),
        Some(link.as_str())
    );
    let token = spjall_client::invite_token(&link).unwrap();

    // Before signing in, b sees who invited them, then signs in with it.
    let mut b1 = Phone::new(&relay, "b", "b1");
    let inviter = b1.client.resolve_invite(&token).unwrap().unwrap();
    assert!(inviter.verified);
    assert!(matches!(
        b1.client
            .complete_sign_in("x", Some("not a token"), Platform::Ios),
        Err(ClientError::Invalid(_))
    ));
    let url = b1.client.begin_sign_in().unwrap();
    b1.client
        .complete_sign_in(&relay::kenni(&url), Some(&token), Platform::Ios)
        .unwrap();
    let register = relay
        .requests("b1")
        .into_iter()
        .find(|r| r.path == "/v1/devices")
        .unwrap();
    let body: serde_json::Value = serde_json::from_str(register.body.as_deref().unwrap()).unwrap();
    assert_eq!(
        (body["inviteToken"].as_str(), body["platform"].as_str()),
        (Some(token.as_str()), Some("ios"))
    );

    // Rotating ends the old link; revoking leaves none.
    let newer = a1.client.rotate_invite().unwrap();
    assert_ne!(newer, link);
    assert!(matches!(
        b1.client.resolve_invite(&token),
        Err(ClientError::Transport(ApiError::Refused {
            status: 404,
            ..
        }))
    ));
    a1.client.revoke_invite().unwrap();
    assert_eq!(a1.client.invite_link().unwrap(), None);
}

#[test]
fn revoking_another_device_leaves_this_one_signed_in() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut a2 = Phone::new(&relay, "a", "a2");
    a1.sign_in();
    a2.sign_in();
    let devices: Vec<(String, bool)> = a1
        .client
        .me()
        .unwrap()
        .devices
        .into_iter()
        .map(|d| (d.device_id, d.current))
        .collect();
    assert_eq!(devices, [("a1".into(), true), ("a2".into(), false)]);

    a1.client.revoke_device("a2").unwrap();
    assert!(!relay.registered("a2"));
    assert!(a1.client.signed_in().unwrap().is_some());
    assert!(matches!(
        a1.client.revoke_device("a2"),
        Err(ClientError::Transport(ApiError::Refused {
            status: 404,
            ..
        }))
    ));

    // a2's token is dead, so revoking itself only signs it out here.
    a2.client.revoke_device("a2").unwrap();
    assert_eq!(a2.client.signed_in().unwrap(), None);
}

#[test]
fn signing_out_or_deleting_the_account_forgets_everything_here() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    a1.sign_in();
    a1.client.stock_key_packages(1).unwrap();
    let key = a1.client.device_key().unwrap();
    a1.client.rotate_invite().unwrap();
    a1.client.create_conversation(&[]).unwrap();

    a1.client.revoke_device("a1").unwrap();
    assert!(!relay.registered("a1"));
    a1.reopen();
    assert_eq!(a1.client.signed_in().unwrap(), None);
    assert_eq!(a1.client.device_token(), None);
    assert_eq!(a1.client.invite_link().unwrap(), None);
    assert!(a1.client.conversations().unwrap().is_empty());
    // The next sign-in is a new device, with a new key.
    a1.sign_in();
    assert_ne!(a1.client.device_key().unwrap(), key);

    a1.client.delete_account().unwrap();
    assert!(!relay.registered("a1"));
    assert_eq!(a1.client.signed_in().unwrap(), None);
    assert!(matches!(a1.client.me(), Err(ClientError::NotRegistered)));
}
