//! The sync engine against the in-memory relay: devices with their own store
//! files, talking only through requests and socket frames.

#[path = "support/relay.rs"]
#[allow(dead_code)]
mod relay;

use std::sync::Arc;

use relay::{Link, Relay};
use spjall_client::api::{ApiError, Platform, Provider};
use spjall_client::{
    Client, ClientError, Content, Event, Item, MediaError, NoticeKind, Settings, State, Status,
};
use spjall_envelope::Body;
use spjall_mls::group::{GroupError, forge};
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
        let mut phone = Self::unstocked(relay, account, device);
        assert_eq!(phone.client.stock_key_packages(3).unwrap(), 3);
        phone
    }

    /// Signed in, with no KeyPackages uploaded yet.
    fn unstocked(relay: &Arc<Relay>, account: &str, device: &str) -> Self {
        let dir = tempfile::tempdir().unwrap();
        let mut client = Client::open(dir.path(), &KEY, relay.link(account, device)).unwrap();
        let url = client.begin_sign_in(Provider::Kenni).unwrap();
        client
            .complete_sign_in(&relay::kenni(&url), None, Platform::Android)
            .unwrap();
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

    /// The hourly device check falls due again (0028).
    fn an_hour_passes(&mut self) {
        let mut store = spjall_store::Store::open(self.dir.path(), &KEY).unwrap();
        store
            .write(|tx| {
                tx.execute(
                    "UPDATE conversations SET devices_checked_at = devices_checked_at - 3600000",
                    [],
                )
            })
            .unwrap();
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

/// `(account, device)` of each device a commit brought into the group.
fn devices(events: &[Event]) -> Vec<(String, String)> {
    events
        .iter()
        .filter_map(|e| match e {
            Event::Devices { joined, .. } => Some(joined),
            _ => None,
        })
        .flatten()
        .map(|d| (d.account.clone(), d.device.clone()))
        .collect()
}

/// The events of 0018, without the timeline and profile events of 0022.
fn classic(events: Vec<Event>) -> Vec<Event> {
    events
        .into_iter()
        .filter(|e| !matches!(e, Event::Timeline { .. } | Event::Profiles { .. }))
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
        .filter(|s| !s["welcome"].is_null())
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
    let events = classic(a1.sync());
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

    let frame = a1.client.typing(&conversation, true).unwrap().unwrap();
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
        classic(b1.deliver()),
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

/// `a1` and `a2` are in a conversation with `b1`, `a2` by external commit.
fn with_a_sibling(relay: &Arc<Relay>) -> (Phone, Phone, Phone, String) {
    let mut a1 = Phone::new(relay, "a", "a1");
    let mut b1 = Phone::new(relay, "b", "b1");
    let conversation = conversation(&mut a1, &mut b1);
    let mut a2 = Phone::new(relay, "a", "a2");
    a1.send(&conversation, "fyrir");
    a1.sync();
    assert_eq!(joined(&a2.deliver()), vec![conversation.clone()]);
    a1.deliver();
    b1.deliver();
    (a1, a2, b1, conversation)
}

/// Revoking a device takes its leaf from every group at once (0028), with
/// no card for the others: the account is still in the conversation.
#[test]
fn revoking_a_device_removes_it_from_every_group() {
    let relay = Relay::new();
    let (mut a1, mut a2, mut b1, conversation) = with_a_sibling(&relay);
    let mut c1 = Phone::new(&relay, "c", "c1");
    let other = conversation_with(&mut a1, &mut c1, &mut a2);

    a1.client.revoke_device("a2").unwrap();
    assert!(membership(&a1.sync()).is_empty());
    for phone in [&mut b1, &mut c1] {
        let events = phone.deliver();
        assert!(membership(&events).is_empty(), "no card for a sibling");
    }
    a1.send(&conversation, "eftir");
    a1.sync();
    assert_eq!(texts(&b1.deliver()), strings(&["eftir"]));
    b1.send(&conversation, "takk");
    b1.sync();
    assert_eq!(texts(&a1.deliver()), strings(&["takk"]));
    a1.send(&other, "líka");
    a1.sync();
    assert_eq!(texts(&c1.deliver()), strings(&["líka"]));
    assert_unread(&relay, &mut a2, &["eftir", "takk", "líka"]);
}

/// The revoked device's store, shown everything by a server that still
/// answers its old token, opens none of `texts`: its leaf is gone.
fn assert_unread(relay: &Relay, revoked: &mut Phone, texts_after: &[&str]) {
    relay.answer_revoked(&revoked.device);
    let events = revoked.sync();
    let read = texts(&events);
    assert!(
        texts_after.iter().all(|t| !read.contains(&(*t).to_owned())),
        "{read:?}"
    );
    for c in revoked.client.conversations().unwrap() {
        assert_ne!(c.state, State::Active);
    }
}

/// `a` makes a second conversation with `b`, and `a`'s other device joins.
fn conversation_with(a: &mut Phone, b: &mut Phone, sibling: &mut Phone) -> String {
    let conversation = conversation(a, b);
    a.send(&conversation, "fyrir");
    a.sync();
    assert_eq!(joined(&sibling.deliver()), vec![conversation.clone()]);
    a.deliver();
    b.deliver();
    conversation
}

/// The post-compromise property: a server that still answers the revoked
/// device's old token shows its store the commit removing it, and nothing
/// sent after opens.
#[test]
fn a_revoked_device_cannot_read_after_its_removal() {
    let relay = Relay::new();
    let (mut a1, mut a2, _b1, conversation) = with_a_sibling(&relay);
    a1.client.revoke_device("a2").unwrap();
    a1.sync();
    a1.send(&conversation, "leyndó");
    a1.sync();

    assert_unread(&relay, &mut a2, &["leyndó"]);
    assert!(
        a2.history(&conversation)
            .iter()
            .all(|(_, text, _)| text != "leyndó")
    );
}

/// A device revoked from elsewhere, or by a core that never synced again,
/// is still removed: the first member whose check finds its leaf not
/// served commits the removal (0028).
#[test]
fn a_member_removes_a_leaf_the_server_no_longer_serves() {
    let relay = Relay::new();
    let (mut a1, mut a2, mut b1, conversation) = with_a_sibling(&relay);
    relay.revoke("a2");

    // Both checked within the hour; b1's check falls due first.
    b1.sync();
    assert_eq!(relay.sends("b1").len(), 0);
    b1.an_hour_passes();
    assert!(membership(&b1.sync()).is_empty());
    assert!(membership(&a1.deliver()).is_empty());
    let commits = |device: &str| {
        relay
            .sends(device)
            .iter()
            .filter(|s| !s["groupInfo"].is_null())
            .count()
    };
    assert_eq!(commits("b1"), 1);
    a1.send(&conversation, "eftir");
    a1.sync();
    assert_eq!(texts(&b1.deliver()), strings(&["eftir"]));
    assert_unread(&relay, &mut a2, &["eftir"]);
}

/// A deleted account's leaves are removed by the first member whose claim
/// the server refuses for naming it (0028).
#[test]
fn a_claim_naming_a_deleted_account_removes_its_leaves_first() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let mut c1 = Phone::new(&relay, "c", "c1");
    let mut d1 = Phone::new(&relay, "d", "d1");
    let conversation = conversation(&mut a1, &mut b1);
    a1.client
        .add_accounts(&conversation, &strings(&["c"]))
        .unwrap();
    a1.sync();
    b1.deliver();
    c1.deliver();

    c1.client.delete_account().unwrap();
    a1.client
        .add_accounts(&conversation, &strings(&["d"]))
        .unwrap();
    a1.sync();
    assert_eq!(
        membership(&b1.deliver()),
        vec![(Vec::new(), strings(&["c"])), (strings(&["d"]), Vec::new())]
    );
    assert_eq!(joined(&d1.deliver()), vec![conversation.clone()]);
    a1.send(&conversation, "án c");
    a1.sync();
    assert_eq!(texts(&d1.deliver()), strings(&["án c"]));
}

/// A device that never stocked does on its next sync, to the target with
/// a last resort, and a last resort close to expiry is replaced (0029).
#[test]
fn sync_restocks_key_packages_when_low() {
    let relay = Relay::new();
    let mut a1 = Phone::unstocked(&relay, "a", "a1");
    assert_eq!(relay.packages("a1"), 0);
    a1.sync();
    assert_eq!(relay.packages("a1"), 10);
    let first = relay.last_resort("a1").unwrap();

    // A day has not passed: the next sync does not count again.
    let posts = || {
        relay
            .requests("a1")
            .iter()
            .filter(|r| r.path == "/v1/key-packages")
            .count()
    };
    let counted = posts();
    a1.sync();
    assert_eq!(posts(), counted);

    relay.age_last_resort("a1", 13 * 24 * 60 * 60 * 1000);
    assert_eq!(a1.client.stock_key_packages(10).unwrap(), 10);
    assert_ne!(relay.last_resort("a1").unwrap(), first);
    let renewed = relay.last_resort("a1").unwrap();
    assert_eq!(a1.client.stock_key_packages(10).unwrap(), 10);
    assert_eq!(relay.last_resort("a1").unwrap(), renewed, "not due again");
}

/// Every request names the build, and a build below the server's floor is
/// told the minimum (0030). One that names no version counts as 0.1.0.
#[test]
fn a_build_below_the_floor_is_told_to_update() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    a1.client
        .set_client_version(Platform::Android, "0.2.0")
        .unwrap();
    a1.sync();
    assert!(
        relay
            .requests("a1")
            .iter()
            .rev()
            .take(1)
            .all(|r| r.client.as_deref() == Some("android/0.2.0"))
    );

    relay.set_floor((0, 3, 0));
    assert!(matches!(
        a1.client.sync(),
        Err(ClientError::Transport(ApiError::ClientTooOld { min })) if min == "0.3.0"
    ));
    a1.client
        .set_client_version(Platform::Android, "0.3.0")
        .unwrap();
    a1.sync();

    a1.reopen();
    assert!(matches!(
        a1.client.sync(),
        Err(ClientError::Transport(ApiError::ClientTooOld { .. }))
    ));
}

/// A commit can claim a roster MLS does not hold (0020): `a` adds `d` and
/// tells the server `b` is gone. `b` reads up to that commit, and is refused
/// after it without a commit removing it, so it is `Excluded`, not removed.
/// `c` sees the claim is not backed and corrects it, and `b` reads again.
#[test]
fn a_claim_that_leaves_a_member_out_is_corrected() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let mut c1 = Phone::new(&relay, "c", "c1");
    let mut d1 = Phone::new(&relay, "d", "d1");
    let conversation = conversation(&mut a1, &mut b1);
    a1.client
        .add_accounts(&conversation, &strings(&["c"]))
        .unwrap();
    a1.sync();
    b1.deliver();
    assert_eq!(joined(&c1.deliver()), vec![conversation.clone()]);

    a1.client
        .add_accounts(&conversation, &strings(&["d"]))
        .unwrap();
    forge::next_claim(&["a", "c", "d"], &["d"]);
    a1.sync();

    assert_eq!(
        membership(&b1.deliver()),
        vec![(strings(&["d"]), Vec::new())]
    );
    let state = |phone: &mut Phone| phone.client.conversations().unwrap()[0].state;
    assert_eq!(state(&mut b1), State::Excluded);
    let refused = relay.sends("b1");
    assert_eq!(refused.len(), 1, "b's own correction, refused");

    c1.deliver();
    assert_eq!(joined(&d1.deliver()), vec![conversation.clone()]);
    a1.deliver();
    assert!(classic(b1.deliver()).is_empty());
    assert_eq!(state(&mut b1), State::Active);
    assert_eq!(
        relay.sends("b1").len(),
        1,
        "c's correction made b's needless"
    );

    a1.send(&conversation, "aftur öll");
    a1.sync();
    for phone in [&mut b1, &mut c1, &mut d1] {
        assert_eq!(texts(&phone.deliver()), strings(&["aftur öll"]));
    }
    // The creation, two adds, the correction and the message.
    assert_eq!(relay.stored(&conversation), 5);
}

#[test]
fn a_gap_left_by_expiry_is_mended_by_joining_again() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let conversation = conversation(&mut a1, &mut b1);
    b1.send(&conversation, "áður");
    b1.sync();
    a1.deliver();

    for text in ["eitt", "tvö", "þrjú"] {
        a1.send(&conversation, text);
    }
    a1.sync();
    relay.expire(&conversation, 4);
    assert_eq!(
        b1.deliver(),
        vec![
            Event::Stale {
                conversation: conversation.clone()
            },
            Event::Joined {
                conversation: conversation.clone()
            },
        ]
    );
    assert_eq!(b1.client.conversations().unwrap()[0].state, State::Active);
    // Its history stays; what expired is not in it.
    assert_eq!(
        b1.history(&conversation),
        vec![("b".into(), "áður".into(), true)]
    );

    // The others see the same device in its new leaf, not a new one.
    let events = a1.deliver();
    assert!(devices(&events).is_empty());
    assert!(membership(&events).is_empty());
    a1.send(&conversation, "aftur");
    a1.sync();
    assert_eq!(texts(&b1.deliver()), strings(&["aftur"]));
    b1.send(&conversation, "takk");
    b1.sync();
    assert_eq!(texts(&a1.deliver()), strings(&["takk"]));
}

#[test]
fn a_device_registered_later_joins_by_external_commit() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let conversation = conversation(&mut a1, &mut b1);

    // The creator's account had no Welcome; the other account's Welcome
    // names devices it had then.
    let mut a2 = Phone::new(&relay, "a", "a2");
    let mut b2 = Phone::new(&relay, "b", "b2");
    a1.send(&conversation, "fyrir");
    a1.sync();
    for phone in [&mut a2, &mut b2] {
        let events = phone.deliver();
        assert_eq!(joined(&events), vec![conversation.clone()]);
        // Sent on the epoch it joined from.
        assert!(texts(&events).is_empty());
        assert_eq!(
            phone.client.conversations().unwrap()[0].state,
            State::Active
        );
    }

    let new = vec![("a".to_owned(), "a2".to_owned()), ("b".into(), "b2".into())];
    assert_eq!(devices(&a1.deliver()), new);
    assert_eq!(devices(&b1.deliver()), new);
    b1.send(&conversation, "velkomin");
    b1.sync();
    for phone in [&mut a1, &mut a2, &mut b2] {
        assert_eq!(texts(&phone.deliver()), strings(&["velkomin"]));
    }
    a2.send(&conversation, "takk");
    a2.sync();
    assert_eq!(texts(&b1.deliver()), strings(&["takk"]));
}

#[test]
fn a_join_whose_answer_was_lost_is_sent_again_as_the_same_bytes() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let conversation = conversation(&mut a1, &mut b1);
    let mut b2 = Phone::new(&relay, "b", "b2");
    a1.send(&conversation, "fyrir");
    a1.sync();
    let stored = relay.stored(&conversation);

    relay.lose_sends("b2", 1);
    for frame in relay.frames("b2") {
        assert!(matches!(
            b2.client.on_frame(&frame),
            Err(ClientError::Transport(ApiError::Unreachable(_)))
        ));
    }
    b2.reopen();
    assert_eq!(joined(&b2.sync()), vec![conversation.clone()]);
    let sends = relay.sends("b2");
    assert_eq!(sends.len(), 2);
    assert_eq!(sends[0], sends[1]);
    assert_eq!(relay.stored(&conversation), stored + 1);

    assert_eq!(devices(&a1.deliver()), vec![("b".into(), "b2".into())]);
    a1.send(&conversation, "eftir");
    a1.sync();
    assert_eq!(texts(&b2.deliver()), strings(&["eftir"]));
}

#[test]
fn a_join_that_lost_its_epoch_is_made_again() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let mut c1 = Phone::new(&relay, "c", "c1");
    let conversation = conversation(&mut a1, &mut b1);
    let mut b2 = Phone::new(&relay, "b", "b2");
    a1.send(&conversation, "fyrir");
    a1.sync();

    relay.fail_sends("b2", 1);
    for frame in relay.frames("b2") {
        assert!(b2.client.on_frame(&frame).is_err());
    }
    // Another commit takes the epoch the sealed join was made on.
    a1.client
        .add_accounts(&conversation, &strings(&["c"]))
        .unwrap();
    a1.sync();
    assert_eq!(joined(&c1.deliver()), vec![conversation.clone()]);

    // The sealed join is sent again, refused, and made from the newer
    // GroupInfo.
    assert_eq!(joined(&b2.deliver()), vec![conversation.clone()]);
    let sends = relay.sends("b2");
    assert_eq!(sends.len(), 2);
    assert_ne!(sends[0]["ciphertext"], sends[1]["ciphertext"]);

    assert_eq!(devices(&c1.deliver()), vec![("b".into(), "b2".into())]);
    c1.send(&conversation, "hæ");
    c1.sync();
    assert_eq!(texts(&b2.deliver()), strings(&["hæ"]));
}

#[test]
fn a_device_of_an_account_outside_the_conversation_does_not_join() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let mut c1 = Phone::new(&relay, "c", "c1");
    let conversation = conversation(&mut a1, &mut b1);

    let notify = format!(r#"{{"type":"notify","conversationId":"{conversation}","seq":1}}"#);
    assert!(c1.client.on_frame(&notify).unwrap().events.is_empty());
    assert!(c1.client.conversations().unwrap().is_empty());
    assert!(c1.sync().is_empty());
    assert!(relay.sends("c1").is_empty());
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

fn items(phone: &mut Phone, conversation: &str) -> Vec<Item> {
    phone.client.timeline(conversation, None, 100).unwrap()
}

/// The text of each item, `None` for one that is not text.
fn shown(items: &[Item]) -> Vec<Option<String>> {
    items
        .iter()
        .map(|i| match &i.content {
            Content::Text { text, .. } => Some(text.clone()),
            _ => None,
        })
        .collect()
}

#[test]
fn the_timeline_shows_each_message_as_it_now_is() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let conversation = conversation(&mut a1, &mut b1);

    let first = a1
        .client
        .send(
            &conversation,
            Body::Text {
                text: "fyrst".into(),
            },
        )
        .unwrap();
    let second = a1
        .client
        .send(
            &conversation,
            Body::Text {
                text: "annað".into(),
            },
        )
        .unwrap();
    a1.sync();
    b1.deliver();
    for body in [
        Body::Reply {
            to: first.clone(),
            text: "svar".into(),
        },
        Body::Reaction {
            target: first.clone(),
            emoji: "👍".into(),
            remove: false,
        },
        // Only a sender edits or deletes its own.
        Body::Edit {
            target: first.clone(),
            text: "b breytti".into(),
        },
        Body::Delete {
            target: second.clone(),
        },
    ] {
        b1.client.send(&conversation, body).unwrap();
    }
    b1.sync();
    a1.deliver();
    for body in [
        Body::Edit {
            target: first.clone(),
            text: "fyrst, lagað".into(),
        },
        Body::Delete {
            target: second.clone(),
        },
        Body::Reaction {
            target: first.clone(),
            emoji: "👍".into(),
            remove: false,
        },
    ] {
        a1.client.send(&conversation, body).unwrap();
    }
    a1.sync();
    b1.deliver();

    // The commit that made the conversation is no card: it starts with the
    // people it was made for (#68).
    assert!(
        !items(&mut a1, &conversation)
            .iter()
            .any(|i| matches!(i.content, Content::Members { .. }))
    );
    for phone in [&mut a1, &mut b1] {
        let mut items = items(phone, &conversation);
        items.retain(|i| i.envelope_id.is_some());
        assert_eq!(
            shown(&items),
            vec![Some("fyrst, lagað".into()), None, Some("svar".into())]
        );
        assert!(items[0].edited);
        assert_eq!(items[1].content, Content::Deleted);
        let Content::Text {
            reply_to: Some(quote),
            ..
        } = &items[2].content
        else {
            panic!("{:?}", items[2]);
        };
        assert_eq!(quote.text.as_deref(), Some("fyrst, lagað"));
        assert_eq!(quote.sender.as_ref().unwrap().account, "a");
        let reactions = &items[0].reactions;
        assert_eq!(reactions.len(), 1);
        assert_eq!(reactions[0].emoji, "👍");
        assert_eq!(reactions[0].people.len(), 2);
        assert!(reactions[0].own);
        assert!(items.iter().all(|i| i.status == Status::Sent));
    }
}

#[test]
fn unread_counts_and_read_markers_follow_the_toggle() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut a2 = Phone::new(&relay, "a", "a2");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let conversation = conversation(&mut a1, &mut b1);
    a2.deliver();

    b1.send(&conversation, "eitt");
    b1.send(&conversation, "tvö");
    b1.sync();
    a1.deliver();
    a2.deliver();
    assert_eq!(a1.client.conversations().unwrap()[0].unread, 2);
    let newest = items(&mut a1, &conversation).last().unwrap().seq.unwrap();

    a1.client.mark_read(&conversation, newest).unwrap();
    assert_eq!(a1.client.conversations().unwrap()[0].unread, 0);
    // Marking the same again queues nothing.
    a1.client.mark_read(&conversation, newest).unwrap();
    a1.sync();
    let events = b1.deliver();
    assert!(
        events
            .iter()
            .any(|e| matches!(e, Event::Timeline { changed, .. }
        if changed.len() == 2))
    );
    assert!(
        items(&mut b1, &conversation)
            .iter()
            .skip(1)
            .all(|i| i.read_by == 1)
    );
    // The receipt reads them on a's other device too.
    a2.deliver();
    assert_eq!(a2.client.conversations().unwrap()[0].unread, 0);

    // Off: no receipt goes, and none is shown.
    b1.client
        .set_settings(Settings {
            read_markers: false,
            typing: true,
        })
        .unwrap();
    assert!(!b1.client.settings().unwrap().read_markers);
    assert!(items(&mut b1, &conversation).iter().all(|i| i.read_by == 0));
    a1.send(&conversation, "þrjú");
    a1.sync();
    b1.deliver();
    let stored = relay.stored(&conversation);
    let newest = items(&mut b1, &conversation).last().unwrap().seq.unwrap();
    b1.client.mark_read(&conversation, newest).unwrap();
    b1.sync();
    assert_eq!(relay.stored(&conversation), stored);
    assert_eq!(b1.client.conversations().unwrap()[0].unread, 0);
}

#[test]
fn a_send_without_an_answer_shows_failed_until_retried() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let conversation = conversation(&mut a1, &mut b1);

    a1.send(&conversation, "bíður");
    let queued = items(&mut a1, &conversation);
    let last = queued.last().unwrap();
    assert_eq!((last.status, last.seq), (Status::Pending, None));
    assert_eq!(
        a1.client.conversations().unwrap()[0].last.as_ref(),
        Some(last)
    );

    relay.fail_sends("a1", 1);
    assert!(matches!(
        a1.client.sync(),
        Err(ClientError::Transport(ApiError::Unreachable(_)))
    ));
    assert_eq!(
        items(&mut a1, &conversation).last().unwrap().status,
        Status::Failed
    );

    let outcome = a1.client.retry(&conversation).unwrap();
    a1.forward(outcome.frames);
    let last = items(&mut a1, &conversation).pop().unwrap();
    assert_eq!(last.status, Status::Sent);
    assert!(last.seq.is_some());
    assert_eq!(texts(&b1.deliver()), strings(&["bíður"]));
}

#[test]
fn people_are_named_by_the_server() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let mut c1 = Phone::new(&relay, "c", "c1");
    assert!(a1.client.people().unwrap().is_empty());
    // Every account is in Fljótið, so c is named without sharing anything (0034).
    assert_eq!(
        a1.client.profile("c").unwrap().name.as_deref(),
        Some("Name of c")
    );

    let conversation = a1.client.create_conversation(&strings(&["b"])).unwrap();
    let events = a1.sync();
    // This account's own name too: its quotes and cards show it (#68).
    assert!(events.contains(&Event::Profiles {
        accounts: strings(&["a", "b"])
    }));
    b1.deliver();
    a1.send(&conversation, "hæ");
    a1.sync();
    let own = items(&mut a1, &conversation).pop().unwrap();
    assert!(own.own);
    assert_eq!(own.sender.name.as_deref(), Some("Name of a"));
    assert!(
        !relay
            .requests("a1")
            .iter()
            .any(|r| r.path == "/v1/accounts/a"),
        "the server names no one to themselves; /v1/me does"
    );
    let people = a1.client.people().unwrap();
    assert_eq!(people.len(), 1);
    assert_eq!(people[0].name.as_deref(), Some("Name of b"));
    assert!(people[0].verified);
    let listed = a1.client.conversations().unwrap();
    assert_eq!(listed[0].members, people);
    // Fetched once, then from the store.
    let asked = || {
        relay
            .requests("a1")
            .iter()
            .filter(|r| r.path == "/v1/accounts/b")
            .count()
    };
    assert_eq!(asked(), 1);
    a1.sync();
    assert_eq!(asked(), 1);

    a1.client
        .add_accounts(&conversation, &strings(&["c"]))
        .unwrap();
    a1.sync();
    c1.deliver();
    assert_eq!(
        a1.client.profile("c").unwrap().name.as_deref(),
        Some("Name of c")
    );
}

/// The conversation list is searched by the names in each title, at the
/// start of a word and without the Icelandic letters (0038), on this device
/// alone.
#[test]
fn conversations_are_found_by_the_start_of_a_name() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let mut c1 = Phone::new(&relay, "c", "c1");
    let with_b = conversation(&mut a1, &mut b1);
    let with_c = conversation(&mut a1, &mut c1);
    let mut store = spjall_store::Store::open(a1.dir.path(), &KEY).unwrap();
    store
        .write(|tx| {
            tx.execute(
                "UPDATE profiles SET name = 'Þórdís Ýr Ævarsdóttir' WHERE account = 'b'",
                [],
            )?;
            tx.execute(
                "UPDATE profiles SET name = 'Sóley Bergs-Guðnadóttir' WHERE account = 'c'",
                [],
            )
        })
        .unwrap();
    drop(store);
    let asked = relay.requests("a1").len();

    let found = |phone: &mut Phone, search: &str| -> Vec<String> {
        phone
            .client
            .search_conversations(search)
            .unwrap()
            .into_iter()
            .map(|c| c.id)
            .collect()
    };
    for (search, expected) in [
        ("thor", vec![with_b.clone()]),
        ("Þór", vec![with_b.clone()]),
        ("aevars", vec![with_b.clone()]),
        ("gudna", vec![with_c.clone()]),
        ("dottir", vec![]),
        ("  ", vec![with_c.clone(), with_b.clone()]),
    ] {
        assert_eq!(found(&mut a1, search), expected, "{search:?}");
    }
    assert!(matches!(
        a1.client.search_conversations(&"þ".repeat(101)),
        Err(ClientError::Invalid(_))
    ));
    assert_eq!(
        relay.requests("a1").len(),
        asked,
        "searched on the phone alone"
    );
}

#[test]
fn an_invite_opens_a_one_to_one_with_its_maker() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let link = a1.client.rotate_invite().unwrap();
    let token = spjall_client::invite_token(&link).unwrap();

    assert!(matches!(
        a1.client.open_invite(&token),
        Err(ClientError::Invalid(_))
    ));
    let one = b1.client.open_invite(&token).unwrap();
    b1.sync();
    assert_eq!(joined(&a1.deliver()), vec![one.clone()]);
    assert_eq!(b1.client.open_invite(&token).unwrap(), one);
    assert_eq!(
        a1.client.conversations().unwrap()[0].members[0].account,
        "b"
    );

    // A group with the inviter is not the 1:1.
    let mut c1 = Phone::new(&relay, "c", "c1");
    let group = conversation(&mut a1, &mut c1);
    a1.client.add_accounts(&group, &strings(&["b"])).unwrap();
    a1.sync();
    b1.deliver();
    assert_eq!(b1.client.open_invite(&token).unwrap(), one);
}

#[test]
fn anyone_in_fljotid_opens_a_one_to_one_without_a_link() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let mut c1 = Phone::new(&relay, "c", "c1");

    assert!(matches!(
        a1.client.open_direct("a"),
        Err(ClientError::Invalid(_))
    ));
    assert!(matches!(
        a1.client.open_direct("not an id"),
        Err(ClientError::Invalid(_))
    ));
    // b met a in Fljótið: no invite, no shared conversation before.
    let one = b1.client.open_direct("a").unwrap();
    b1.sync();
    assert_eq!(joined(&a1.deliver()), vec![one.clone()]);
    assert_eq!(b1.client.open_direct("a").unwrap(), one);
    // From the other side it is the same 1:1, not a second one.
    assert_eq!(a1.client.open_direct("b").unwrap(), one);
    a1.send(&one, "hæ");
    a1.sync();
    assert_eq!(texts(&b1.deliver()), vec!["hæ"]);

    // A group with both is not the 1:1.
    let group = conversation(&mut a1, &mut c1);
    a1.client.add_accounts(&group, &strings(&["b"])).unwrap();
    a1.sync();
    b1.deliver();
    assert_eq!(b1.client.open_direct("a").unwrap(), one);

    // Nor with an account this one blocked.
    c1.client.block("b").unwrap();
    assert!(matches!(
        c1.client.open_direct("b"),
        Err(ClientError::Invalid(_))
    ));
}

#[test]
fn fljotid_posts_replies_and_reactions_go_through_the_server() {
    use spjall_client::api::PostReaction;
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");

    assert!(a1.client.feed(None, 20).unwrap().posts.is_empty());
    assert!(matches!(
        a1.client.create_post("  \n "),
        Err(ClientError::Invalid(_))
    ));
    assert!(matches!(
        a1.client
            .create_post(&"þ".repeat(spjall_client::MAX_POST + 1)),
        Err(ClientError::Invalid(_))
    ));
    assert!(!relay.requests("a1").iter().any(|r| r.path == "/v1/posts"));

    let first = a1.client.create_post("Fyrsta færslan").unwrap();
    assert_eq!(first.author.account_id, "a");
    let second = b1.client.create_post("Önnur").unwrap();
    let third = a1.client.create_post("Þriðja").unwrap();

    // Newest first, paged by the cursor the server gives.
    let page = b1.client.feed(None, 2).unwrap();
    let ids: Vec<&str> = page.posts.iter().map(|p| p.post_id.as_str()).collect();
    assert_eq!(ids, vec![third.post_id.as_str(), second.post_id.as_str()]);
    let rest = b1.client.feed(page.next.as_deref(), 2).unwrap();
    assert_eq!(rest.posts.len(), 1);
    assert_eq!(rest.posts[0].post_id, first.post_id);
    assert_eq!(rest.next, None);
    // A page is never larger than 50.
    b1.client.feed(None, 500).unwrap();
    assert!(
        relay
            .requests("b1")
            .iter()
            .any(|r| r.path == "/v1/feed?limit=50")
    );

    // a's wall holds a's posts alone.
    let wall = b1.client.wall("a", None, 20).unwrap();
    assert_eq!(wall.posts.len(), 2);
    assert!(wall.posts.iter().all(|p| p.author.account_id == "a"));

    // One reaction per account, changed or taken back.
    b1.client
        .react_to_post(&first.post_id, Some(PostReaction::Heart))
        .unwrap();
    b1.client
        .react_to_post(&first.post_id, Some(PostReaction::Laugh))
        .unwrap();
    let seen = b1.client.post(&first.post_id).unwrap();
    assert_eq!(seen.my_reaction, Some(PostReaction::Laugh));
    assert_eq!((seen.reactions.heart, seen.reactions.laugh), (0, 1));
    assert_eq!(a1.client.post(&first.post_id).unwrap().my_reaction, None);
    b1.client.react_to_post(&first.post_id, None).unwrap();
    assert_eq!(b1.client.post(&first.post_id).unwrap().reactions.laugh, 0);

    let reply = b1.client.create_reply(&first.post_id, "Svar").unwrap();
    assert_eq!(a1.client.post(&first.post_id).unwrap().reply_count, 1);
    let replies = a1.client.replies(&first.post_id, None, 20).unwrap();
    assert_eq!(replies.replies[0].body, "Svar");
    assert!(matches!(
        a1.client.delete_reply(&reply.reply_id),
        Err(ClientError::Transport(ApiError::Refused {
            status: 403,
            ..
        }))
    ));
    b1.client.delete_reply(&reply.reply_id).unwrap();

    // Only the author deletes a post.
    assert!(matches!(
        b1.client.delete_post(&first.post_id),
        Err(ClientError::Transport(ApiError::Refused {
            status: 403,
            ..
        }))
    ));
    a1.client.delete_post(&first.post_id).unwrap();
    assert!(matches!(
        b1.client.post(&first.post_id),
        Err(ClientError::Transport(ApiError::Refused {
            status: 404,
            ..
        }))
    ));

    // A blocked account's posts are gone from the blocker's Fljótið.
    a1.client.block("b").unwrap();
    let page = a1.client.feed(None, 20).unwrap();
    assert!(page.posts.iter().all(|p| p.author.account_id == "a"));
}

#[test]
fn typing_is_sent_at_most_every_three_seconds_and_follows_the_toggle() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let conversation = conversation(&mut a1, &mut b1);

    assert!(a1.client.typing(&conversation, true).unwrap().is_some());
    assert!(a1.client.typing(&conversation, true).unwrap().is_none());
    assert!(a1.client.typing(&conversation, false).unwrap().is_some());
    let frame = a1.client.typing(&conversation, true).unwrap().unwrap();

    b1.client
        .set_settings(Settings {
            read_markers: true,
            typing: false,
        })
        .unwrap();
    a1.forward(vec![frame]);
    assert!(b1.deliver().is_empty());
    assert!(b1.client.typing(&conversation, true).unwrap().is_none());
}

#[test]
fn the_disappearing_timer_is_a_card_and_stamps_what_follows() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let conversation = conversation(&mut a1, &mut b1);

    a1.client
        .send(
            &conversation,
            Body::Disappearing {
                seconds: Some(3600),
            },
        )
        .unwrap();
    a1.send(&conversation, "hverfur");
    a1.sync();
    b1.deliver();
    for phone in [&mut a1, &mut b1] {
        assert_eq!(phone.client.conversations().unwrap()[0].timer, Some(3600));
        let items = items(phone, &conversation);
        let [.., card, message] = items.as_slice() else {
            panic!("{items:?}");
        };
        assert_eq!(
            card.content,
            Content::Timer {
                seconds: Some(3600)
            }
        );
        assert_eq!(card.sender.account, "a");
        assert!(card.expires_at.is_none());
        assert!(message.expires_at.is_some());
    }
}

/// The files in a phone's media folder, sorted.
fn media_files(phone: &Phone) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(phone.dir.path().join("media")) else {
        return Vec::new();
    };
    let mut names: Vec<String> = entries
        .flatten()
        .filter(|e| e.path().is_file())
        .map(|e| e.file_name().into_string().unwrap())
        .collect();
    names.sort();
    names
}

fn media_gets(relay: &Relay, device: &str) -> usize {
    relay
        .requests(device)
        .iter()
        .filter(|r| r.path.contains("/media/") && r.method == spjall_client::api::Method::Get)
        .count()
}

/// A photo of some size that crosses a segment edge, written to a file.
fn photo(dir: &TempDir) -> (std::path::PathBuf, Vec<u8>) {
    let bytes: Vec<u8> = (0..70_000u32).map(|i| (i % 251) as u8).collect();
    let path = dir.path().join("mynd.png");
    std::fs::write(&path, &bytes).unwrap();
    (path, bytes)
}

#[test]
fn a_photo_is_sealed_before_it_leaves_and_opens_on_the_other_side() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let conversation = conversation(&mut a1, &mut b1);
    let files = tempfile::tempdir().unwrap();
    let (path, bytes) = photo(&files);

    a1.client
        .send_media(
            &conversation,
            &path,
            "image/png",
            Some("sólarlag".into()),
            // A name is a name: a path in it is cut away on both sides (#68).
            Some("../../sólarlag.png".into()),
        )
        .unwrap();
    // The server holds a blob that is not the photo and does not contain it.
    let blobs = relay.media(&conversation);
    assert_eq!(blobs.len(), 1);
    assert_eq!(blobs[0].len(), bytes.len() + 2 * 16);
    assert!(!blobs[0].windows(64).any(|w| w == &bytes[..64]));
    a1.sync();
    b1.deliver();

    for phone in [&mut a1, &mut b1] {
        let item = items(phone, &conversation).pop().unwrap();
        assert_eq!(
            item.content,
            Content::Media {
                mime: "image/png".into(),
                size: bytes.len() as u64,
                caption: Some("sólarlag".into()),
                name: Some("sólarlag.png".into()),
            }
        );
        let file = phone
            .client
            .media(&conversation, item.seq.unwrap())
            .unwrap();
        assert_eq!(std::fs::read(&file).unwrap(), bytes);
        assert_eq!(file.extension().unwrap(), "png");
        // Kept: asked for again, it is not fetched again.
        assert_eq!(
            phone
                .client
                .media(&conversation, item.seq.unwrap())
                .unwrap(),
            file
        );
    }
    // The sender kept its own copy and fetched nothing; the other side once.
    assert_eq!(media_gets(&relay, "a1"), 0);
    assert_eq!(media_gets(&relay, "b1"), 1);
    // Nothing is left over from sealing or opening.
    assert_eq!(media_files(&a1).len(), 1);
    assert_eq!(media_files(&b1).len(), 1);
}

#[test]
fn a_tampered_blob_is_refused_and_leaves_no_file() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let conversation = conversation(&mut a1, &mut b1);
    let files = tempfile::tempdir().unwrap();
    let (path, _) = photo(&files);
    a1.client
        .send_media(&conversation, &path, "image/png", None, None)
        .unwrap();
    a1.sync();
    b1.deliver();

    relay.tamper_media();
    let seq = items(&mut b1, &conversation).pop().unwrap().seq.unwrap();
    assert!(matches!(
        b1.client.media(&conversation, seq),
        Err(ClientError::Media(MediaError::Tampered))
    ));
    assert!(media_files(&b1).is_empty());
    // An item that is not media has no file.
    b1.send(&conversation, "texti");
    b1.sync();
    let text = items(&mut b1, &conversation).pop().unwrap().seq.unwrap();
    assert!(matches!(
        b1.client.media(&conversation, text),
        Err(ClientError::Invalid(_))
    ));
}

#[test]
fn a_file_over_25_mb_is_refused_before_anything_is_sent() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let conversation = conversation(&mut a1, &mut b1);
    let files = tempfile::tempdir().unwrap();
    let path = files.path().join("stórt.bin");
    std::fs::File::create(&path)
        .unwrap()
        .set_len(spjall_client::MAX_SIZE + 1)
        .unwrap();
    assert!(matches!(
        a1.client
            .send_media(&conversation, &path, "application/zip", None, None),
        Err(ClientError::Media(MediaError::TooLarge))
    ));
    assert!(relay.media(&conversation).is_empty());
    assert!(media_files(&a1).is_empty());
}

#[test]
fn what_disappears_is_deleted_with_its_file() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let conversation = conversation(&mut a1, &mut b1);
    a1.send(&conversation, "stays");
    a1.client
        .send(&conversation, Body::Disappearing { seconds: Some(1) })
        .unwrap();
    a1.sync();
    b1.deliver();
    let files = tempfile::tempdir().unwrap();
    let (path, _) = photo(&files);
    a1.client
        .send_media(&conversation, &path, "image/png", None, None)
        .unwrap();
    a1.send(&conversation, "goes");
    a1.sync();
    b1.deliver();
    let seqs: Vec<u64> = items(&mut b1, &conversation)
        .iter()
        .rev()
        .take(2)
        .map(|i| i.seq.unwrap())
        .rev()
        .collect();
    b1.client.media(&conversation, seqs[0]).unwrap();
    assert_eq!(media_files(&b1).len(), 1);

    std::thread::sleep(std::time::Duration::from_millis(1100));
    for phone in [&mut a1, &mut b1] {
        let outcome = phone.client.expire().unwrap();
        assert_eq!(
            outcome.events,
            vec![Event::Expired {
                conversation: conversation.clone(),
                removed: seqs.clone(),
            }]
        );
        assert!(media_files(phone).is_empty());
        // The text sent before the timer and the timer card stay.
        let left = items(phone, &conversation);
        assert!(
            left.iter()
                .all(|i| i.seq.is_none_or(|s| !seqs.contains(&s)))
        );
        assert_eq!(
            shown(&left).into_iter().flatten().collect::<Vec<_>>(),
            strings(&["stays"])
        );
        assert_eq!(phone.client.expire().unwrap().events, Vec::new());
        assert_eq!(
            phone
                .client
                .history(&conversation, None, 100)
                .unwrap()
                .iter()
                .filter(|m| matches!(m.envelope.body, Body::Text { .. } | Body::Media { .. }))
                .count(),
            1
        );
    }
}

#[test]
fn a_block_ends_the_one_to_one_and_hides_the_group_but_the_group_goes_on() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let mut c1 = Phone::new(&relay, "c", "c1");
    let one = conversation(&mut a1, &mut b1);
    let group = a1
        .client
        .create_conversation(&strings(&["b", "c"]))
        .unwrap();
    a1.sync();
    b1.deliver();
    c1.deliver();

    assert!(matches!(a1.client.block("a"), Err(ClientError::Invalid(_))));
    let outcome = a1.client.block("b").unwrap();
    assert_eq!(
        membership(&outcome.events),
        vec![(Vec::new(), strings(&["b"]))]
    );
    // Blocking again changes nothing and sends nothing.
    assert!(a1.client.block("b").unwrap().events.is_empty());
    let blocked = a1.client.blocked().unwrap();
    assert_eq!(blocked.len(), 1);
    assert_eq!(
        (blocked[0].account.as_str(), blocked[0].name.as_deref()),
        ("b", Some("Name of b"))
    );
    assert!(classic(b1.deliver()).contains(&Event::Removed {
        conversation: one.clone()
    }));

    // In the group `b` still writes; `a` reads past it without showing it.
    b1.send(&group, "frá b");
    b1.sync();
    let events = a1.deliver();
    assert!(texts(&events).is_empty(), "{events:?}");
    assert!(
        !events
            .iter()
            .any(|e| matches!(e, Event::Timeline { conversation, .. } if *conversation == group))
    );
    assert_eq!(texts(&c1.deliver()), strings(&["frá b"]));
    let listed = a1.client.conversations().unwrap();
    let listed = listed.iter().find(|c| c.id == group).unwrap();
    assert_eq!(listed.unread, 0);
    assert!(a1.history(&group).is_empty());
    // A reaction from `b` does not reach the fold either.
    let from_c = {
        c1.send(&group, "frá c");
        c1.sync();
        assert_eq!(texts(&a1.deliver()), strings(&["frá c"]));
        items(&mut a1, &group).pop().unwrap()
    };
    b1.deliver();
    b1.client
        .send(
            &group,
            Body::Reaction {
                target: from_c.envelope_id.clone().unwrap(),
                emoji: "👍".into(),
                remove: false,
            },
        )
        .unwrap();
    b1.sync();
    a1.deliver();
    assert!(items(&mut a1, &group).pop().unwrap().reactions.is_empty());

    // Lifted: what `b` writes now shows; what it wrote before stays hidden.
    a1.client.unblock("b").unwrap();
    assert!(a1.client.blocked().unwrap().is_empty());
    b1.send(&group, "aftur");
    b1.sync();
    assert_eq!(texts(&a1.deliver()), strings(&["aftur"]));
    assert_eq!(
        shown(&items(&mut a1, &group))
            .into_iter()
            .flatten()
            .collect::<Vec<_>>(),
        strings(&["frá c", "aftur"])
    );
    // The 1:1 stays ended.
    let one = a1.client.conversations().unwrap();
    assert!(
        one.iter()
            .all(|c| c.members.len() != 1 || c.members[0].account != "b" || c.id == group)
    );
}

#[test]
fn a_blocked_account_cannot_reach_the_blocker_again() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    conversation(&mut a1, &mut b1);
    a1.client.block("b").unwrap();
    b1.deliver();
    b1.client.create_conversation(&strings(&["a"])).unwrap();
    // The refusal keeps the id the server gave the request (0037).
    assert!(matches!(
        b1.client.sync(),
        Err(ClientError::Transport(ApiError::Refused {
            status: 403,
            request_id: Some(ref id),
            ..
        })) if id.starts_with("relay-")
    ));
    // A block set on another device of the same account is taken up by sync.
    let mut a2 = Phone::new(&relay, "a", "a2");
    a2.sync();
    assert_eq!(a2.client.blocked().unwrap()[0].account, "b");
}

fn urgency(relay: &Relay, device: &str) -> Vec<bool> {
    relay
        .sends(device)
        .iter()
        .map(|body| body["urgent"].as_bool().unwrap())
        .collect()
}

#[test]
fn only_a_new_text_reply_or_file_is_urgent() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let conversation = conversation(&mut a1, &mut b1);
    // The commit that made the conversation.
    assert_eq!(urgency(&relay, "a1"), vec![false]);

    let first = a1
        .client
        .send(
            &conversation,
            Body::Text {
                text: "eitt".into(),
            },
        )
        .unwrap();
    a1.sync();
    let files = tempfile::tempdir().unwrap();
    let (path, _) = photo(&files);
    a1.client
        .send_media(&conversation, &path, "image/png", None, None)
        .unwrap();
    for body in [
        Body::Reply {
            to: first.clone(),
            text: "svar".into(),
        },
        Body::Edit {
            target: first.clone(),
            text: "eitt!".into(),
        },
        Body::Reaction {
            target: first.clone(),
            emoji: "👍".into(),
            remove: false,
        },
        Body::Delete { target: first },
        Body::Disappearing { seconds: Some(60) },
    ] {
        a1.client.send(&conversation, body).unwrap();
    }
    a1.sync();
    b1.deliver();
    let newest = items(&mut b1, &conversation).last().unwrap().seq.unwrap();
    b1.client.mark_read(&conversation, newest).unwrap();
    b1.sync();

    assert_eq!(
        urgency(&relay, "a1"),
        vec![false, true, true, true, false, false, false, false]
    );
    // The receipt.
    assert_eq!(urgency(&relay, "b1"), vec![false]);
}

#[test]
fn a_push_token_reaches_the_server_once_and_again_when_it_changes() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let puts = |relay: &Relay| {
        relay
            .requests("a1")
            .iter()
            .filter(|r| r.path == "/v1/devices/a1/push")
            .count()
    };
    assert!(matches!(
        a1.client.set_push_token("", false),
        Err(ClientError::Invalid(_))
    ));

    a1.client.set_push_token("fcm-1", false).unwrap();
    assert_eq!(relay.push_token("a1"), None);
    // The blocks list, then the token, never reach the server.
    relay.fail_next("a1", 2);
    a1.sync();
    assert_eq!(relay.push_token("a1"), None);
    a1.sync();
    assert_eq!(relay.push_token("a1"), Some(("fcm-1".into(), false)));

    // The same token on the next launch is not sent again.
    a1.reopen();
    a1.client.set_push_token("fcm-1", false).unwrap();
    a1.sync();
    assert_eq!(puts(&relay), 1);

    a1.client.set_push_token("apns-1", true).unwrap();
    a1.sync();
    assert_eq!(relay.push_token("a1"), Some(("apns-1".into(), true)));
    assert_eq!(puts(&relay), 2);
}

/// `(conversation, sender, kind, text)` of each notice shown.
type Shown = Vec<(String, String, NoticeKind, Option<String>)>;

fn notices(phone: &mut Phone) -> (Shown, Vec<String>) {
    let notices = phone.client.notices().unwrap();
    let shown = notices
        .shown
        .into_iter()
        .map(|n| (n.conversation, n.sender.account, n.kind, n.text))
        .collect();
    (shown, notices.cleared)
}

#[test]
fn a_new_message_is_noticed_once_and_cleared_when_read_anywhere() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut a2 = Phone::new(&relay, "a", "a2");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let conversation = conversation(&mut b1, &mut a1);
    a2.deliver();
    b1.client.notices().unwrap();
    // Nothing yet: the commit that made it is no message.
    assert_eq!(notices(&mut a1), (Vec::new(), Vec::new()));
    // Sent before b's messages: sending reads up to it, not past.
    a1.send(&conversation, "mitt eigið");
    a1.sync();

    let first = b1
        .client
        .send(&conversation, Body::Text { text: "hæ".into() })
        .unwrap();
    let files = tempfile::tempdir().unwrap();
    let (path, _) = photo(&files);
    b1.client
        .send_media(&conversation, &path, "image/png", Some("mynd".into()), None)
        .unwrap();
    b1.sync();
    a1.deliver();

    let (shown, cleared) = notices(&mut a1);
    assert_eq!(
        shown,
        vec![
            (
                conversation.clone(),
                "b".into(),
                NoticeKind::Text,
                Some("hæ".into())
            ),
            (
                conversation.clone(),
                "b".into(),
                NoticeKind::Photo,
                Some("mynd".into())
            ),
        ]
    );
    assert!(cleared.is_empty());
    let notice = &a1.client.notices().unwrap();
    assert!(notice.shown.is_empty());

    // An edit or a reaction is no new message.
    b1.client
        .send(
            &conversation,
            Body::Edit {
                target: first.clone(),
                text: "halló".into(),
            },
        )
        .unwrap();
    b1.client
        .send(
            &conversation,
            Body::Reaction {
                target: first,
                emoji: "👋".into(),
                remove: false,
            },
        )
        .unwrap();
    b1.sync();
    a1.deliver();
    assert_eq!(notices(&mut a1), (Vec::new(), Vec::new()));

    // Read on the other device: a1 takes its notification away, once.
    a2.deliver();
    let newest = items(&mut a2, &conversation).last().unwrap().seq.unwrap();
    a2.client.mark_read(&conversation, newest).unwrap();
    a2.sync();
    a1.deliver();
    assert_eq!(notices(&mut a1), (Vec::new(), vec![conversation.clone()]));
    assert_eq!(notices(&mut a1), (Vec::new(), Vec::new()));

    // The other device saw nothing it had not been shown, and read it.
    assert_eq!(notices(&mut a2), (Vec::new(), Vec::new()));
}

#[test]
fn no_notice_for_a_blocked_account_an_expired_message_or_one_read_already() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let mut c1 = Phone::new(&relay, "c", "c1");
    let group = a1
        .client
        .create_conversation(&strings(&["b", "c"]))
        .unwrap();
    a1.sync();
    b1.deliver();
    c1.deliver();
    a1.client.block("c").unwrap();

    c1.send(&group, "frá c");
    c1.sync();
    b1.send(&group, "frá b");
    b1.sync();
    a1.deliver();
    let (shown, _) = notices(&mut a1);
    assert_eq!(
        shown,
        vec![(
            group.clone(),
            "b".into(),
            NoticeKind::Text,
            Some("frá b".into())
        )]
    );

    // Read before any notice was asked for: never shown.
    b1.send(&group, "lesið");
    b1.sync();
    a1.deliver();
    let newest = items(&mut a1, &group).last().unwrap().seq.unwrap();
    a1.client.mark_read(&group, newest).unwrap();
    let (shown, cleared) = notices(&mut a1);
    assert!(shown.is_empty());
    assert_eq!(cleared, vec![group.clone()]);

    // Gone before it was asked for.
    b1.client
        .send(&group, Body::Disappearing { seconds: Some(1) })
        .unwrap();
    b1.send(&group, "hverfur");
    b1.sync();
    a1.deliver();
    std::thread::sleep(std::time::Duration::from_millis(1100));
    assert_eq!(notices(&mut a1), (Vec::new(), Vec::new()));
}

#[test]
fn the_directory_lists_every_other_account_without_blocks() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let _c1 = Phone::new(&relay, "c", "c1");
    let _d1 = Phone::new(&relay, "d", "d1");

    // Everyone but the reader, a page at a time (0036).
    let page = a1.client.directory(None, None, 2).unwrap();
    let ids: Vec<&str> = page.people.iter().map(|p| p.account.as_str()).collect();
    assert_eq!(ids, vec!["b", "c"]);
    assert_eq!(page.people[0].name.as_deref(), Some("Name of b"));
    let rest = a1.client.directory(None, page.next.as_deref(), 2).unwrap();
    assert_eq!(rest.people.len(), 1);
    assert_eq!(rest.people[0].account, "d");
    assert_eq!(rest.next, None);

    // A search goes trimmed, a blank one not at all, and a page is never
    // larger than 50.
    let found = a1.client.directory(Some("  B "), None, 500).unwrap();
    assert_eq!(found.people.len(), 1);
    a1.client.directory(Some("   "), None, 0).unwrap();
    let paths: Vec<String> = relay
        .requests("a1")
        .iter()
        .map(|r| r.path.clone())
        .collect();
    assert!(paths.contains(&"/v1/people?q=B&limit=50".to_owned()));
    assert!(paths.contains(&"/v1/people?limit=1".to_owned()));
    assert!(matches!(
        a1.client
            .directory(Some(&"þ".repeat(spjall_client::MAX_QUERY + 1)), None, 20),
        Err(ClientError::Invalid(_))
    ));

    // Blocks hold both ways.
    a1.client.block("c").unwrap();
    let ids: Vec<String> = a1
        .client
        .directory(None, None, 20)
        .unwrap()
        .people
        .into_iter()
        .map(|p| p.account)
        .collect();
    assert_eq!(ids, vec!["b", "d"]);
    let seen_by_b: Vec<String> = b1
        .client
        .directory(None, None, 20)
        .unwrap()
        .people
        .into_iter()
        .map(|p| p.account)
        .collect();
    assert_eq!(seen_by_b, vec!["a", "c", "d"]);
}
