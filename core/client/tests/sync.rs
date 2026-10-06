//! The sync engine against the in-memory relay: devices with their own store
//! files, talking only through requests and socket frames.

#[path = "support/relay.rs"]
mod relay;

use std::sync::Arc;

use relay::{Link, Relay};
use spjall_client::{Client, ClientError, Event, State, api::ApiError};
use spjall_envelope::Body;
use spjall_mls::group::GroupError;
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
        let mut client = Client::open(dir.path(), &KEY, relay.link(account, device)).unwrap();
        client.device_key().unwrap();
        relay.register(account, device);
        client.registered(account, device).unwrap();
        assert_eq!(client.stock_key_packages(3).unwrap(), 3);
        Self {
            relay: relay.clone(),
            account: account.into(),
            device: device.into(),
            dir,
            client,
        }
    }

    /// The process died; the app starts again on the same store.
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

    /// Reads the socket until nothing is waiting on it.
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
            .send(conversation, Body::Text { text: text.into() })
            .unwrap();
    }

    /// `(sender account, text, own)` for the whole history.
    fn history(&mut self, conversation: &str) -> Vec<(String, String, bool)> {
        self.client
            .history(conversation, None, 100)
            .unwrap()
            .into_iter()
            .map(|m| {
                let Body::Text { text } = m.envelope.body else {
                    panic!("not text");
                };
                (m.sender.account, text, m.own)
            })
            .collect()
    }
}

fn texts(events: &[Event]) -> Vec<String> {
    events
        .iter()
        .filter_map(|e| match e {
            Event::Message(m) => match &m.envelope.body {
                Body::Text { text } => Some(text.clone()),
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

fn membership(events: &[Event]) -> Vec<(Vec<String>, Vec<String>)> {
    events
        .iter()
        .filter_map(|e| match e {
            Event::Membership { added, removed, .. } => Some((added.clone(), removed.clone())),
            _ => None,
        })
        .collect()
}

fn strings(items: &[&str]) -> Vec<String> {
    items.iter().map(|s| (*s).to_owned()).collect()
}

/// `a` makes a conversation with `b` and both are in it.
fn conversation(a: &mut Phone, b: &mut Phone) -> String {
    let conversation = a
        .client
        .create_conversation(&strings(&[&b.account]))
        .unwrap();
    assert_eq!(
        membership(&a.sync()),
        vec![(strings(&[&b.account]), Vec::new())]
    );
    assert_eq!(joined(&b.deliver()), vec![conversation.clone()]);
    conversation
}

#[test]
fn accounts_talk_across_their_devices() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut a2 = Phone::new(&relay, "a", "a2");
    let mut b1 = Phone::new(&relay, "b", "b1");

    let conversation = conversation(&mut a1, &mut b1);
    assert_eq!(joined(&a2.deliver()), vec![conversation.clone()]);

    a1.send(&conversation, "halló");
    assert_eq!(texts(&a1.sync()), strings(&["halló"]));
    assert_eq!(texts(&b1.deliver()), strings(&["halló"]));
    assert_eq!(texts(&a2.deliver()), strings(&["halló"]));

    // More than one page of the relay's listing.
    for text in ["eitt", "tvö", "þrjú", "fjögur"] {
        b1.send(&conversation, text);
    }
    b1.sync();
    assert_eq!(
        texts(&a1.deliver()),
        strings(&["eitt", "tvö", "þrjú", "fjögur"])
    );

    let history = a1.history(&conversation);
    assert_eq!(history[0], ("a".into(), "halló".into(), true));
    assert_eq!(history[4], ("b".into(), "fjögur".into(), false));
    assert_eq!(history.len(), 5);
    // The other device of the same account is not this one.
    assert_eq!(
        a2.history(&conversation)[0],
        ("a".into(), "halló".into(), false)
    );
}

#[test]
fn a_lost_answer_is_sent_again_as_the_same_bytes() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let conversation = conversation(&mut a1, &mut b1);

    a1.send(&conversation, "einu sinni");
    relay.lose_next("a1", 1);
    assert!(matches!(
        a1.client.sync(),
        Err(ClientError::Transport(ApiError::Unreachable(_)))
    ));
    assert_eq!(texts(&a1.sync()), strings(&["einu sinni"]));

    let sends = relay.sends("a1");
    let (first, again) = (&sends[sends.len() - 2], &sends[sends.len() - 1]);
    assert_eq!(first, again);
    assert_eq!(relay.stored(&conversation), 2);
    assert_eq!(texts(&b1.deliver()), strings(&["einu sinni"]));
}

#[test]
fn a_restart_between_sealing_and_the_answer_loses_and_doubles_nothing() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let conversation = conversation(&mut a1, &mut b1);

    a1.send(&conversation, "eftir endurræsingu");
    relay.lose_next("a1", 1);
    assert!(a1.client.sync().is_err());
    a1.reopen();
    a1.sync();

    assert_eq!(relay.stored(&conversation), 2);
    assert_eq!(texts(&b1.deliver()), strings(&["eftir endurræsingu"]));
    assert_eq!(
        a1.history(&conversation),
        vec![("a".into(), "eftir endurræsingu".into(), true)]
    );
}

#[test]
fn the_loser_of_an_epoch_commits_its_intent_again() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let mut c1 = Phone::new(&relay, "c", "c1");
    let mut d1 = Phone::new(&relay, "d", "d1");
    let conversation = conversation(&mut a1, &mut b1);

    a1.client
        .add_accounts(&conversation, &strings(&["c"]))
        .unwrap();
    b1.client
        .add_accounts(&conversation, &strings(&["d"]))
        .unwrap();
    // b's commit takes the epoch both were made on.
    assert_eq!(membership(&b1.sync()), vec![(strings(&["d"]), Vec::new())]);
    assert_eq!(
        membership(&a1.sync()),
        vec![(strings(&["d"]), Vec::new()), (strings(&["c"]), Vec::new())]
    );
    let conflicts: Vec<_> = relay
        .sends("a1")
        .into_iter()
        .filter(|s| !s["roster"].is_null())
        .collect();
    assert_eq!(conflicts.len(), 3, "the creation, the refused, the new");
    assert_ne!(conflicts[1]["clientMsgId"], conflicts[2]["clientMsgId"]);

    assert_eq!(joined(&c1.deliver()), vec![conversation.clone()]);
    assert_eq!(joined(&d1.deliver()), vec![conversation.clone()]);
    a1.send(&conversation, "öll fjögur");
    a1.sync();
    for phone in [&mut b1, &mut c1, &mut d1] {
        assert_eq!(texts(&phone.deliver()), strings(&["öll fjögur"]));
    }
}

#[test]
fn own_messages_are_known_by_their_seq() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let conversation = conversation(&mut a1, &mut b1);

    a1.send(&conversation, "mitt");
    let events = a1.sync();
    let [Event::Message(message)] = events.as_slice() else {
        panic!("{events:?}");
    };
    assert!(message.own);
    assert_eq!(message.seq, 2);
    // Its own socket notification changes nothing.
    assert!(a1.deliver().is_empty());
    assert_eq!(a1.history(&conversation).len(), 1);
}

#[test]
fn typing_is_relayed_and_never_stored() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let conversation = conversation(&mut a1, &mut b1);

    let frame = a1.client.typing(&conversation, true).unwrap();
    a1.forward(vec![frame]);
    assert_eq!(
        b1.deliver(),
        vec![Event::Typing {
            conversation: conversation.clone(),
            active: true
        }]
    );
    assert!(matches!(
        a1.client.send(&conversation, Body::Typing { active: true }),
        Err(ClientError::Invalid(_))
    ));
    a1.sync();
    assert_eq!(relay.stored(&conversation), 1);
    assert!(b1.deliver().is_empty());
    assert!(a1.history(&conversation).is_empty());
    assert!(b1.history(&conversation).is_empty());
}

#[test]
fn a_removed_account_learns_it() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let conversation = conversation(&mut a1, &mut b1);

    assert!(matches!(
        a1.client.remove_accounts(&conversation, &strings(&["a"])),
        Err(ClientError::Mls(GroupError::OwnAccount))
    ));
    a1.client
        .remove_accounts(&conversation, &strings(&["b"]))
        .unwrap();
    assert_eq!(membership(&a1.sync()), vec![(Vec::new(), strings(&["b"]))]);
    assert_eq!(
        b1.deliver(),
        vec![Event::Removed {
            conversation: conversation.clone()
        }]
    );
    assert_eq!(b1.client.conversations().unwrap()[0].state, State::Removed);
    assert!(matches!(
        b1.client
            .send(&conversation, Body::Text { text: "?".into() }),
        Err(ClientError::UnknownConversation)
    ));
}

#[test]
fn a_gap_left_by_expiry_makes_the_conversation_stale() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let conversation = conversation(&mut a1, &mut b1);

    for text in ["eitt", "tvö", "þrjú"] {
        a1.send(&conversation, text);
    }
    a1.sync();
    relay.expire(&conversation, 3);
    assert_eq!(
        b1.deliver(),
        vec![Event::Stale {
            conversation: conversation.clone()
        }]
    );
    assert_eq!(b1.client.conversations().unwrap()[0].state, State::Stale);
    assert!(b1.history(&conversation).is_empty());
}

#[test]
fn a_conversation_made_offline_reaches_the_server_later() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");

    let conversation = a1.client.create_conversation(&strings(&["b"])).unwrap();
    a1.send(&conversation, "þegar netið kemur");
    relay.fail_next("a1", 1);
    assert!(matches!(
        a1.client.sync(),
        Err(ClientError::Transport(ApiError::Unreachable(_)))
    ));
    assert_eq!(a1.client.conversations().unwrap()[0].state, State::New);

    a1.sync();
    assert_eq!(a1.client.conversations().unwrap()[0].state, State::Active);
    let events = b1.deliver();
    assert_eq!(joined(&events), vec![conversation.clone()]);
    assert_eq!(texts(&events), strings(&["þegar netið kemur"]));
}
