//! Linking a browser from its session (0064, 0077, 0081) against the
//! in-memory relay: the browser asks and shows a code, a phone of the same
//! account approves it, and the browser completes into a device, receives
//! the phone's history and joins its conversations.

#![allow(clippy::disallowed_methods)] // tests use files

#[path = "support/relay.rs"]
#[allow(dead_code)]
mod relay;

use std::sync::Arc;

use relay::{Link, Relay};
use spjall_client::api::{DeviceKind, Method, Platform, Provider};
use spjall_client::{Client, ClientError, Content, Event, LinkCode, LinkError, LinkState};
use spjall_envelope::Body;
use tempfile::TempDir;

const KEY: [u8; 32] = [7; 32];

struct Device {
    relay: Arc<Relay>,
    account: String,
    device: String,
    dir: TempDir,
    client: Client<Link>,
}

impl Device {
    fn open(relay: &Arc<Relay>, account: &str, device: &str) -> Self {
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

    /// A phone, signed in with its KeyPackages up.
    fn phone(relay: &Arc<Relay>, account: &str, device: &str) -> Self {
        let mut phone = Self::open(relay, account, device);
        let url = phone.client.begin_sign_in(Provider::Kenni).unwrap();
        phone
            .client
            .complete_sign_in(&relay::kenni(&url), None, Platform::Android)
            .unwrap();
        phone.client.stock_key_packages(3).unwrap();
        phone
    }

    /// A browser signed in to a session of `account`, not yet a device.
    fn browser(relay: &Arc<Relay>, account: &str, device: &str) -> Self {
        relay.open_session(device);
        Self::open(relay, account, device)
    }

    fn reopen(&mut self) {
        let link = self.relay.link(&self.account, &self.device);
        self.client = Client::open(self.dir.path(), &KEY, link).unwrap();
    }

    fn forward(&self, frames: Vec<String>) {
        for frame in frames {
            self.relay.socket(&self.account, &frame);
        }
    }

    fn sync(&mut self) -> Vec<Event> {
        let outcome = self.client.sync().unwrap();
        self.forward(outcome.frames);
        outcome.events
    }

    fn deliver(&mut self) -> Vec<Event> {
        let mut events = Vec::new();
        loop {
            let frames = self.relay.frames(&self.device);
            if frames.is_empty() {
                return events;
            }
            for frame in frames {
                let outcome = self.client.on_frame(&frame).unwrap();
                events.extend(outcome.events);
                self.forward(outcome.frames);
            }
        }
    }

    fn send(&mut self, conversation: &str, text: &str) {
        self.client
            .send(
                conversation,
                Body::Text {
                    text: text.into(),
                    forwarded: false,
                },
            )
            .unwrap();
        self.sync();
    }

    fn texts(&mut self, conversation: &str) -> Vec<String> {
        // The timeline, which is what a history import fills. A conversation
        // this device has not joined has no texts yet.
        let items = match self.client.timeline(conversation, None, 100) {
            Err(ClientError::UnknownConversation) => Vec::new(),
            items => items.unwrap(),
        };
        items
            .into_iter()
            .filter_map(|item| match item.content {
                Content::Text { text, .. } => Some(text),
                _ => None,
            })
            .collect()
    }
}

fn texts(events: &[Event]) -> Vec<String> {
    events
        .iter()
        .filter_map(|e| match e {
            Event::Message(m) => match &m.envelope.body {
                Body::Text { text, .. } => Some(text.clone()),
                _ => None,
            },
            _ => None,
        })
        .collect()
}

fn joined(events: &[Event]) -> Vec<String> {
    events
        .iter()
        .filter_map(|e| match e {
            Event::Joined { conversation } => Some(conversation.clone()),
            _ => None,
        })
        .collect()
}

/// `a1` and `b1` in a conversation with a message each way.
fn talking(relay: &Arc<Relay>) -> (Device, Device, String) {
    let mut a1 = Device::phone(relay, "a", "a1");
    let mut b1 = Device::phone(relay, "b", "b1");
    let conversation = a1.client.create_conversation(&["b".into()]).unwrap();
    a1.sync();
    assert_eq!(joined(&b1.deliver()), vec![conversation.clone()]);
    a1.send(&conversation, "fyrir");
    b1.deliver();
    b1.send(&conversation, "svar");
    a1.deliver();
    (a1, b1, conversation)
}

#[test]
fn a_browser_is_linked_by_a_phone_and_starts_with_its_history() {
    let relay = Relay::new();
    let (mut a1, mut b1, conversation) = talking(&relay);
    let mut w1 = Device::browser(&relay, "a", "w1");

    let link = w1.client.begin_device_link().unwrap();
    let code = LinkCode::parse(&link.code).unwrap();
    assert_eq!(code.link_id, link.link_id);
    assert_eq!(code.device_key, w1.client.device_key().unwrap());
    assert_eq!(code.to_string(), link.code);
    assert!(link.expires_at > 0);
    assert_eq!(w1.client.device_link_state().unwrap(), LinkState::Pending);
    // Not approved yet: completing is refused and the link stays pending.
    assert!(matches!(
        w1.client.complete_device_link(),
        Err(ClientError::Link(LinkError::NotApproved))
    ));

    a1.client.inspect_link(&link.code).unwrap();
    assert!(a1.client.approve_link(&link.code, None, true).unwrap() > 0);
    // A restart between showing the code and completing loses nothing.
    w1.reopen();
    assert_eq!(w1.client.device_link_state().unwrap(), LinkState::Approved);

    let enrolled = w1.client.complete_device_link().unwrap();
    assert!(enrolled.history_expected);
    assert_eq!(enrolled.store_key_share, vec![0x5a; 32]);
    assert_eq!(
        (
            enrolled.signed_in.account.as_str(),
            enrolled.signed_in.device.as_str()
        ),
        ("a", "w1")
    );
    assert_eq!(w1.client.signed_in().unwrap(), Some(enrolled.signed_in));
    assert!(!relay.link_pending(&link.link_id));

    assert_eq!(w1.client.receive_linked_history().unwrap(), 1);
    assert!(!relay.holds_history(&link.link_id));
    assert_eq!(w1.texts(&conversation), ["fyrir", "svar"]);
    // The history key is gone: nothing more waits.
    assert_eq!(w1.client.receive_linked_history().unwrap(), 0);

    // The first sync joins by external commit, and messages go both ways.
    assert_eq!(joined(&w1.sync()), vec![conversation.clone()]);
    b1.deliver();
    a1.deliver();
    b1.send(&conversation, "velkomin");
    assert_eq!(texts(&w1.deliver()), ["velkomin"]);
    assert_eq!(texts(&a1.deliver()), ["velkomin"]);
    w1.send(&conversation, "takk");
    assert_eq!(texts(&b1.deliver()), ["takk"]);
    assert_eq!(texts(&a1.deliver()), ["takk"]);
    assert_eq!(
        w1.texts(&conversation),
        ["fyrir", "svar", "velkomin", "takk"]
    );

    // The phone sees a browser among the account's devices.
    let kinds: Vec<_> = a1
        .client
        .hosted()
        .me()
        .unwrap()
        .devices
        .into_iter()
        .map(|d| (d.device_id, d.kind))
        .collect();
    assert_eq!(
        kinds,
        [
            ("a1".to_string(), DeviceKind::Phone),
            ("w1".to_string(), DeviceKind::Web)
        ]
    );
}

#[test]
fn an_approval_without_history_downloads_nothing() {
    let relay = Relay::new();
    let (mut a1, mut b1, conversation) = talking(&relay);
    let mut w1 = Device::browser(&relay, "a", "w1");
    let link = w1.client.begin_device_link().unwrap();

    assert_eq!(a1.client.approve_link(&link.code, None, false).unwrap(), 0);
    let enrolled = w1.client.complete_device_link().unwrap();
    assert!(!enrolled.history_expected);
    assert_eq!(w1.client.receive_linked_history().unwrap(), 0);
    assert!(
        !relay
            .requests("w1")
            .iter()
            .any(|r| r.path.ends_with("/history"))
    );

    // It still joins: the account's conversations come from the server.
    assert!(w1.client.conversations().unwrap().is_empty());
    b1.send(&conversation, "hæ");
    a1.deliver();
    let _ = w1.sync();
    assert!(w1.texts(&conversation).is_empty() || w1.texts(&conversation) == ["hæ"]);
}

#[test]
fn a_link_completes_once() {
    let relay = Relay::new();
    let (mut a1, _b1, _conversation) = talking(&relay);
    let mut w1 = Device::browser(&relay, "a", "w1");
    let link = w1.client.begin_device_link().unwrap();
    a1.client.approve_link(&link.code, None, false).unwrap();
    w1.client.complete_device_link().unwrap();

    let before = relay.requests("w1").len();
    assert!(matches!(
        w1.client.complete_device_link(),
        Err(ClientError::Link(LinkError::Gone))
    ));
    assert!(matches!(
        w1.client.device_link_state(),
        Err(ClientError::Link(LinkError::Gone))
    ));
    // Refused here, without asking the server.
    assert_eq!(relay.requests("w1").len(), before);
    // And a device does not link again.
    assert!(matches!(
        w1.client.begin_device_link(),
        Err(ClientError::Invalid(_))
    ));
}

#[test]
fn an_expired_link_says_so() {
    let relay = Relay::new();
    let _a1 = Device::phone(&relay, "a", "a1");
    let mut w1 = Device::browser(&relay, "a", "w1");
    let link = w1.client.begin_device_link().unwrap();
    relay.set_clock(link.expires_at as u64 + 1);

    assert_eq!(w1.client.device_link_state().unwrap(), LinkState::Expired);
    assert!(matches!(
        w1.client.complete_device_link(),
        Err(ClientError::Link(LinkError::Gone))
    ));
    assert_eq!(w1.client.signed_in().unwrap(), None);
    // Asking again replaces it with a new code.
    relay.set_clock(link.expires_at as u64 - 1);
    let again = w1.client.begin_device_link().unwrap();
    assert_ne!(again.link_id, link.link_id);
    assert_eq!(w1.client.device_link_state().unwrap(), LinkState::Pending);
}

#[test]
fn nothing_is_pending_before_a_link_is_asked_for() {
    let relay = Relay::new();
    let mut w1 = Device::browser(&relay, "a", "w1");
    assert!(matches!(
        w1.client.device_link_state(),
        Err(ClientError::Link(LinkError::Gone))
    ));
    assert!(matches!(
        w1.client.complete_device_link(),
        Err(ClientError::Link(LinkError::Gone))
    ));
    assert_eq!(w1.client.receive_linked_history().unwrap(), 0);
    assert!(relay.requests("w1").is_empty());
}

#[test]
fn a_history_arrives_in_ranged_pieces() {
    let relay = Relay::new();
    let (mut a1, _b1, conversation) = talking(&relay);
    let mut w1 = Device::browser(&relay, "a", "w1");
    let link = w1.client.begin_device_link().unwrap();
    a1.client.approve_link(&link.code, None, true).unwrap();
    let enrolled = w1.client.complete_device_link().unwrap();
    assert!(enrolled.history_expected);

    assert_eq!(w1.client.receive_linked_history_in(256).unwrap(), 1);
    assert_eq!(w1.texts(&conversation), ["fyrir", "svar"]);
    let ranges = relay
        .requests("w1")
        .iter()
        .filter(|r| r.method == Method::Get && r.path.ends_with("/history"))
        .count();
    // The sealed history is a few KiB at most: several pieces, then the end.
    assert!(ranges >= 2, "{ranges}");
    assert!(!relay.holds_history(&link.link_id));
}
