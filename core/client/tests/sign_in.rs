//! Sign-in and the account calls (0019) against the in-memory relay: PKCE,
//! `state` and the pending sign-in in the store, the token on each request,
//! and what this device forgets when it ends.

#[path = "support/relay.rs"]
#[allow(dead_code)]
mod relay;

use std::sync::Arc;

use relay::{GOOGLE_CALLBACK, GOOGLE_REDIRECT, Link, REDIRECT, Relay};
use spjall_client::api::{ApiError, Method, Platform, Provider};
use spjall_client::{Client, ClientError, Settings};
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
        let url = self.client.begin_sign_in(Provider::Kenni).unwrap();
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

    let url = a1.client.begin_sign_in(Provider::Kenni).unwrap();
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
        a1.client.begin_sign_in(Provider::Kenni),
        Err(ClientError::Invalid(_))
    ));
}

#[test]
fn the_verifier_is_sent_only_to_register_the_device() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let url = a1.client.begin_sign_in(Provider::Kenni).unwrap();
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
    let url = a1.client.begin_sign_in(Provider::Kenni).unwrap();
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
    let url = a1.client.begin_sign_in(Provider::Kenni).unwrap();
    a1.reopen();
    a1.complete(&relay::kenni(&url)).unwrap();
    assert_eq!(a1.client.device_token(), Some("token-a1"));
}

#[test]
fn a_new_sign_in_replaces_the_pending_one() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let first = a1.client.begin_sign_in(Provider::Kenni).unwrap();
    let second = a1.client.begin_sign_in(Provider::Kenni).unwrap();
    assert_ne!(state_of(&first), state_of(&second));
    assert!(sign_in_error(a1.complete(&relay::kenni(&first))).contains("state"));
    a1.complete(&relay::kenni(&second)).unwrap();
}

#[test]
fn no_answer_keeps_the_sign_in_and_any_answer_ends_it() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let url = a1.client.begin_sign_in(Provider::Kenni).unwrap();
    relay.fail_next("a1", 1);
    assert!(matches!(
        a1.complete(&relay::kenni(&url)),
        Err(ClientError::Transport(ApiError::Unreachable(_)))
    ));
    a1.complete(&relay::kenni(&url)).unwrap();

    // Kenni said no.
    let mut b1 = Phone::new(&relay, "b", "b1");
    let url = b1.client.begin_sign_in(Provider::Kenni).unwrap();
    let denied = format!("{REDIRECT}?error=access_denied&state={}", state_of(&url));
    assert_eq!(
        sign_in_error(b1.complete(&denied)),
        "Kenni answered access_denied"
    );
    assert!(sign_in_error(b1.complete(&relay::kenni(&url))).contains("no sign-in"));

    // The Worker said no.
    let url = b1.client.begin_sign_in(Provider::Kenni).unwrap();
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
    let url = b1.client.begin_sign_in(Provider::Kenni).unwrap();
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
    let off = Settings {
        read_markers: false,
        typing: false,
    };
    a1.client.set_settings(off).unwrap();

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
    assert_eq!(a1.client.settings().unwrap(), Settings::default());

    a1.client.delete_account().unwrap();
    assert!(!relay.registered("a1"));
    assert_eq!(a1.client.signed_in().unwrap(), None);
    assert!(matches!(a1.client.me(), Err(ClientError::NotRegistered)));
}

#[test]
fn google_signs_in_through_the_link_host_and_the_app_scheme() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let url = a1.client.begin_sign_in(Provider::Google).unwrap();
    assert!(url.starts_with("https://accounts.test/o/oauth2/v2/auth?response_type=code&"));
    assert!(url.contains("scope=openid%20email%20profile"));
    // Google is sent to the link host's page, which hands the app its scheme.
    assert!(url.contains("redirect_uri=https%3A%2F%2Fspjall.samtak.is%2Foauth%2Fgoogle"));
    let asked = relay.requests("a1");
    assert_eq!(asked[0].path, "/v1/sign-in?provider=google");

    // A Kenni-shaped callback is not this sign-in's.
    let state = state_of(&url);
    let kenni = format!("{REDIRECT}?code=x&state={state}");
    assert!(sign_in_error(a1.complete(&kenni)).contains("callback"));

    let signed_in = a1.complete(&relay::google(&url)).unwrap();
    assert_eq!(signed_in.account, "a");
    let register = relay
        .requests("a1")
        .into_iter()
        .find(|r| r.path == "/v1/devices")
        .unwrap();
    let body: serde_json::Value = serde_json::from_str(register.body.as_deref().unwrap()).unwrap();
    assert_eq!(body["provider"], "google");
    assert_eq!(body["code"], format!("code-{state}"));
    assert_eq!(body["redirectUri"], GOOGLE_REDIRECT);
    assert!(body.get("kenniCode").is_none());
    // Google vouches for an email, not a name: no mark.
    assert!(!a1.client.me().unwrap().verified);
}

#[test]
fn google_saying_no_ends_the_sign_in() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let url = a1.client.begin_sign_in(Provider::Google).unwrap();
    let denied = format!(
        "{GOOGLE_CALLBACK}?error=access_denied&state={}",
        state_of(&url)
    );
    assert_eq!(
        sign_in_error(a1.complete(&denied)),
        "Google answered access_denied"
    );
    assert!(sign_in_error(a1.complete(&relay::google(&url))).contains("no sign-in"));
}

#[test]
fn kenni_is_linked_to_a_google_account_for_the_mark() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    // Not before sign-in.
    assert!(matches!(
        a1.client.begin_link(Provider::Kenni),
        Err(ClientError::NotRegistered)
    ));
    let url = a1.client.begin_sign_in(Provider::Google).unwrap();
    a1.complete(&relay::google(&url)).unwrap();
    // Nor a second sign-in while signed in.
    assert!(a1.client.begin_sign_in(Provider::Kenni).is_err());

    let url = a1.client.begin_link(Provider::Kenni).unwrap();
    assert!(url.starts_with("https://kenni.test/oidc/auth?"));
    // A link's callback does not finish a sign-in.
    assert!(sign_in_error(a1.complete(&relay::kenni(&url))).contains("no sign-in"));
    // No answer keeps the link pending.
    relay.fail_next("a1", 1);
    assert!(matches!(
        a1.client.complete_link(&relay::kenni(&url)),
        Err(ClientError::Transport(ApiError::Unreachable(_)))
    ));
    a1.reopen();
    a1.client.complete_link(&relay::kenni(&url)).unwrap();
    let link = relay
        .requests("a1")
        .into_iter()
        .rfind(|r| r.path == "/v1/me/identities")
        .unwrap();
    assert_eq!(link.method, Method::Post);
    assert!(link.bearer.is_some());
    let body: serde_json::Value = serde_json::from_str(link.body.as_deref().unwrap()).unwrap();
    assert_eq!(body["provider"], "kenni");
    assert_eq!(body["redirectUri"], REDIRECT);
    assert!(a1.client.me().unwrap().verified);
    // Done: the callback again finds nothing pending.
    assert!(sign_in_error(a1.client.complete_link(&relay::kenni(&url))).contains("no sign-in"));
}

#[test]
fn a_kennitala_on_another_account_ends_the_link() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let url = a1.client.begin_sign_in(Provider::Google).unwrap();
    a1.complete(&relay::google(&url)).unwrap();
    let url = a1.client.begin_link(Provider::Kenni).unwrap();
    let taken = format!("{REDIRECT}?code=taken-1&state={}", state_of(&url));
    assert!(matches!(
        a1.client.complete_link(&taken),
        Err(ClientError::Transport(ApiError::Refused { status: 409, ref code })) if code == "identity_taken"
    ));
    assert!(sign_in_error(a1.client.complete_link(&relay::kenni(&url))).contains("no sign-in"));
    assert!(!a1.client.me().unwrap().verified);
    // Still signed in.
    assert!(a1.client.signed_in().unwrap().is_some());
}
