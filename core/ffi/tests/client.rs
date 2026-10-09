//! The client through the exported API only, as the apps call it: each
//! device's `Transport` is a foreign-trait object over the in-memory relay
//! the client's own tests use.

#[path = "../../client/tests/support/relay.rs"]
#[allow(dead_code)]
mod relay;

use std::path::Path;
use std::sync::{Arc, Mutex};

use relay::{Link, Relay};
use spjall_client::api::{self, Transport as _};
use spjall_core::client::{
    Content, ConversationState, CoreClient, Event, HttpMethod, HttpRequest, HttpResponse,
    ItemStatus, Notice, NoticeKind, Platform, Settings, SignedIn, Transport, TransportError,
    invite_token,
};
use spjall_core::{Body, CoreError};

/// What an app's transport is, here backed by the relay, recording every
/// request it was handed.
struct App {
    link: Link,
    seen: Mutex<Vec<HttpRequest>>,
    offline: Mutex<bool>,
}

impl App {
    fn api(request: HttpRequest) -> api::Request {
        api::Request {
            method: match request.method {
                HttpMethod::Get => api::Method::Get,
                HttpMethod::Post => api::Method::Post,
                HttpMethod::Delete => api::Method::Delete,
                HttpMethod::Put => api::Method::Put,
            },
            path: request.path,
            body: request.body,
            bearer: request.bearer,
            client: request.client,
        }
    }

    fn through(
        &self,
        request: HttpRequest,
        send: impl FnOnce(api::Request) -> Result<api::Response, api::Unreachable>,
    ) -> Result<HttpResponse, TransportError> {
        self.seen.lock().unwrap().push(request.clone());
        if *self.offline.lock().unwrap() {
            return Err(TransportError::Unreachable {
                detail: "offline".into(),
            });
        }
        let response =
            send(Self::api(request)).map_err(|e| TransportError::Unreachable { detail: e.0 })?;
        Ok(HttpResponse {
            status: response.status,
            body: response.body,
        })
    }
}

impl Transport for App {
    fn request(&self, request: HttpRequest) -> Result<HttpResponse, TransportError> {
        self.through(request, |request| self.link.request(request))
    }

    fn upload(&self, request: HttpRequest, path: String) -> Result<HttpResponse, TransportError> {
        self.through(request, |request| {
            self.link.upload(request, Path::new(&path))
        })
    }

    fn download(&self, request: HttpRequest, to: String) -> Result<HttpResponse, TransportError> {
        self.through(request, |request| {
            self.link.download(request, Path::new(&to))
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
        Platform::Android,
        "0.2.0".into(),
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
        vec![
            Event::Joined {
                conversation: conversation.clone()
            },
            Event::Profiles {
                accounts: vec!["a".into(), "b".into()]
            },
        ]
    );

    let id = a1
        .client
        .send(conversation.clone(), Body::Text { text: "hæ".into() })
        .unwrap();
    a1.client.sync().unwrap();
    let events = deliver(&relay, &b1, "b", "b1");
    let [Event::Message { message }, Event::Timeline { changed, .. }] = events.as_slice() else {
        panic!("{events:?}");
    };
    assert_eq!(changed, &vec![message.seq]);
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
        b1.client.history(conversation.clone(), None, 10).unwrap(),
        vec![message.clone()]
    );
    let listed = b1.client.conversations().unwrap();
    assert_eq!(listed[0].state, ConversationState::Active);
    assert_eq!(listed[0].unread, 1);
    assert_eq!(listed[0].members[0].account, "a");
    assert_eq!(listed[0].members[0].name.as_deref(), Some("Name of a"));
    assert_eq!(b1.client.people().unwrap(), listed[0].members);

    let items = b1.client.timeline(conversation.clone(), None, 10).unwrap();
    let item = items.last().unwrap();
    assert_eq!(item.seq, Some(message.seq));
    assert_eq!(item.status, ItemStatus::Sent);
    assert_eq!(
        item.content,
        Content::Text {
            text: "hæ".into(),
            reply_to: None
        }
    );
    assert_eq!(listed[0].last.as_ref(), Some(item));

    // What a push shows, once, and takes away when read (0025).
    let notices = b1.client.notices().unwrap();
    assert_eq!(
        notices.shown,
        vec![Notice {
            conversation: conversation.clone(),
            members: listed[0].members.clone(),
            seq: message.seq,
            sender: listed[0].members[0].clone(),
            kind: NoticeKind::Text,
            text: Some("hæ".into()),
            ts: message.envelope.ts,
        }]
    );
    assert!(b1.client.notices().unwrap().shown.is_empty());
    b1.client
        .mark_read(conversation.clone(), message.seq)
        .unwrap();
    assert_eq!(b1.client.conversations().unwrap()[0].unread, 0);
    assert_eq!(
        b1.client.notices().unwrap().cleared,
        vec![conversation.clone()]
    );
    b1.client.set_push_token("apns-b1".into(), true).unwrap();
    b1.client.sync().unwrap();
    assert_eq!(relay.push_token("b1"), Some(("apns-b1".into(), true)));

    let off = Settings {
        read_markers: false,
        typing: false,
    };
    b1.client.set_settings(off).unwrap();
    assert_eq!(b1.client.settings().unwrap(), off);
    assert_eq!(b1.client.typing(conversation.clone(), true).unwrap(), None);

    // Every request carried a path under /v1/, a body only on POST, the
    // build (0030), and the token on all but the two before sign-in.
    assert_eq!(a1.client.client_header().unwrap(), "android/0.2.0");
    for request in a1.app.seen.lock().unwrap().iter() {
        assert!(request.path.starts_with("/v1/"), "{request:?}");
        assert_eq!(
            request.client.as_deref(),
            Some("android/0.2.0"),
            "{request:?}"
        );
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
        Platform::Android,
        "0.2.0".into(),
    )
    .unwrap();
    let inviter = b1.resolve_invite(token.clone()).unwrap().unwrap();
    assert_eq!(inviter.account_id, "a");
    assert!(inviter.verified);
    let url = b1.begin_sign_in().unwrap();
    assert!(matches!(
        b1.complete_sign_in(
            "is.samtak.spjall:/kenni?code=x&state=forged".into(),
            None,
            Platform::Ios
        ),
        Err(CoreError::SignIn { .. })
    ));
    b1.complete_sign_in(relay::kenni(&url), Some(token.clone()), Platform::Ios)
        .unwrap();
    // The link opens a 1:1 with its maker, the same one each time.
    let one = b1.open_invite(token.clone()).unwrap();
    assert_eq!(b1.open_invite(token).unwrap(), one);
    assert_eq!(b1.conversations().unwrap()[0].id, one);
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
        CoreClient::open(String::new(), vec![7; 31], a1.app.clone(), Platform::Android, "0.2.0".into()),
        Err(CoreError::Store { detail }) if detail.contains("32 bytes")
    ));
    let dir = tempfile::tempdir().unwrap();
    assert!(matches!(
        CoreClient::open(
            dir.path().to_string_lossy().into_owned(),
            vec![7; 32],
            a1.app.clone(),
            Platform::Ios,
            "0.2".into(),
        ),
        Err(CoreError::Invalid { .. })
    ));
}

#[test]
fn files_and_blocks_cross_by_path_and_record() {
    let relay = Relay::new();
    let a1 = phone(&relay, "a", "a1");
    let b1 = phone(&relay, "b", "b1");
    let conversation = a1.client.create_conversation(vec!["b".into()]).unwrap();
    a1.client.sync().unwrap();
    deliver(&relay, &b1, "b", "b1");

    let files = tempfile::tempdir().unwrap();
    let path = files.path().join("skjal.pdf");
    std::fs::write(&path, b"%PDF-1.7 ekki raunverulegt").unwrap();
    a1.client
        .send_media(
            conversation.clone(),
            path.to_string_lossy().into_owned(),
            "application/pdf".into(),
            None,
            Some("skjal.pdf".into()),
        )
        .unwrap();
    assert!(
        a1.app
            .seen
            .lock()
            .unwrap()
            .iter()
            .any(|r| r.method == HttpMethod::Put && r.path.contains("/media/"))
    );
    a1.client.sync().unwrap();
    deliver(&relay, &b1, "b", "b1");
    let item = b1
        .client
        .timeline(conversation.clone(), None, 10)
        .unwrap()
        .pop()
        .unwrap();
    assert!(matches!(&item.content,
        Content::Media { mime, name, .. }
            if mime == "application/pdf" && name.as_deref() == Some("skjal.pdf")));
    let opened = b1
        .client
        .media(conversation.clone(), item.seq.unwrap())
        .unwrap();
    assert!(opened.ends_with(".pdf"));
    assert_eq!(
        std::fs::read(&opened).unwrap(),
        b"%PDF-1.7 ekki raunverulegt"
    );

    let big = files.path().join("big.bin");
    std::fs::File::create(&big)
        .unwrap()
        .set_len(spjall_client::MAX_SIZE + 1)
        .unwrap();
    assert!(matches!(
        a1.client.send_media(
            conversation.clone(),
            big.to_string_lossy().into_owned(),
            "application/zip".into(),
            None,
            None
        ),
        Err(CoreError::TooLarge)
    ));
    relay.tamper_media();
    std::fs::remove_file(&opened).unwrap();
    assert!(matches!(
        b1.client.media(conversation.clone(), item.seq.unwrap()),
        Err(CoreError::Tampered)
    ));

    let outcome = a1.client.block("b".into()).unwrap();
    assert!(outcome.events.iter().any(
        |e| matches!(e, Event::Membership { removed, .. } if removed == &vec!["b".to_owned()])
    ));
    assert_eq!(a1.client.blocked().unwrap()[0].account, "b");
    a1.client.unblock("b".into()).unwrap();
    assert!(a1.client.blocked().unwrap().is_empty());
    assert!(a1.client.expire().unwrap().events.is_empty());
}
