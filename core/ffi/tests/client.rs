//! The client through the exported API only, as the apps call it: each
//! device's `Transport` is a foreign-trait object over the in-memory relay
//! the client's own tests use.

#[path = "../../client/tests/support/relay.rs"]
#[allow(dead_code)]
mod relay;

use std::path::Path;
use std::sync::{Arc, Condvar, Mutex, mpsc};
use std::time::Duration;

use relay::{Link, Relay};
use spjall_client::api::{self, Transport as _};
use spjall_core::client::{
    Content, ConversationState, CoreClient, Event, HttpMethod, HttpRequest, HttpResponse,
    ItemStatus, Notice, NoticeKind, Platform, Settings, SignInProvider, SignedIn, Transport,
    TransportError, invite_token,
};
use spjall_core::social::{
    Author, Card, CardCommunity, CardKind, CardRef, CommunityAudience, CommunityRole,
    LogTargetKind, ModerationAction, ModerationLogAction, ModerationState, ReactionCount,
    ReactionKind, ReportReason, ReportTarget, ReportTargetKind, SocialNotificationKind,
};
use spjall_core::{Body, CoreError};

/// What an app's transport is, here backed by the relay, recording every
/// request it was handed.
struct App {
    link: Link,
    seen: Mutex<Vec<HttpRequest>>,
    offline: Mutex<bool>,
    /// The next request panics, as a bug in the app's transport would.
    panics: Mutex<bool>,
    /// While set, a request waits, as one on a slow network does, and says
    /// so on the channel `hold` returned.
    held: Mutex<Option<mpsc::Sender<()>>>,
    released: Condvar,
    /// While not empty, a request is answered with the first of these, as
    /// the Worker answers the social calls the relay does not have.
    canned: Mutex<std::collections::VecDeque<HttpResponse>>,
}

impl App {
    fn api(request: HttpRequest) -> api::Request {
        api::Request {
            method: match request.method {
                HttpMethod::Get => api::Method::Get,
                HttpMethod::Post => api::Method::Post,
                HttpMethod::Delete => api::Method::Delete,
                HttpMethod::Put => api::Method::Put,
                HttpMethod::Patch => api::Method::Patch,
            },
            path: request.path,
            body: request.body,
            bearer: request.bearer,
            client: request.client,
        }
    }

    /// Holds every request from now on until `release`; the channel hears
    /// each one that starts waiting.
    fn hold(&self) -> mpsc::Receiver<()> {
        let (waiting, heard) = mpsc::channel();
        *self.held.lock().unwrap() = Some(waiting);
        heard
    }

    fn release(&self) {
        *self.held.lock().unwrap() = None;
        self.released.notify_all();
    }

    fn through(
        &self,
        request: HttpRequest,
        send: impl FnOnce(api::Request) -> Result<api::Response, api::Unreachable>,
    ) -> Result<HttpResponse, TransportError> {
        self.seen.lock().unwrap().push(request.clone());
        let mut held = self.held.lock().unwrap();
        if let Some(waiting) = held.as_ref() {
            let _ = waiting.send(());
        }
        while held.is_some() {
            held = self.released.wait(held).unwrap();
        }
        drop(held);
        if let Some(answer) = self.canned.lock().unwrap().pop_front() {
            return Ok(answer);
        }
        if std::mem::take(&mut *self.panics.lock().unwrap()) {
            panic!("the transport panicked");
        }
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
    dir: tempfile::TempDir,
}

fn phone(relay: &Arc<Relay>, account: &str, device: &str) -> Phone {
    let dir = tempfile::tempdir().unwrap();
    let app = Arc::new(App {
        link: relay.link(account, device),
        seen: Mutex::new(Vec::new()),
        offline: Mutex::new(false),
        panics: Mutex::new(false),
        held: Mutex::new(None),
        released: Condvar::new(),
        canned: Mutex::default(),
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
    let url = client.begin_sign_in(SignInProvider::Kenni).unwrap();
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
    Phone { app, client, dir }
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
    assert_eq!(
        b1.client.search_conversations("NAME".into()).unwrap(),
        listed
    );
    assert!(
        b1.client
            .search_conversations("ame".into())
            .unwrap()
            .is_empty()
    );

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
    // When the server stored it (0048).
    let received_at = item.received_at.expect("a server time");

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
            ts: received_at,
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
    assert!(b1.client.set_push_token("apns-b1".into(), true).unwrap());
    b1.client.sync().unwrap();
    assert_eq!(relay.push_token("b1"), Some(("apns-b1".into(), true)));
    // Once the server has it, the same token calls for no sync.
    assert!(!b1.client.set_push_token("apns-b1".into(), true).unwrap());

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
        let before = request.path.starts_with("/v1/sign-in?") || request.path == "/v1/devices";
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
        panics: Mutex::new(false),
        held: Mutex::new(None),
        released: Condvar::new(),
        canned: Mutex::default(),
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
    let url = b1.begin_sign_in(SignInProvider::Kenni).unwrap();
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
    // A refusal crosses with the server's id for the request (0037).
    assert!(matches!(
        a1.client.resolve_invite("no-such-invite-token".into()),
        Err(CoreError::Refused { status: 404, code, request_id: Some(id) })
            if code == "not_found" && id.starts_with("relay-")
    ));
    assert!(matches!(
        CoreClient::open(String::new(), vec![7; 31], a1.app.clone(), Platform::Android, "0.2.0".into()),
        Err(CoreError::Store { detail }) if detail == "key-length/31"
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
fn client_too_old_crosses_with_its_update_url() {
    let relay = Relay::new();
    let a1 = phone(&relay, "a", "a1");
    let answer = |body: &str| {
        a1.app.canned.lock().unwrap().push_back(HttpResponse {
            status: 426,
            body: body.into(),
        });
    };

    answer(
        r#"{"error":"client_too_old","minVersion":"9.0.0","updateUrl":"https://play.google.com/apps/internaltest/4701643324608289838"}"#,
    );
    assert!(matches!(
        a1.client.stock_key_packages(1),
        Err(CoreError::ClientTooOld { min_version, update_url })
            if min_version == "9.0.0"
                && update_url.as_deref() == Some("https://play.google.com/apps/internaltest/4701643324608289838")
    ));

    answer(r#"{"error":"client_too_old","minVersion":"9.0.0"}"#);
    assert!(matches!(
        a1.client.stock_key_packages(1),
        Err(CoreError::ClientTooOld { min_version, update_url })
            if min_version == "9.0.0" && update_url.is_none()
    ));
}

/// Runs `read` on a thread of its own and gives what it returned; panics
/// when it has not returned within two seconds.
fn promptly<T: Send + 'static>(read: impl FnOnce() -> T + Send + 'static) -> T {
    let (done, result) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = done.send(read());
    });
    result
        .recv_timeout(Duration::from_secs(2))
        .expect("the read waited")
}

/// A conversation of a1's with b holding one text from a, delivered to b1.
fn texted(relay: &Arc<Relay>, a1: &Phone, b1: &Phone) -> String {
    let conversation = a1.client.create_conversation(vec!["b".into()]).unwrap();
    a1.client.sync().unwrap();
    deliver(relay, b1, "b", "b1");
    a1.client
        .send(conversation.clone(), Body::Text { text: "hæ".into() })
        .unwrap();
    a1.client.sync().unwrap();
    deliver(relay, b1, "b", "b1");
    conversation
}

/// Every read the screens make, as they make it.
fn read_all(client: &CoreClient, conversation: &str) -> (usize, usize) {
    let listed = client.conversations().unwrap();
    let items = client.timeline(conversation.into(), None, 10).unwrap();
    client.shared(conversation.into(), None, 10).unwrap();
    client.search_conversations("name".into()).unwrap();
    client.search_list(" ".into(), 5).unwrap();
    client.people().unwrap();
    client.settings().unwrap();
    (listed.len(), items.len())
}

/// Decision 0056: a sync holds the client through its requests, and the
/// list and the timeline are read meanwhile, from what is stored.
#[test]
fn a_read_during_a_sync_does_not_wait() {
    let relay = Relay::new();
    let a1 = phone(&relay, "a", "a1");
    let b1 = phone(&relay, "b", "b1");
    let conversation = texted(&relay, &a1, &b1);

    let waiting = b1.app.hold();
    let syncing = std::thread::spawn({
        let client = b1.client.clone();
        move || client.sync()
    });
    waiting
        .recv_timeout(Duration::from_secs(5))
        .expect("the sync made a request");
    let (listed, items) = promptly({
        let client = b1.client.clone();
        move || read_all(&client, &conversation)
    });
    assert_eq!(listed, 1);
    assert!(items >= 1);
    b1.app.release();
    syncing.join().unwrap().unwrap();
}

/// What an app asks at every start (who it is signed in as, its token, the
/// `Spjall-Client` value) is answered while a sync, which the push token's
/// arrival starts on each launch, holds the client through its requests.
#[test]
fn a_start_during_a_sync_does_not_wait() {
    let relay = Relay::new();
    let a1 = phone(&relay, "a", "a1");

    let waiting = a1.app.hold();
    let syncing = std::thread::spawn({
        let client = a1.client.clone();
        move || client.sync()
    });
    waiting
        .recv_timeout(Duration::from_secs(5))
        .expect("the sync made a request");
    let (signed_in, token, header) = promptly({
        let client = a1.client.clone();
        move || {
            (
                client.signed_in().unwrap(),
                client.device_token().unwrap(),
                client.client_header().unwrap(),
            )
        }
    });
    assert_eq!(
        signed_in,
        Some(SignedIn {
            account_id: "a".into(),
            device_id: "a1".into()
        })
    );
    assert!(token.is_some());
    assert_eq!(header, "android/0.2.0");
    a1.app.release();
    syncing.join().unwrap().unwrap();
}

/// A read takes no write lock, so another process writing (the
/// notification service storing a push) does not hold it up.
#[test]
fn a_read_does_not_take_the_write_lock() {
    let relay = Relay::new();
    let a1 = phone(&relay, "a", "a1");
    let b1 = phone(&relay, "b", "b1");
    let conversation = texted(&relay, &a1, &b1);

    let mut other = spjall_store::Store::open(b1.dir.path(), &[7; 32]).unwrap();
    let client = b1.client.clone();
    let (listed, items) = other
        .write(|_| Ok(promptly(move || read_all(&client, &conversation))))
        .unwrap();
    assert_eq!(listed, 1);
    assert!(items >= 1);
}

/// A message whose timer is up is not read, and the read leaves it for the
/// purge, which reports it.
#[test]
fn an_expired_row_is_not_read_before_the_purge() {
    let relay = Relay::new();
    let a1 = phone(&relay, "a", "a1");
    let b1 = phone(&relay, "b", "b1");
    let conversation = texted(&relay, &a1, &b1);
    let seq = b1
        .client
        .timeline(conversation.clone(), None, 10)
        .unwrap()
        .last()
        .and_then(|item| item.seq)
        .unwrap();

    let mut other = spjall_store::Store::open(b1.dir.path(), &[7; 32]).unwrap();
    let stored = |other: &mut spjall_store::Store| {
        other
            .write(|tx| {
                tx.query_row(
                    "SELECT COUNT(*) FROM timeline WHERE kind = 'text'",
                    [],
                    |r| r.get::<_, u32>(0),
                )
            })
            .unwrap()
    };
    other
        .write(|tx| {
            tx.execute("UPDATE timeline SET expires_at = 1 WHERE kind = 'text'", [])?;
            tx.execute("UPDATE messages SET expires_at = 1", [])
        })
        .unwrap();

    let listed = b1.client.conversations().unwrap();
    assert_eq!(listed[0].unread, 0);
    assert!(
        listed[0]
            .last
            .as_ref()
            .is_none_or(|last| last.seq != Some(seq))
    );
    let items = b1.client.timeline(conversation.clone(), None, 10).unwrap();
    assert!(items.iter().all(|item| item.seq != Some(seq)));
    assert!(
        b1.client
            .history(conversation.clone(), None, 10)
            .unwrap()
            .is_empty()
    );
    assert_eq!(stored(&mut other), 1, "a read deleted it");

    assert_eq!(
        b1.client.expire().unwrap().events,
        vec![Event::Expired {
            conversation,
            removed: vec![seq]
        }]
    );
    assert_eq!(stored(&mut other), 0);
}

#[test]
fn a_panic_does_not_leave_the_client_locked() {
    let relay = Relay::new();
    let a1 = phone(&relay, "a", "a1");

    *a1.app.panics.lock().unwrap() = true;
    let panicked = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        a1.client.stock_key_packages(5)
    }));
    assert!(panicked.is_err());
    a1.client.stock_key_packages(5).unwrap();
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

#[test]
fn google_links_and_one_to_ones_cross_the_exported_api() {
    let relay = Relay::new();
    let a1 = phone(&relay, "a", "a1");
    let b1 = phone(&relay, "b", "b1");

    // A Google sign-in on a fresh device.
    let dir = tempfile::tempdir().unwrap();
    let app = Arc::new(App {
        link: relay.link("c", "c1"),
        seen: Mutex::new(Vec::new()),
        offline: Mutex::new(false),
        panics: Mutex::new(false),
        held: Mutex::new(None),
        released: Condvar::new(),
        canned: Mutex::default(),
    });
    let c1 = CoreClient::open(
        dir.path().to_string_lossy().into_owned(),
        vec![7; 32],
        app,
        Platform::Ios,
        "0.2.0".into(),
    )
    .unwrap();
    let url = c1.begin_sign_in(SignInProvider::Google).unwrap();
    c1.complete_sign_in(relay::google(&url), None, Platform::Ios)
        .unwrap();
    assert!(!c1.me().unwrap().verified);
    let url = c1.begin_link(SignInProvider::Kenni).unwrap();
    c1.complete_link(relay::kenni(&url)).unwrap();
    assert!(c1.me().unwrap().verified);

    // Any signed-in account to an encrypted 1:1, no link (0034, 0036).
    let one = b1.client.open_direct("a".into()).unwrap();
    b1.client.sync().unwrap();
    deliver(&relay, &a1, "a", "a1");
    assert_eq!(b1.client.open_direct("a".into()).unwrap(), one);
    assert!(matches!(
        b1.client.open_direct("b".into()),
        Err(CoreError::Invalid { .. })
    ));

    // Nothing sends a new shared post (0044).
    assert!(matches!(
        b1.client.send(
            one,
            Body::Post {
                post_id: "post_0001".into()
            }
        ),
        Err(CoreError::Invalid { .. })
    ));
}

/// The social calls through the exported API: what each sends, and the
/// records the app is handed back. The answers are canned, as the Worker
/// would give them.
#[test]
fn the_social_calls_cross_the_exported_api() {
    let relay = Relay::new();
    let a1 = phone(&relay, "a", "a1");
    let answer = |status: u16, body: &str| {
        a1.app.canned.lock().unwrap().push_back(HttpResponse {
            status,
            body: body.into(),
        });
    };
    a1.app.seen.lock().unwrap().clear();

    let community = r#"{"communityId":"cm_1","name":"Kór","description":"","audience":"private",
        "createdAt":1,"memberCount":3,"role":"owner","joinRequested":false,"invited":false,
        "mutedUntil":null,"readOnly":false}"#;
    answer(200, community);
    let made = a1
        .client
        .create_community("Kór".into(), String::new(), CommunityAudience::Private)
        .unwrap();
    assert_eq!(
        (made.audience, made.role, made.member_count),
        (
            CommunityAudience::Private,
            Some(CommunityRole::Owner),
            Some(3)
        )
    );

    answer(
        200,
        r#"{"posts":[{"postId":"p_1","communityId":"cm_1",
        "author":{"accountId":"a","name":null,"verified":false},"body":"Halló",
        "media":[{"mediaId":"sm_1","width":4,"height":3}],"createdAt":2,
        "reactions":[{"kind":"laugh","count":2}],"myReaction":null,"commentCount":0,
        "state":"removed"}],"next":"2"}"#,
    );
    let page = a1
        .client
        .community_posts("cm_1".into(), None, 10, Some("Halló".into()))
        .unwrap();
    let post = &page.posts[0];
    assert_eq!(page.next.as_deref(), Some("2"));
    assert_eq!(
        post.author,
        Author {
            account_id: "a".into(),
            name: None,
            verified: false
        }
    );
    assert_eq!(
        post.reactions,
        [ReactionCount {
            kind: ReactionKind::Laugh,
            count: 2
        }]
    );
    assert_eq!(
        (post.images[0].width, post.state),
        (4, ModerationState::Removed)
    );

    answer(204, "");
    a1.client.react("p_1".into(), ReactionKind::Wow).unwrap();
    answer(204, "");
    a1.client
        .report(
            ReportTarget {
                kind: ReportTargetKind::Account,
                id: "b".into(),
            },
            ReportReason::Spam,
            String::new(),
            true,
        )
        .unwrap();
    answer(204, "");
    a1.client
        .moderate(
            "cm_1".into(),
            ModerationAction::BanMember,
            "b".into(),
            "Ruslpóstur".into(),
            None,
            None,
        )
        .unwrap();

    answer(
        200,
        r#"{"cards":[{"kind":"community","ref":{"kind":"community","id":"cm_1"},
        "community":{"communityId":"cm_1","name":"Kór"},"description":"","audience":"open",
        "memberCount":3}]}"#,
    );
    let reference = CardRef {
        kind: CardKind::Community,
        id: "cm_1".into(),
    };
    assert_eq!(
        a1.client.cards(vec![reference.clone()]).unwrap(),
        [Card::Community {
            reference,
            community: CardCommunity {
                community_id: "cm_1".into(),
                name: "Kór".into()
            },
            description: String::new(),
            audience: CommunityAudience::Open,
            member_count: Some(3),
        }]
    );

    answer(
        200,
        r#"{"notifications":[{"notificationId":"n_1","kind":"join_approved","actor":null,
        "communityId":"cm_1","postId":null,"commentId":null,"action":null,"createdAt":5,
        "read":true}],"unread":0}"#,
    );
    let notifications = a1.client.notifications(None, 50).unwrap();
    assert_eq!(
        (
            notifications.notifications[0].kind,
            notifications.unread,
            notifications.next
        ),
        (SocialNotificationKind::JoinApproved, 0, None)
    );

    answer(204, "");
    a1.client
        .set_community_role("cm_1".into(), "b".into(), CommunityRole::Moderator)
        .unwrap();

    answer(
        200,
        r#"{"communityId":"cm_1","name":"Kór Hlíðanna","description":"","audience":"private",
        "createdAt":1,"memberCount":3,"role":"owner","joinRequested":false,"invited":false,
        "mutedUntil":null,"readOnly":false,"openReports":2}"#,
    );
    let edited = a1
        .client
        .update_community(
            "cm_1".into(),
            Some("Kór Hlíðanna".into()),
            None,
            Some(CommunityAudience::Private),
        )
        .unwrap();
    assert_eq!(edited.open_reports, Some(2));

    answer(
        200,
        r#"{"members":[{"accountId":"a","name":"Sigrún","verified":true,"role":"owner",
        "joinedAt":9}]}"#,
    );
    let members = a1.client.community_members("cm_1".into()).unwrap();
    assert_eq!(
        (
            members[0].account_id.as_str(),
            members[0].role,
            members[0].joined_at
        ),
        ("a", CommunityRole::Owner, 9)
    );

    answer(
        200,
        r#"{"entries":[{"entryId":4,"communityId":"cm_1","actor":null,"asPlatform":false,
        "action":"close_report","target":{"kind":"report","id":"r_1"},"targetAccount":null,
        "reason":"Lokið","createdAt":6}],"next":null}"#,
    );
    let log = a1
        .client
        .community_moderation_log("cm_1".into(), None, 50)
        .unwrap();
    assert_eq!(
        (
            log.entries[0].action,
            log.entries[0].target.kind,
            log.entries[0].target.id.as_str()
        ),
        (
            ModerationLogAction::CloseReport,
            LogTargetKind::Report,
            "r_1"
        )
    );

    answer(200, r#"{"posts":[],"next":null}"#);
    assert!(a1.client.feed(None, 20).unwrap().posts.is_empty());

    answer(
        200,
        r#"{"commentId":"p_1-0a1b","postId":"p_1","parentCommentId":"p_1-0a1a",
        "author":{"accountId":"a","name":null,"verified":false},"body":"Svar","createdAt":7,
        "state":"visible"}"#,
    );
    let reply = a1
        .client
        .create_comment("p_1".into(), "Svar".into(), Some("p_1-0a1a".into()))
        .unwrap();
    assert_eq!(reply.parent_comment_id.as_deref(), Some("p_1-0a1a"));

    answer(403, r#"{"error":"not_moderator","requestId":"r"}"#);
    assert!(matches!(
        a1.client.close_report("r_1".into(), "Lokið".into()),
        Err(CoreError::Refused { status: 403, .. })
    ));
    assert!(matches!(
        a1.client.post("../x".into()),
        Err(CoreError::Invalid { .. })
    ));

    let seen: Vec<_> = a1
        .app
        .seen
        .lock()
        .unwrap()
        .drain(..)
        .map(|r| (r.method, r.path))
        .collect();
    assert_eq!(
        seen,
        [
            (HttpMethod::Post, "/v1/communities".to_string()),
            (
                HttpMethod::Get,
                "/v1/communities/cm_1/posts?q=Hall%C3%B3&limit=10".into()
            ),
            (HttpMethod::Put, "/v1/posts/p_1/reaction".into()),
            (HttpMethod::Post, "/v1/reports".into()),
            (HttpMethod::Post, "/v1/communities/cm_1/actions".into()),
            (HttpMethod::Post, "/v1/cards".into()),
            (HttpMethod::Get, "/v1/notifications?limit=50".into()),
            (
                HttpMethod::Put,
                "/v1/communities/cm_1/members/b/role".into()
            ),
            (HttpMethod::Patch, "/v1/communities/cm_1".into()),
            (HttpMethod::Get, "/v1/communities/cm_1/members".into()),
            (
                HttpMethod::Get,
                "/v1/communities/cm_1/moderation-log?limit=50".into()
            ),
            (HttpMethod::Get, "/v1/feed?limit=20".into()),
            (HttpMethod::Post, "/v1/posts/p_1/comments".into()),
            (HttpMethod::Post, "/v1/reports/r_1/close".into()),
        ]
    );
}
