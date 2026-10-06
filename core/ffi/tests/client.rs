//! The client through the exported API only, as the apps call it: each
//! device's `Transport` is a foreign-trait object over the in-memory relay
//! the client's own tests use.

#[path = "../../client/tests/support/relay.rs"]
#[allow(dead_code)]
mod relay;

use std::sync::{Arc, Mutex};

use relay::{Link, Relay};
use spjall_client::api::{self, Transport as _};
use spjall_core::client::{
    ConversationState, CoreClient, Event, HttpMethod, HttpRequest, HttpResponse, Platform,
    SignedIn, Transport, TransportError, invite_token,
};
use spjall_core::{Body, CoreError};

/// What an app's transport is, here backed by the relay, recording every
/// request it was handed.
struct App {
    link: Link,
    seen: Mutex<Vec<HttpRequest>>,
    offline: Mutex<bool>,
}

impl Transport for App {
    fn request(&self, request: HttpRequest) -> Result<HttpResponse, TransportError> {
        self.seen.lock().unwrap().push(request.clone());
        if *self.offline.lock().unwrap() {
            return Err(TransportError::Unreachable {
                detail: "offline".into(),
            });
        }
        let response = self
            .link
            .request(api::Request {
                method: match request.method {
                    HttpMethod::Get => api::Method::Get,
                    HttpMethod::Post => api::Method::Post,
                    HttpMethod::Delete => api::Method::Delete,
                },
                path: request.path,
                body: request.body,
                bearer: request.bearer,
            })
            .map_err(|e| TransportError::Unreachable { detail: e.0 })?;
        Ok(HttpResponse {
            status: response.status,
            body: response.body,
        })
    }
}

struct Phone {
    app: Arc<App>,
    client: Arc<CoreClient>,
    _dir: tempfile::TempDir,
}

fn phone(relay: &Arc<Relay>, account: &str, device: &str) -> Phone {
    let dir = tempfile::tempdir().unwrap();
    let app = Arc::new(App {
        link: relay.link(account, device),
        seen: Mutex::new(Vec::new()),
        offline: Mutex::new(false),
    });
    let client = CoreClient::open(
        dir.path().to_string_lossy().into_owned(),
        vec![7; 32],
        app.clone(),
    )
    .unwrap();
    assert_eq!(client.device_key().unwrap().len(), 32);
    let url = client.begin_sign_in().unwrap();
    let signed_in = client
        .complete_sign_in(relay::kenni(&url), None, Platform::Android)
        .unwrap();
    assert_eq!(
        signed_in,
        SignedIn {
            account_id: account.into(),
            device_id: device.into()
        }
    );
    assert_eq!(client.stock_key_packages(2).unwrap(), 2);
    Phone {
        app,
        client,
        _dir: dir,
    }
}

/// Hands every frame waiting on the device's socket to its client.
fn deliver(relay: &Relay, phone: &Phone, account: &str, device: &str) -> Vec<Event> {
    let mut events = Vec::new();
    for frame in relay.frames(device) {
        let outcome = phone.client.on_frame(frame).unwrap();
        events.extend(outcome.events);
        for frame in outcome.frames {
            relay.socket(account, &frame);
        }
    }
    events
}

#[test]
fn two_clients_talk_through_the_exported_api() {
    let relay = Relay::new();
    let a1 = phone(&relay, "a", "a1");
    let b1 = phone(&relay, "b", "b1");

    let conversation = a1.client.create_conversation(vec!["b".into()]).unwrap();
    a1.client.sync().unwrap();
    assert_eq!(
        deliver(&relay, &b1, "b", "b1"),
        vec![Event::Joined {
            conversation: conversation.clone()
        }]
    );

    let id = a1
        .client
        .send(conversation.clone(), Body::Text { text: "hæ".into() })
        .unwrap();
    a1.client.sync().unwrap();
    let events = deliver(&relay, &b1, "b", "b1");
    let [Event::Message { message }] = events.as_slice() else {
        panic!("{events:?}");
    };
    assert_eq!(message.envelope.id, id);
    assert_eq!(message.envelope.body, Body::Text { text: "hæ".into() });
    assert_eq!(
        (
            message.sender_account.as_str(),
            message.sender_device.as_str()
        ),
        ("a", "a1")
    );
    assert!(!message.own);
    assert_eq!(
        b1.client.history(conversation, None, 10).unwrap(),
        vec![message.clone()]
    );
    assert_eq!(
        b1.client.conversations().unwrap()[0].state,
        ConversationState::Active
    );

    // Every request carried a path under /v1/, a body only on POST, and
    // the token on all but the two before sign-in.
    for request in a1.app.seen.lock().unwrap().iter() {
        assert!(request.path.starts_with("/v1/"), "{request:?}");
        assert_eq!(request.body.is_some(), request.method == HttpMethod::Post);
        let before = request.path == "/v1/sign-in" || request.path == "/v1/devices";
        assert_eq!(request.bearer.is_none(), before, "{request:?}");
    }
}

#[test]
fn an_account_is_run_through_the_exported_api() {
    let relay = Relay::new();
    let a1 = phone(&relay, "a", "a1");
    assert_eq!(
        a1.client.device_token().unwrap().as_deref(),
        Some("token-a1")
    );
    let me = a1.client.me().unwrap();
    assert_eq!(me.account_id, "a");
    assert_eq!(me.devices[0].platform, Platform::Android);
    assert!(me.devices[0].current);

    let link = a1.client.rotate_invite().unwrap();
    assert_eq!(a1.client.invite_link().unwrap(), Some(link.clone()));
    let token = invite_token(link).unwrap();
    assert_eq!(invite_token("https://example.com/".into()), None);

    // A new device sees the inviter, then signs in with the token. A
    // request's debug form, as a log would show it, has no body or token.
    let dir = tempfile::tempdir().unwrap();
    let app = Arc::new(App {
        link: relay.link("b", "b1"),
        seen: Mutex::new(Vec::new()),
        offline: Mutex::new(false),
    });
    let b1 = CoreClient::open(
        dir.path().to_string_lossy().into_owned(),
        vec![7; 32],
        app.clone(),
    )
    .unwrap();
    assert!(b1.resolve_invite(token.clone()).unwrap().unwrap().verified);
    let url = b1.begin_sign_in().unwrap();
    assert!(matches!(
        b1.complete_sign_in(
            "is.samtak.spjall:/kenni?code=x&state=forged".into(),
            None,
            Platform::Ios
        ),
        Err(CoreError::SignIn { .. })
    ));
    b1.complete_sign_in(relay::kenni(&url), Some(token), Platform::Ios)
        .unwrap();
    for request in app.seen.lock().unwrap().iter() {
        let shown = format!("{request:?}");
        assert!(
            !shown.contains("codeVerifier") && !shown.contains("token-"),
            "{shown}"
        );
    }

    b1.delete_account().unwrap();
    assert_eq!(b1.signed_in().unwrap(), None);
    assert!(matches!(b1.me(), Err(CoreError::NotRegistered)));
}

#[test]
fn errors_cross_as_records() {
    let relay = Relay::new();
    let a1 = phone(&relay, "a", "a1");

    *a1.app.offline.lock().unwrap() = true;
    assert!(matches!(
        a1.client.stock_key_packages(5),
        Err(CoreError::Unreachable { detail }) if detail == "offline"
    ));
    *a1.app.offline.lock().unwrap() = false;

    assert!(matches!(
        a1.client
            .send("nope".into(), Body::Text { text: "x".into() }),
        Err(CoreError::UnknownConversation)
    ));
    let conversation = a1.client.create_conversation(vec![]).unwrap();
    assert!(matches!(
        a1.client.send(conversation, Body::Typing { active: true }),
        Err(CoreError::Invalid { .. })
    ));
    assert!(matches!(
        CoreClient::open(String::new(), vec![7; 31], a1.app.clone()),
        Err(CoreError::Store { detail }) if detail.contains("32 bytes")
    ));
}
