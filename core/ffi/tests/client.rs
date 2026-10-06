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
    ConversationState, CoreClient, Event, HttpMethod, HttpRequest, HttpResponse, Transport,
    TransportError,
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
                },
                path: request.path,
                body: request.body,
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
    relay.register(account, device);
    client.registered(account.into(), device.into()).unwrap();
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

    // Every request carried a path under /v1/, and a body only on POST.
    for request in a1.app.seen.lock().unwrap().iter() {
        assert!(request.path.starts_with("/v1/"), "{request:?}");
        assert_eq!(request.body.is_some(), request.method == HttpMethod::Post);
    }
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
