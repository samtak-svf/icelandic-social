//! The sync engine against the in-memory relay: devices with their own store
//! files, talking only through requests and socket frames.

#![allow(clippy::disallowed_methods)] // tests use files

#[path = "support/relay.rs"]
#[allow(dead_code)]
mod relay;

use std::sync::Arc;

use relay::{Link, Relay};
use spjall_client::api::{ApiError, Platform, Provider};
use spjall_client::frames::{Focus, Frame, FrameRect, Framing};
use spjall_client::{
    Client, ClientError, Content, Event, HistoryError, Imported, Item, LinkCode, LinkError,
    MediaError, Mute, MuteFor, NoticeKind, Settings, State, Status, Unforwardable, history_key,
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
            .send(
                conversation,
                Body::Text {
                    text: text.into(),
                    forwarded: false,
                },
            )
            .unwrap();
    }

    /// `(sender account, text, own)` for the whole history.
    fn history(&mut self, conversation: &str) -> Vec<(String, String, bool)> {
        self.client
            .history(conversation, None, 100)
            .unwrap()
            .into_iter()
            .map(|m| {
                let Body::Text { text, .. } = m.envelope.body else {
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

/// After a send the app syncs the chat on screen alone (0099): its outbox
/// goes out and nothing is asked of any other conversation.
#[test]
fn syncing_one_conversation_touches_only_that_one() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let mut c1 = Phone::new(&relay, "c", "c1");
    let with_b = conversation(&mut a1, &mut b1);
    let with_c = conversation(&mut a1, &mut c1);

    a1.send(&with_b, "til b");
    a1.send(&with_c, "til c");
    let asked = relay.requests("a1").len();
    let outcome = a1.client.sync_conversation(&with_b).unwrap();
    assert_eq!(texts(&outcome.events), strings(&["til b"]));
    assert_eq!(relay.stored(&with_b), 2);
    assert_eq!(relay.stored(&with_c), 1, "the other chat's outbox waits");

    let paths: Vec<String> = relay.requests("a1")[asked..]
        .iter()
        .map(|r| r.path.clone())
        .collect();
    assert!(!paths.is_empty());
    for path in &paths {
        assert!(
            path.starts_with(&format!("/v1/conversations/{with_b}/")),
            "{path}"
        );
    }

    // The full sync still sends the rest.
    a1.sync();
    assert_eq!(relay.stored(&with_c), 2);
    assert!(matches!(
        a1.client.sync_conversation("nope"),
        Err(ClientError::UnknownConversation)
    ));
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
        b1.client.send(
            &conversation,
            Body::Text {
                text: "?".into(),
                forwarded: false
            }
        ),
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

/// A token the server no longer answers, as after the device was revoked
/// or its account deleted elsewhere: the next sync forgets the store and
/// says it is not registered (0057), with or without a conversation to sync.
#[test]
fn a_dead_token_signs_the_device_out_on_sync() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let mut c1 = Phone::new(&relay, "c", "c1");
    let conversation = conversation(&mut a1, &mut b1);
    a1.send(&conversation, "fyrir");
    a1.sync();
    b1.deliver();
    relay.revoke("b1");
    relay.revoke("c1");

    for phone in [&mut b1, &mut c1] {
        assert!(matches!(
            phone.client.sync(),
            Err(ClientError::NotRegistered)
        ));
        assert!(phone.client.signed_in().unwrap().is_none());
        assert!(phone.client.conversations().unwrap().is_empty());
    }
}

/// A frame that sends the device to the server, here one that came just
/// before the socket closed, finds its token dead the same way (0057).
#[test]
fn a_dead_token_signs_the_device_out_on_a_frame() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let conversation = conversation(&mut a1, &mut b1);
    relay.revoke("b1");

    let frame = format!(r#"{{"type":"notify","conversationId":"{conversation}","seq":99}}"#);
    assert!(matches!(
        b1.client.on_frame(&frame),
        Err(ClientError::NotRegistered)
    ));
    assert!(b1.client.signed_in().unwrap().is_none());
    assert!(b1.client.conversations().unwrap().is_empty());
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
        Err(ClientError::Transport(ApiError::ClientTooOld { min, .. })) if min == "0.3.0"
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

/// One conversation the server refuses holds up neither the conversations
/// after it nor the steps after them; its join waits an hour.
#[test]
fn a_refused_join_holds_up_no_other_conversation() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let mut c1 = Phone::new(&relay, "c", "c1");
    let first = conversation(&mut a1, &mut b1);
    std::thread::sleep(std::time::Duration::from_millis(5));
    let later = conversation(&mut b1, &mut c1);

    // The first goes stale for b1 while its socket is closed.
    for text in ["eitt", "tvö", "þrjú"] {
        a1.send(&first, text);
    }
    a1.sync();
    relay.expire(&first, 3);
    relay.frames("b1");

    b1.send(&later, "kemst samt");
    relay.refuse_sends("b1", 1);
    let asked = |path: &str| {
        relay
            .requests("b1")
            .iter()
            .filter(|r| r.path == path)
            .count()
    };
    let joins = || asked(&format!("/v1/conversations/{first}/messages"));
    let listed = asked("/v1/mutes");
    b1.sync();
    assert_eq!(joins(), 1);
    assert_eq!(texts(&c1.deliver()), strings(&["kemst samt"]));
    assert_eq!(asked("/v1/mutes"), listed + 1);
    let state = |b1: &mut Phone| {
        b1.client
            .conversations()
            .unwrap()
            .into_iter()
            .find(|c| c.id == first)
            .unwrap()
            .state
    };
    assert_eq!(state(&mut b1), State::Stale);

    // Not tried again until an hour has passed.
    b1.sync();
    assert_eq!(joins(), 1);
    let mut store = spjall_store::Store::open(b1.dir.path(), &KEY).unwrap();
    store
        .write(|tx| {
            tx.execute(
                "UPDATE conversations SET join_refused_at = join_refused_at - 3600000",
                [],
            )
        })
        .unwrap();
    assert_eq!(joined(&b1.sync()), vec![first.clone()]);
    assert_eq!(state(&mut b1), State::Active);
}

/// A send the server refuses as malformed would be refused again: it shows
/// failed, the messages behind it go, and `retry` sends it anew.
#[test]
fn a_refused_message_shows_failed_and_holds_up_nothing() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let conversation = conversation(&mut a1, &mut b1);

    a1.send(&conversation, "hafnað");
    relay.refuse_sends("a1", 1);
    a1.sync();
    assert_eq!(
        items(&mut a1, &conversation).last().unwrap().status,
        Status::Failed
    );

    a1.send(&conversation, "næst");
    let sent = relay.sends("a1").len();
    assert_eq!(texts(&a1.sync()), strings(&["næst"]));
    assert_eq!(relay.sends("a1").len(), sent + 1, "the refused one waits");
    // What has gone first, then what has not.
    let statuses: Vec<Status> = items(&mut a1, &conversation)
        .iter()
        .rev()
        .take(2)
        .map(|i| i.status)
        .collect();
    assert_eq!(statuses, vec![Status::Failed, Status::Sent]);
    assert_eq!(texts(&b1.deliver()), strings(&["næst"]));

    // A retry the server refuses names its request (0037).
    relay.refuse_sends("a1", 1);
    match a1.client.retry(&conversation) {
        Err(ClientError::Transport(error @ ApiError::Refused { status: 400, .. })) => {
            assert!(error.request_id().is_some());
        }
        other => panic!("{other:?}"),
    }
    let outcome = a1.client.retry(&conversation).unwrap();
    a1.forward(outcome.frames);
    assert!(
        items(&mut a1, &conversation)
            .iter()
            .all(|i| i.status == Status::Sent)
    );
    assert_eq!(texts(&b1.deliver()), strings(&["hafnað"]));
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
                forwarded: false,
            },
        )
        .unwrap();
    let second = a1
        .client
        .send(
            &conversation,
            Body::Text {
                text: "annað".into(),
                forwarded: false,
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

/// Reacts as `phone` to the message `target`.
fn react(phone: &mut Phone, conversation: &str, target: &str, emoji: &str, remove: bool) {
    phone
        .client
        .send(
            conversation,
            Body::Reaction {
                target: target.into(),
                emoji: emoji.into(),
                remove,
            },
        )
        .unwrap();
}

/// What each reaction on the newest item reads as: emoji and who.
fn reactions_of(phone: &mut Phone, conversation: &str) -> Vec<(String, Vec<String>, bool)> {
    items(phone, conversation)
        .pop()
        .unwrap()
        .reactions
        .into_iter()
        .map(|r| {
            (
                r.emoji,
                r.people.into_iter().map(|p| p.account).collect(),
                r.own,
            )
        })
        .collect()
}

/// One message from `b`, delivered to `a1`, with its envelope id.
fn one_message() -> (Arc<Relay>, Phone, Phone, String, String) {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let chat = conversation(&mut a1, &mut b1);
    b1.send(&chat, "hæ");
    b1.sync();
    a1.deliver();
    let id = items(&mut a1, &chat).pop().unwrap().envelope_id.unwrap();
    (relay, a1, b1, chat, id)
}

#[test]
fn a_new_reaction_replaces_the_earlier_one_on_every_device() {
    let relay = Relay::new();
    let (mut a1, mut a2, mut b1, chat) = with_a_sibling(&relay);
    b1.send(&chat, "hæ");
    b1.sync();
    a1.deliver();
    a2.deliver();
    let id = items(&mut a1, &chat).pop().unwrap().envelope_id.unwrap();
    react(&mut a1, &chat, &id, "👍", false);
    a1.sync();
    react(&mut a1, &chat, &id, "❤️", false);
    a1.sync();
    b1.deliver();
    a2.deliver();
    for phone in [&mut a1, &mut b1, &mut a2] {
        let own = phone.account == "a";
        assert_eq!(
            reactions_of(phone, &chat),
            vec![("❤️".to_string(), vec!["a".to_string()], own)]
        );
    }
}

#[test]
fn a_replacing_reaction_shows_at_once_before_any_sync() {
    let (_relay, mut a1, _b1, chat, id) = one_message();
    react(&mut a1, &chat, &id, "👍", false);
    react(&mut a1, &chat, &id, "❤️", false);
    assert_eq!(
        reactions_of(&mut a1, &chat),
        vec![("❤️".to_string(), vec!["a".to_string()], true)]
    );
    // Another person's reaction on the same message is left alone.
    a1.sync();
    assert_eq!(reactions_of(&mut a1, &chat).len(), 1);
}

#[test]
fn a_replacing_reaction_queues_the_old_one_taken_back_first() {
    let (relay, mut a1, _b1, chat, id) = one_message();
    let stored = relay.stored(&chat);
    // Nothing shown yet: the add goes alone.
    react(&mut a1, &chat, &id, "👍", false);
    a1.sync();
    assert_eq!(relay.stored(&chat), stored + 1);
    // Shown from the fold: a take-back and the add.
    react(&mut a1, &chat, &id, "❤️", false);
    a1.sync();
    assert_eq!(relay.stored(&chat), stored + 3);
    // Still queued, not folded: the queued add is replaced too.
    react(&mut a1, &chat, &id, "😂", false);
    react(&mut a1, &chat, &id, "🎉", false);
    a1.sync();
    assert_eq!(relay.stored(&chat), stored + 3 + 2 + 2);
    // The same emoji again adds only itself.
    react(&mut a1, &chat, &id, "🎉", false);
    a1.sync();
    assert_eq!(relay.stored(&chat), stored + 3 + 2 + 2 + 1);
}

#[test]
fn taking_back_the_current_reaction_leaves_none() {
    let (_relay, mut a1, mut b1, chat, id) = one_message();
    react(&mut a1, &chat, &id, "👍", false);
    react(&mut a1, &chat, &id, "❤️", false);
    a1.sync();
    b1.deliver();
    react(&mut a1, &chat, &id, "❤️", true);
    assert!(reactions_of(&mut a1, &chat).is_empty());
    a1.sync();
    b1.deliver();
    assert!(reactions_of(&mut a1, &chat).is_empty());
    assert!(reactions_of(&mut b1, &chat).is_empty());
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
    // Every account is named to every signed-in one, without sharing
    // anything (0034, 0036).
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

/// The list's search shows a person once (0038): someone whose 1:1 the
/// conversations found is left out of the people from the directory, and
/// someone met only in a group is not.
#[test]
fn the_list_search_shows_no_one_twice() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let mut c1 = Phone::new(&relay, "c", "c1");
    let _d1 = Phone::new(&relay, "d", "d1");
    let with_b = conversation(&mut a1, &mut b1);
    let group = a1
        .client
        .create_conversation(&strings(&["c", "d"]))
        .unwrap();
    a1.sync();
    c1.deliver();

    let found = a1.client.search_list("name", 20).unwrap();
    let ids: Vec<&str> = found.conversations.iter().map(|c| c.id.as_str()).collect();
    assert_eq!(ids, vec![group.as_str(), with_b.as_str()]);
    let people: Vec<&str> = found.people.iter().map(|p| p.account.as_str()).collect();
    assert_eq!(people, vec!["c", "d"], "b is reached through the 1:1 above");

    // A blank search is the list itself and asks the directory nothing.
    let asked = relay.requests("a1").len();
    let blank = a1.client.search_list("  ", 20).unwrap();
    assert_eq!(blank.conversations.len(), 2);
    assert!(blank.people.is_empty());
    assert_eq!(relay.requests("a1").len(), asked);
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
    // b found a by name (0036): no invite, no shared conversation before.
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

/// 0044: a post shared under 0040 still reads as its id. The item, the
/// list's last line and the notice name nothing of the post, and nothing
/// asks the server for it: the posts are deleted.
#[test]
fn a_shared_post_from_before_0044_reads_as_its_id_and_asks_the_server_nothing() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let conversation = conversation(&mut b1, &mut a1);
    b1.client.notices().unwrap();

    for bad in ["", "../posts", "a b"] {
        assert!(matches!(
            b1.client.send(
                &conversation,
                Body::Post {
                    post_id: bad.into(),
                    forwarded: false,
                }
            ),
            Err(ClientError::Invalid(_))
        ));
    }
    let shared = Content::Post {
        post_id: "post_0001".into(),
    };
    // b shares a post by its id (0080).
    b1.client
        .send(
            &conversation,
            Body::Post {
                post_id: "post_0001".into(),
                forwarded: false,
            },
        )
        .unwrap();
    b1.sync();
    a1.deliver();

    let item = items(&mut a1, &conversation).pop().unwrap();
    assert_eq!(item.content, shared);
    let listed = a1.client.conversations().unwrap().pop().unwrap();
    assert_eq!(listed.last.as_ref().map(|i| &i.content), Some(&shared));
    assert_eq!(listed.unread, 1);
    let shown = a1.client.notices().unwrap().shown;
    assert_eq!(
        notices_of(&shown),
        vec![(conversation.clone(), "b".into(), NoticeKind::Post, None)]
    );
    assert!(
        !relay
            .requests("a1")
            .iter()
            .any(|r| r.path.contains("/posts") || r.path.contains("/feed"))
    );
}

fn notices_of(shown: &[spjall_client::Notice]) -> Shown {
    shown
        .iter()
        .map(|n| {
            (
                n.conversation.clone(),
                n.sender.account.clone(),
                n.kind,
                n.text.clone(),
            )
        })
        .collect()
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
    let refused = b1.client.create_conversation(&strings(&["a"])).unwrap();
    // It holds up no other conversation's sync, and a retry is told why:
    // the refusal keeps the id the server gave the request (0037).
    b1.sync();
    assert!(matches!(
        b1.client.retry(&refused),
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
                forwarded: false,
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

    assert!(a1.client.set_push_token("fcm-1", false).unwrap());
    assert_eq!(relay.push_token("a1"), None);
    // The blocks list, the mutes list, then the token, never reach the
    // server.
    relay.fail_next("a1", 3);
    a1.sync();
    assert_eq!(relay.push_token("a1"), None);
    // Unsent, the same token still calls for a sync.
    assert!(a1.client.set_push_token("fcm-1", false).unwrap());
    a1.sync();
    assert_eq!(relay.push_token("a1"), Some(("fcm-1".into(), false)));

    // The same token on the next launch is not sent again, and calls for no sync.
    a1.reopen();
    assert!(!a1.client.set_push_token("fcm-1", false).unwrap());
    a1.sync();
    assert_eq!(puts(&relay), 1);

    assert!(a1.client.set_push_token("apns-1", true).unwrap());
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
        .send(
            &conversation,
            Body::Text {
                text: "hæ".into(),
                forwarded: false,
            },
        )
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

/// `(mute, unread)` of a conversation as the list shows it.
fn muted(phone: &mut Phone, conversation: &str) -> (Mute, u32) {
    let row = phone
        .client
        .conversations()
        .unwrap()
        .into_iter()
        .find(|c| c.id == conversation)
        .unwrap();
    (row.mute, row.unread)
}

fn redrawn(events: &[Event], conversation: &str) -> bool {
    events.iter().any(|e| {
        matches!(e, Event::Timeline { conversation: c, changed } if c == conversation && changed.is_empty())
    })
}

#[test]
fn a_muted_conversation_shows_no_notice_then_or_after_it_is_unmuted() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut a2 = Phone::new(&relay, "a", "a2");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let conversation = conversation(&mut b1, &mut a1);
    a2.deliver();
    a1.deliver();

    // Muted on one device: the other hears of it on its socket.
    assert_eq!(
        a1.client.mute(&conversation, MuteFor::Always).unwrap(),
        Mute::Always
    );
    assert!(redrawn(&a2.deliver(), &conversation));
    assert_eq!(muted(&mut a2, &conversation), (Mute::Always, 0));

    // Nothing shown on either device, and the unread count still rises.
    b1.send(&conversation, "í þögn");
    b1.sync();
    a1.deliver();
    a2.deliver();
    assert_eq!(notices(&mut a1), (Vec::new(), Vec::new()));
    assert_eq!(notices(&mut a2), (Vec::new(), Vec::new()));
    assert_eq!(muted(&mut a1, &conversation), (Mute::Always, 1));

    // Unmuted: what came while muted is never shown, what follows is.
    a1.client.unmute(&conversation).unwrap();
    assert!(redrawn(&a2.deliver(), &conversation));
    assert_eq!(muted(&mut a2, &conversation), (Mute::Off, 1));
    assert_eq!(notices(&mut a1), (Vec::new(), Vec::new()));
    b1.send(&conversation, "aftur");
    b1.sync();
    a1.deliver();
    let (shown, _) = notices(&mut a1);
    assert_eq!(
        shown,
        vec![(
            conversation.clone(),
            "b".into(),
            NoticeKind::Text,
            Some("aftur".into())
        )]
    );
}

#[test]
fn a_mute_set_while_a_device_was_away_reaches_it_at_sync_and_ends_on_time() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut a2 = Phone::new(&relay, "a", "a2");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let conversation = conversation(&mut b1, &mut a1);
    a2.deliver();

    let Mute::Until(until) = a1.client.mute(&conversation, MuteFor::Hour).unwrap() else {
        panic!("an hour's mute has an end");
    };
    // a2's socket was closed: the frame never reached it.
    relay.frames("a2");
    assert_eq!(muted(&mut a2, &conversation).0, Mute::Off);
    assert!(redrawn(&a2.sync(), &conversation));
    assert_eq!(muted(&mut a2, &conversation).0, Mute::Until(until));
    // An unchanged list redraws nothing.
    assert!(!redrawn(&a2.sync(), &conversation));

    b1.send(&conversation, "í þögn");
    b1.sync();
    a2.deliver();
    assert_eq!(notices(&mut a2), (Vec::new(), Vec::new()));

    // The hour passes: the mute counts as none, and new messages show.
    let mut store = spjall_store::Store::open(a2.dir.path(), &KEY).unwrap();
    store
        .write(|tx| tx.execute("UPDATE mutes SET until = until - 3600001", []))
        .unwrap();
    drop(store);
    assert_eq!(muted(&mut a2, &conversation).0, Mute::Off);
    b1.send(&conversation, "aftur");
    b1.sync();
    a2.deliver();
    let (shown, _) = notices(&mut a2);
    assert_eq!(
        shown,
        vec![(
            conversation.clone(),
            "b".into(),
            NoticeKind::Text,
            Some("aftur".into())
        )]
    );

    // Only a member mutes, and a malformed id is refused before a request.
    let mut c1 = Phone::new(&relay, "c", "c1");
    assert!(matches!(
        c1.client.mute(&conversation, MuteFor::EightHours),
        Err(ClientError::Transport(ApiError::Refused {
            status: 403,
            ..
        }))
    ));
    assert!(matches!(
        c1.client.unmute("not/an/id"),
        Err(ClientError::UnknownConversation)
    ));
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

/// The newest message of a conversation as stored on `phone`.
fn newest(phone: &mut Phone, conversation: &str) -> spjall_client::Message {
    phone
        .client
        .history(conversation, None, 1)
        .unwrap()
        .pop()
        .unwrap()
}

/// `a` with `b` in one conversation and with `c` in another.
fn two_conversations(a: &mut Phone, b: &mut Phone, c: &mut Phone) -> (String, String) {
    (conversation(a, b), conversation(a, c))
}

/// A forwarded file is a new object under a new key, uploaded into the
/// target: the bug it catches is a forward that reuses the original's id
/// or key, which the target's members could not fetch (0023) and which
/// would carry a key out of its conversation (0041).
#[test]
fn a_forward_never_reuses_the_original_media_object_or_key() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let mut c1 = Phone::new(&relay, "c", "c1");
    let (with_b, with_c) = two_conversations(&mut a1, &mut b1, &mut c1);
    let files = tempfile::tempdir().unwrap();
    let (path, bytes) = photo(&files);
    b1.client
        .send_media(&with_b, &path, "image/png", Some("sólarlag".into()), None)
        .unwrap();
    b1.sync();
    a1.deliver();

    // a has not opened it yet: the forward fetches it first.
    let seq = items(&mut a1, &with_b).pop().unwrap().seq.unwrap();
    a1.client.forward(&with_b, seq, &with_c).unwrap();
    assert_eq!(media_gets(&relay, "a1"), 1);
    a1.sync();
    c1.deliver();

    let Body::Media {
        object: original,
        key: original_key,
        sha256: original_sha,
        forwarded: false,
        ..
    } = newest(&mut a1, &with_b).envelope.body
    else {
        panic!("the original is not media");
    };
    let Body::Media {
        object,
        key,
        sha256,
        caption,
        forwarded,
        ..
    } = newest(&mut c1, &with_c).envelope.body
    else {
        panic!("the copy is not media");
    };
    assert_ne!(object, original);
    assert_ne!(key, original_key);
    assert_ne!(sha256, original_sha);
    assert_eq!(caption.as_deref(), Some("sólarlag"));
    assert!(forwarded);
    // The new object is in the target, and the original stays where it was.
    assert_eq!(relay.media(&with_c).len(), 1);
    assert_eq!(relay.media(&with_b).len(), 1);
    let item = items(&mut c1, &with_c).pop().unwrap();
    assert!(item.forwarded);
    assert_eq!(item.sender.account, "a");
    let file = c1.client.media(&with_c, item.seq.unwrap()).unwrap();
    assert_eq!(std::fs::read(file).unwrap(), bytes);
}

/// The bug: a message under a disappearing timer copied into a
/// conversation where it outlives the timer its people agreed to (0041).
/// A deleted message and a card are refused too, and nothing is sent.
#[test]
fn a_message_under_a_timer_deleted_or_not_a_message_is_not_forwarded() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let mut c1 = Phone::new(&relay, "c", "c1");
    let (with_b, with_c) = two_conversations(&mut a1, &mut b1, &mut c1);
    a1.send(&with_b, "eytt");
    a1.sync();
    let deleted = newest(&mut a1, &with_b);
    a1.client
        .send(
            &with_b,
            Body::Delete {
                target: deleted.envelope.id,
            },
        )
        .unwrap();
    a1.client
        .send(
            &with_b,
            Body::Disappearing {
                seconds: Some(3600),
            },
        )
        .unwrap();
    a1.send(&with_b, "hverfur");
    a1.sync();
    let all = items(&mut a1, &with_b);
    let [.., timer, timed] = all.as_slice() else {
        panic!("{all:?}");
    };
    assert!(timed.expires_at.is_some());
    let sent = relay.sends("a1").len();

    for (seq, why) in [
        (timed.seq.unwrap(), Unforwardable::Disappearing),
        (deleted.seq, Unforwardable::Deleted),
        (timer.seq.unwrap(), Unforwardable::NotAMessage),
        (9_999, Unforwardable::NotAMessage),
    ] {
        assert!(
            matches!(
                a1.client.forward(&with_b, seq, &with_c),
                Err(ClientError::CannotForward(reason)) if reason == why
            ),
            "{why:?}"
        );
    }
    a1.sync();
    assert_eq!(relay.sends("a1").len(), sent);
    assert!(items(&mut a1, &with_c).is_empty());
}

/// 0044: a shared post is not forwarded as a copy (a post is shared by its id
/// since 0080); the forward is refused as no message and nothing is queued. A reply to a
/// share still quotes the post's id, so the app draws the quote as the
/// share's fixed line.
#[test]
fn a_share_is_not_forwarded_and_a_reply_still_quotes_it() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let mut c1 = Phone::new(&relay, "c", "c1");
    let (with_b, with_c) = two_conversations(&mut a1, &mut b1, &mut c1);
    // b stands in for an app from before 0044, which still sent shares.
    b1.client
        .send(
            &with_b,
            Body::Post {
                post_id: "post_0001".into(),
                forwarded: false,
            },
        )
        .unwrap();
    b1.sync();
    a1.deliver();
    let share = newest(&mut a1, &with_b);
    let reply = a1
        .client
        .send(
            &with_b,
            Body::Reply {
                to: share.envelope.id.clone(),
                text: "Góð færsla".into(),
            },
        )
        .unwrap();
    assert!(!reply.is_empty());
    let quoted = items(&mut a1, &with_b).pop().unwrap().content;
    let Content::Text {
        reply_to: Some(quote),
        ..
    } = quoted
    else {
        panic!("{quoted:?}");
    };
    assert_eq!(
        (quote.text, quote.post_id),
        (None, Some("post_0001".into()))
    );

    a1.sync();
    let sent = relay.sends("a1").len();
    assert!(matches!(
        a1.client.forward(&with_b, share.seq, &with_c),
        Err(ClientError::CannotForward(Unforwardable::NotAMessage))
    ));
    a1.sync();
    assert_eq!(relay.sends("a1").len(), sent);
    c1.deliver();
    assert!(items(&mut c1, &with_c).is_empty());
}

/// The bug: a forward that carries its author, its conversation, or the
/// message a reply answered into a conversation that cannot check them
/// (0041). The copy is the text as it reads now and the mark, nothing else.
#[test]
fn a_forwarded_text_names_no_sender_or_conversation_and_drops_the_quote() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let mut c1 = Phone::new(&relay, "c", "c1");
    let (with_b, with_c) = two_conversations(&mut a1, &mut b1, &mut c1);
    a1.send(&with_b, "spurning");
    a1.sync();
    b1.deliver();
    let asked = newest(&mut b1, &with_b).envelope.id;
    let reply = b1
        .client
        .send(
            &with_b,
            Body::Reply {
                to: asked,
                text: "svar".into(),
            },
        )
        .unwrap();
    b1.client
        .send(
            &with_b,
            Body::Edit {
                target: reply.clone(),
                text: "betra svar".into(),
            },
        )
        .unwrap();
    b1.sync();
    a1.deliver();
    let original = items(&mut a1, &with_b)
        .into_iter()
        .find(|i| i.envelope_id.as_deref() == Some(reply.as_str()))
        .unwrap();
    assert!(!original.forwarded);

    a1.client
        .forward(&with_b, original.seq.unwrap(), &with_c)
        .unwrap();
    // Marked while it waits in the outbox, and once it is back.
    assert!(items(&mut a1, &with_c).pop().unwrap().forwarded);
    a1.sync();
    c1.deliver();

    let copy = newest(&mut c1, &with_c);
    assert_eq!(copy.sender.account, "a");
    assert_ne!(copy.envelope.id, reply);
    let wire: serde_json::Value = serde_json::from_slice(&copy.envelope.encode().unwrap()).unwrap();
    assert_eq!(
        wire,
        serde_json::json!({
            "v": 1,
            "id": copy.envelope.id,
            "ts": copy.envelope.ts,
            "kind": "text",
            "text": "betra svar",
            "forwarded": true,
        })
    );
    for phone in [&mut a1, &mut c1] {
        let item = items(phone, &with_c).pop().unwrap();
        assert!(item.forwarded);
        assert_eq!(
            item.content,
            Content::Text {
                text: "betra svar".into(),
                reply_to: None,
            }
        );
    }
}

/// How many times `device` fetched `account`'s photo.
fn photo_fetches(relay: &Relay, device: &str, account: &str) -> usize {
    let path = format!("/v1/accounts/{account}/photo");
    relay
        .requests(device)
        .iter()
        .filter(|r| r.path == path)
        .count()
}

#[test]
fn a_photo_is_fetched_once_per_version_and_goes_when_removed() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let image = a1.dir.path().join("picked.jpg");

    // Refused here before a request: nothing, or over 10 MB; and by the
    // server, what is not an image.
    std::fs::write(&image, b"").unwrap();
    assert!(matches!(
        a1.client.set_photo(&image),
        Err(ClientError::Invalid(_))
    ));
    std::fs::File::create(&image)
        .unwrap()
        .set_len(spjall_client::MAX_PHOTO + 1)
        .unwrap();
    assert!(matches!(
        a1.client.set_photo(&image),
        Err(ClientError::Invalid(_))
    ));
    assert!(
        !relay
            .requests("a1")
            .iter()
            .any(|r| r.path == "/v1/me/photo")
    );
    std::fs::write(&image, b"not one").unwrap();
    assert!(matches!(
        a1.client.set_photo(&image),
        Err(ClientError::Transport(ApiError::Refused {
            status: 400,
            ..
        }))
    ));

    std::fs::write(&image, b"image:first").unwrap();
    let first = a1.client.set_photo(&image).unwrap();
    assert_eq!(
        a1.client.me().unwrap().photo.as_deref(),
        Some(first.as_str())
    );
    assert_eq!(
        b1.client.profile("a").unwrap().photo.as_deref(),
        Some(first.as_str())
    );

    // Fetched once, then kept for as long as the version stands.
    let kept = b1.client.photo("a", &first).unwrap().unwrap();
    assert_eq!(std::fs::read(&kept).unwrap(), b"webp:image:first");
    assert_eq!(b1.client.photo("a", &first).unwrap(), Some(kept.clone()));
    b1.reopen();
    assert_eq!(b1.client.photo("a", &first).unwrap(), Some(kept.clone()));
    assert_eq!(photo_fetches(&relay, "b1", "a"), 1);

    // A new version is fetched in place of the old one.
    std::fs::write(&image, b"image:second").unwrap();
    let second = a1.client.set_photo(&image).unwrap();
    assert_ne!(second, first);
    assert_eq!(
        b1.client.profile("a").unwrap().photo.as_deref(),
        Some(second.as_str())
    );
    let newer = b1.client.photo("a", &second).unwrap().unwrap();
    assert_eq!(std::fs::read(&newer).unwrap(), b"webp:image:second");
    assert!(!kept.exists());
    assert_eq!(photo_fetches(&relay, "b1", "a"), 2);

    // Removed: the profile shows none, and the kept file goes.
    a1.client.remove_photo().unwrap();
    assert_eq!(a1.client.me().unwrap().photo, None);
    assert_eq!(b1.client.profile("a").unwrap().photo, None);
    assert!(!newer.exists());
    assert_eq!(b1.client.photo("a", &second).unwrap(), None);

    // Ids never name a path outside the media folder.
    assert!(matches!(
        b1.client.photo("../a", &second),
        Err(ClientError::Invalid(_))
    ));
    assert!(matches!(
        b1.client.photo("a", "../../x"),
        Err(ClientError::Invalid(_))
    ));
}

#[test]
fn a_photo_is_framed_again_from_its_master_and_the_old_frames_go() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let image = a1.dir.path().join("picked.jpg");
    std::fs::write(&image, b"image:first").unwrap();
    let first = a1.client.set_photo(&image).unwrap();

    // Nothing stored yet: the editor opens at the centre, with the master.
    assert_eq!(a1.client.photo_framing().unwrap(), None);
    let source = a1.dir.path().join("master.webp");
    assert!(a1.client.photo_source(&source).unwrap());
    assert_eq!(std::fs::read(&source).unwrap(), b"image:first");
    assert!(!source.with_extension("part").exists());

    // The square frame is fetched under its name and kept in a folder of its own.
    let square = a1
        .client
        .photo_framed("a", &first, Frame::Square)
        .unwrap()
        .unwrap();
    assert!(square.ends_with(format!("photos/a/square/{first}.webp")));
    assert_eq!(
        a1.client.photo_framed("a", &first, Frame::Square).unwrap(),
        Some(square.clone())
    );
    assert!(
        relay
            .requests("a1")
            .iter()
            .any(|r| r.path == "/v1/accounts/a/photo?frame=square")
    );
    // A cover frame is no frame of a photo, and asks nothing.
    let asked = relay.requests("a1").len();
    assert!(matches!(
        a1.client.photo_framed("a", &first, Frame::Compact),
        Err(ClientError::Invalid(_))
    ));
    assert_eq!(relay.requests("a1").len(), asked);
    let plain = a1.client.photo("a", &first).unwrap().unwrap();

    // Re-framing makes a new version and clears every kept file of the old.
    let mut framing = Framing::centred();
    framing.focus = Focus { x: 0.25, y: 0.75 };
    let second = a1.client.set_photo_framing(&framing).unwrap();
    assert_ne!(second, first);
    assert!(!square.exists() && !plain.exists());
    assert!(!a1.dir.path().join("photos/a/square").exists());
    assert_eq!(
        a1.client.me().unwrap().photo.as_deref(),
        Some(second.as_str())
    );
    assert_eq!(a1.client.photo_framing().unwrap(), Some(framing));
    let cut = a1
        .client
        .photo_framed("a", &second, Frame::Square)
        .unwrap()
        .unwrap();
    assert!(std::fs::read(&cut).unwrap().starts_with(b"webp:framed:"));

    // A framing the server would refuse never leaves the device.
    let mut wrong = Framing::centred();
    wrong.overrides.insert(
        Frame::Compact,
        FrameRect {
            x: 0.0,
            y: 0.0,
            w: 1.0,
            h: 1.0,
        },
    );
    let asked = relay.requests("a1").len();
    assert!(matches!(
        a1.client.set_photo_framing(&wrong),
        Err(ClientError::Invalid(_))
    ));
    assert_eq!(relay.requests("a1").len(), asked);
}

#[test]
fn a_photo_without_a_master_is_its_own_error() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let image = a1.dir.path().join("picked.jpg");
    std::fs::write(&image, b"image:old").unwrap();
    let old = a1.client.set_photo(&image).unwrap();
    relay.forget_master("a");

    assert!(matches!(
        a1.client.set_photo_framing(&Framing::centred()),
        Err(ClientError::NoMaster)
    ));
    // The photo is untouched, and there is no master to write.
    assert_eq!(a1.client.me().unwrap().photo.as_deref(), Some(old.as_str()));
    let source = a1.dir.path().join("master.webp");
    assert!(!a1.client.photo_source(&source).unwrap());
    assert!(!source.exists() && !source.with_extension("part").exists());
}

#[test]
fn a_block_withholds_the_photo_both_ways_and_the_kept_one_goes() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let mut c1 = Phone::new(&relay, "c", "c1");
    let image = a1.dir.path().join("picked.jpg");
    std::fs::write(&image, b"image:a").unwrap();
    let of_a = a1.client.set_photo(&image).unwrap();
    std::fs::write(&image, b"image:b").unwrap();
    let of_b = b1.client.set_photo(&image).unwrap();

    // Seen by every signed-in account: as a profile and in the list.
    let kept = b1.client.photo("a", &of_a).unwrap().unwrap();
    let listed = c1.client.directory(None, None, 20).unwrap().people;
    assert_eq!(listed[0].photo.as_deref(), Some(of_a.as_str()));
    assert_eq!(listed[1].photo.as_deref(), Some(of_b.as_str()));

    // b blocks a: neither sees the other's photo, the name stays, and the
    // photo b kept is gone.
    b1.client.block("a").unwrap();
    assert!(!kept.exists());
    let a_to_b = b1.client.profile("a").unwrap();
    assert_eq!(a_to_b.name.as_deref(), Some("Name of a"));
    assert_eq!(a_to_b.photo, None);
    assert_eq!(b1.client.photo("a", &of_a).unwrap(), None);
    assert_eq!(a1.client.profile("b").unwrap().photo, None);
    assert_eq!(a1.client.photo("b", &of_b).unwrap(), None);

    // c, outside the block, still sees both.
    assert!(c1.client.photo("a", &of_a).unwrap().is_some());
    assert!(c1.client.photo("b", &of_b).unwrap().is_some());

    // Unblocked, it shows again.
    b1.client.unblock("a").unwrap();
    assert_eq!(
        b1.client.profile("a").unwrap().photo.as_deref(),
        Some(of_a.as_str())
    );
    assert!(b1.client.photo("a", &of_a).unwrap().is_some());
}

/// `received_at` of each item, oldest first.
fn received(items: &[Item]) -> Vec<Option<u64>> {
    items.iter().map(|i| i.received_at).collect()
}

#[test]
fn times_are_the_servers_and_never_go_back() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let conversation = conversation(&mut a1, &mut b1);

    relay.set_clock(5_000);
    a1.send(&conversation, "eitt");
    // Still being sent: no server time yet.
    assert_eq!(
        items(&mut a1, &conversation).last().unwrap().received_at,
        None
    );
    a1.sync();
    // The server's clock went back; the time does not.
    relay.set_clock(4_000);
    b1.send(&conversation, "tvö");
    b1.sync();
    relay.set_clock(9_000);
    a1.send(&conversation, "þrjú");
    a1.sync();
    // A card takes the time of its commit.
    let _c1 = Phone::new(&relay, "c", "c1");
    relay.set_clock(12_000);
    a1.client
        .add_accounts(&conversation, &strings(&["c"]))
        .unwrap();
    a1.sync();
    a1.deliver();
    b1.deliver();

    let times = vec![Some(5_000), Some(5_000), Some(9_000), Some(12_000)];
    let a = items(&mut a1, &conversation);
    assert_eq!(received(&a), times);
    assert!(matches!(a[3].content, Content::Members { .. }));
    let b = items(&mut b1, &conversation);
    assert_eq!(received(&b), times);
    // The sender's clock is kept beside it.
    assert!(b[..3].iter().all(|i| i.ts > 12_000));
}

#[test]
fn an_edit_keeps_the_time_of_what_it_edits() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let conversation = conversation(&mut a1, &mut b1);
    relay.set_clock(5_000);
    a1.send(&conversation, "fyrst");
    a1.sync();
    b1.deliver();
    let id = items(&mut b1, &conversation)
        .last()
        .unwrap()
        .envelope_id
        .clone()
        .unwrap();
    relay.set_clock(8_000);
    a1.client
        .send(
            &conversation,
            Body::Edit {
                target: id,
                text: "breytt".into(),
            },
        )
        .unwrap();
    a1.sync();
    b1.deliver();
    let last = items(&mut b1, &conversation).pop().unwrap();
    assert!(last.edited);
    assert_eq!(last.received_at, Some(5_000));
}

#[test]
fn a_server_without_times_leaves_them_unknown() {
    let relay = Relay::new();
    relay.without_stored_at();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let conversation = conversation(&mut a1, &mut b1);
    a1.send(&conversation, "halló");
    a1.sync();
    b1.deliver();
    assert!(
        items(&mut b1, &conversation)
            .iter()
            .all(|i| i.received_at.is_none())
    );
}

/// The media of a conversation for its information screen (0055), newest first.
fn shared(phone: &mut Phone, conversation: &str, before: Option<u64>, limit: u32) -> Vec<Item> {
    phone.client.shared(conversation, before, limit).unwrap()
}

fn media_kind(item: &Item) -> (String, Option<String>) {
    match &item.content {
        Content::Media { mime, name, .. } => (mime.clone(), name.clone()),
        other => panic!("not media: {other:?}"),
    }
}

#[test]
fn shared_lists_photos_and_files_newest_first_without_what_was_deleted() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let conversation = conversation(&mut a1, &mut b1);
    let files = tempfile::tempdir().unwrap();
    let (path, _) = photo(&files);
    a1.send(&conversation, "texti");
    a1.client
        .send_media(
            &conversation,
            &path,
            "image/png",
            Some("fyrst".into()),
            None,
        )
        .unwrap();
    let gone = a1
        .client
        .send_media(&conversation, &path, "image/png", None, None)
        .unwrap();
    a1.client
        .send_media(
            &conversation,
            &path,
            "application/pdf",
            None,
            Some("skýrsla.pdf".into()),
        )
        .unwrap();
    a1.client
        .send(&conversation, Body::Delete { target: gone })
        .unwrap();
    a1.sync();
    b1.deliver();

    for phone in [&mut a1, &mut b1] {
        let all = shared(phone, &conversation, None, 10);
        assert_eq!(
            all.iter().map(media_kind).collect::<Vec<_>>(),
            vec![
                ("application/pdf".into(), Some("skýrsla.pdf".into())),
                ("image/png".into(), None),
            ]
        );
        assert!(all.windows(2).all(|w| w[0].seq > w[1].seq));
        // Paged by seq, as the timeline is.
        let first = shared(phone, &conversation, None, 1);
        assert_eq!(first.len(), 1);
        let rest = shared(phone, &conversation, first[0].seq, 10);
        assert_eq!(
            rest.iter().map(|i| i.seq).collect::<Vec<_>>(),
            vec![all[1].seq]
        );
    }
}

#[test]
fn shared_leaves_out_what_a_timer_ended_before_any_purge() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let conversation = conversation(&mut a1, &mut b1);
    let files = tempfile::tempdir().unwrap();
    let (path, _) = photo(&files);
    a1.client
        .send_media(&conversation, &path, "image/png", None, None)
        .unwrap();
    a1.client
        .send(&conversation, Body::Disappearing { seconds: Some(1) })
        .unwrap();
    a1.client
        .send_media(
            &conversation,
            &path,
            "image/png",
            Some("hverfur".into()),
            None,
        )
        .unwrap();
    a1.sync();
    b1.deliver();
    assert_eq!(shared(&mut b1, &conversation, None, 10).len(), 2);
    std::thread::sleep(std::time::Duration::from_millis(1100));
    // No expire() yet: the read leaves the row out by itself (0056).
    for phone in [&mut a1, &mut b1] {
        let left = shared(phone, &conversation, None, 10);
        assert_eq!(left.len(), 1);
        assert!(matches!(
            &left[0].content,
            Content::Media { caption: None, .. }
        ));
    }
}

fn hallgrimskirkja() -> Body {
    Body::Location {
        lat_e6: 64_141_960,
        lon_e6: -21_926_570,
        accuracy: Some(12),
        forwarded: false,
    }
}

/// 0059: a location is a message like any other. It wakes the reader, reads
/// as its place in the conversation and the list, and its notice says only
/// what it is: a notice is shown on a locked screen. A place off the globe
/// is never queued.
#[test]
fn a_location_reads_as_its_place_and_its_notice_never_names_it() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let conversation = conversation(&mut b1, &mut a1);
    a1.client.notices().unwrap();

    for (lat_e6, lon_e6) in [(90_000_001, 0), (0, -180_000_001)] {
        assert!(matches!(
            b1.client.send(
                &conversation,
                Body::Location {
                    lat_e6,
                    lon_e6,
                    accuracy: None,
                    forwarded: false,
                }
            ),
            Err(ClientError::Invalid(_))
        ));
    }
    b1.client.send(&conversation, hallgrimskirkja()).unwrap();
    b1.sync();
    a1.deliver();

    let place = Content::Location {
        lat_e6: 64_141_960,
        lon_e6: -21_926_570,
        accuracy: Some(12),
    };
    // The commit that made the conversation, then the location.
    assert_eq!(urgency(&relay, "b1"), vec![false, true]);
    let item = items(&mut a1, &conversation).pop().unwrap();
    assert_eq!(item.content, place);
    assert!(!item.forwarded);
    assert_eq!(items(&mut b1, &conversation).pop().unwrap().content, place);
    let listed = a1.client.conversations().unwrap().pop().unwrap();
    assert_eq!(listed.last.as_ref().map(|i| &i.content), Some(&place));
    assert_eq!(listed.unread, 1);
    assert_eq!(
        notices_of(&a1.client.notices().unwrap().shown),
        vec![(conversation.clone(), "b".into(), NoticeKind::Location, None)]
    );
}

/// A location has no text to edit. A reply quotes it as a location and
/// nothing of the place, and a forward is a fresh copy of the same place,
/// marked (0041).
#[test]
fn a_location_is_not_edited_is_quoted_as_one_and_forwards_as_the_same_place() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let mut c1 = Phone::new(&relay, "c", "c1");
    let (with_b, with_c) = two_conversations(&mut a1, &mut b1, &mut c1);
    let sent = b1.client.send(&with_b, hallgrimskirkja()).unwrap();
    b1.client
        .send(
            &with_b,
            Body::Edit {
                target: sent.clone(),
                text: "annað".into(),
            },
        )
        .unwrap();
    b1.sync();
    a1.deliver();
    // The last message to arrive is the refused edit, so the location is
    // found by its id.
    let shown = items(&mut a1, &with_b).pop().unwrap();
    assert_eq!(shown.envelope_id.as_deref(), Some(sent.as_str()));
    assert!(!shown.edited);
    assert!(matches!(shown.content, Content::Location { .. }));

    a1.client
        .send(
            &with_b,
            Body::Reply {
                to: sent.clone(),
                text: "Kem".into(),
            },
        )
        .unwrap();
    let Content::Text {
        reply_to: Some(quote),
        ..
    } = items(&mut a1, &with_b).pop().unwrap().content
    else {
        panic!("not a reply");
    };
    assert_eq!(
        (quote.text, quote.post_id, quote.location),
        (None, None, true)
    );

    a1.client
        .forward(&with_b, shown.seq.unwrap(), &with_c)
        .unwrap();
    a1.sync();
    c1.deliver();
    let copy = newest(&mut c1, &with_c);
    assert_ne!(copy.envelope.id, sent);
    assert_eq!(
        copy.envelope.body,
        Body::Location {
            lat_e6: 64_141_960,
            lon_e6: -21_926_570,
            accuracy: Some(12),
            forwarded: true,
        }
    );
    let item = items(&mut c1, &with_c).pop().unwrap();
    assert!(item.forwarded);
    assert_eq!(item.sender.account, "a");
}

/// The texts of a conversation's timeline, cards left out.
fn timeline_texts(phone: &mut Phone, conversation: &str) -> Vec<String> {
    items(phone, conversation)
        .into_iter()
        .filter_map(|item| match item.content {
            Content::Text { text, .. } => Some(text),
            _ => None,
        })
        .collect()
}

/// `a1` talks with `b1` and sends a photo; `a2` is linked after.
fn a_history(relay: &Arc<Relay>) -> (Phone, Phone, Phone, String, Vec<u8>) {
    let mut a1 = Phone::new(relay, "a", "a1");
    let mut b1 = Phone::new(relay, "b", "b1");
    let conversation = conversation(&mut a1, &mut b1);
    a1.send(&conversation, "fyrir");
    a1.sync();
    b1.deliver();
    b1.send(&conversation, "svar");
    b1.sync();
    a1.deliver();
    let files = tempfile::tempdir().unwrap();
    let (path, bytes) = photo(&files);
    a1.client
        .send_media(&conversation, &path, "image/png", None, None)
        .unwrap();
    a1.sync();
    b1.deliver();
    let a2 = Phone::new(relay, "a", "a2");
    (a1, b1, a2, conversation, bytes)
}

#[test]
fn a_linked_device_starts_with_its_siblings_history() {
    let relay = Relay::new();
    let (mut a1, mut b1, mut a2, conversation, bytes) = a_history(&relay);
    let key = history_key().unwrap();
    let blob = a1.dir.path().join("history");
    a1.client.export_history(None, &key.public, &blob).unwrap();
    // The blob holds neither a text nor the photo in the clear.
    let sealed = std::fs::read(&blob).unwrap();
    assert_eq!(&sealed[..4], b"SPJH");
    assert!(!sealed.windows(5).any(|w| w == b"fyrir"));
    assert!(!sealed.windows(64).any(|w| w == &bytes[..64]));

    let imported = a2.client.import_history(&blob, &key.private).unwrap();
    assert_eq!((imported.conversations, imported.files), (1, 1));
    assert!(imported.items >= 3);
    assert_eq!(timeline_texts(&mut a2, &conversation), ["fyrir", "svar"]);
    let photo = items(&mut a2, &conversation).pop().unwrap();
    let file = a2.client.media(&conversation, photo.seq.unwrap()).unwrap();
    assert_eq!(std::fs::read(file).unwrap(), bytes);
    assert_eq!(media_gets(&relay, "a2"), 0);
    // Old messages raise no notices.
    assert!(a2.client.notices().unwrap().shown.is_empty());

    // Imported again: nothing new.
    assert_eq!(
        a2.client.import_history(&blob, &key.private).unwrap(),
        Imported::default()
    );

    // It joins the group, and the history goes on from there.
    assert_eq!(joined(&a2.sync()), vec![conversation.clone()]);
    b1.deliver();
    b1.send(&conversation, "velkomin");
    b1.sync();
    assert_eq!(texts(&a2.deliver()), strings(&["velkomin"]));
    assert_eq!(
        timeline_texts(&mut a2, &conversation),
        ["fyrir", "svar", "velkomin"]
    );
}

/// Whether the server refused the call with `status`.
fn refused(error: Option<ClientError>, status: u16) -> bool {
    matches!(error, Some(ClientError::Transport(ApiError::Refused { status: s, .. })) if s == status)
}

/// A device's working files for a history, none of which may outlast a call.
fn history_files(phone: &Phone) -> Vec<std::path::PathBuf> {
    let media = phone.dir.path().join("media");
    ["out/history", "out/history.part", "in/history"]
        .iter()
        .map(|p| media.join(p))
        .filter(|p| p.exists())
        .collect()
}

#[test]
fn a_history_travels_through_the_server_in_parts() {
    let relay = Relay::new();
    let (mut a1, _b1, mut a2, conversation, bytes) = a_history(&relay);
    relay.approve_link("lnk_1", "a1", "a2");
    // Small parts, so this history spans several and ends on a short one.
    relay.set_history_part(64 * 1024);
    let key = history_key().unwrap();

    let size = a1.client.send_history("lnk_1", None, &key.public).unwrap();
    let stored = relay.history("lnk_1").unwrap();
    assert_eq!(stored.len() as u64, size);
    assert_eq!(&stored[..4], b"SPJH");
    assert!(!stored.windows(5).any(|w| w == b"fyrir"));
    let parts = relay
        .requests("a1")
        .iter()
        .filter(|r| r.path.contains("/history/parts/"))
        .count() as u64;
    assert_eq!(parts, size.div_ceil(64 * 1024));
    assert!(parts > 1 && size % (64 * 1024) != 0);
    assert!(history_files(&a1).is_empty());

    let imported = a2.client.receive_history("lnk_1", &key.private).unwrap();
    assert_eq!((imported.conversations, imported.files), (1, 1));
    assert_eq!(timeline_texts(&mut a2, &conversation), ["fyrir", "svar"]);
    let photo = items(&mut a2, &conversation).pop().unwrap();
    let file = a2.client.media(&conversation, photo.seq.unwrap()).unwrap();
    assert_eq!(std::fs::read(file).unwrap(), bytes);
    // Deleted from the server once it is in the store.
    assert!(!relay.holds_history("lnk_1"));
    assert!(history_files(&a2).is_empty());
}

#[test]
fn a_history_goes_only_from_the_approver_to_the_linked_device() {
    let relay = Relay::new();
    let (mut a1, mut b1, mut a2, _conversation, _) = a_history(&relay);
    relay.approve_link("lnk_1", "a1", "a2");
    let key = history_key().unwrap();

    // Not the phone that approved it.
    assert!(refused(
        b1.client.send_history("lnk_1", None, &key.public).err(),
        403
    ));
    assert!(history_files(&b1).is_empty());
    // Nothing to receive yet.
    assert!(refused(
        a2.client.receive_history("lnk_1", &key.private).err(),
        404
    ));

    a1.client.send_history("lnk_1", None, &key.public).unwrap();
    // Once per link.
    assert!(refused(
        a1.client.send_history("lnk_1", None, &key.public).err(),
        409
    ));
    // Only the device the link made downloads it.
    assert!(refused(
        b1.client.receive_history("lnk_1", &key.private).err(),
        403
    ));

    // A history that does not open stays on the server, and the right key
    // still opens it.
    let other = history_key().unwrap();
    assert!(matches!(
        a2.client.receive_history("lnk_1", &other.private),
        Err(ClientError::History(HistoryError::Tampered))
    ));
    assert!(relay.history("lnk_1").is_some());
    assert!(history_files(&a2).is_empty());
    assert_eq!(
        a2.client
            .receive_history("lnk_1", &key.private)
            .unwrap()
            .conversations,
        1
    );
    assert!(!relay.holds_history("lnk_1"));
}

#[test]
fn a_history_upload_that_breaks_leaves_nothing_on_the_phone() {
    let relay = Relay::new();
    let (mut a1, _b1, _a2, _conversation, _) = a_history(&relay);
    relay.approve_link("lnk_1", "a1", "a2");
    relay.set_history_part(64 * 1024);
    let key = history_key().unwrap();
    relay.lose_history_part(2);
    assert!(matches!(
        a1.client.send_history("lnk_1", None, &key.public),
        Err(ClientError::Transport(ApiError::Unreachable(_)))
    ));
    assert!(history_files(&a1).is_empty());
    assert!(relay.history("lnk_1").is_none());
}

#[test]
fn a_history_opens_only_whole_and_only_with_its_key() {
    let relay = Relay::new();
    let (mut a1, _b1, mut a2, _conversation, _) = a_history(&relay);
    let key = history_key().unwrap();
    let blob = a1.dir.path().join("history");
    a1.client.export_history(None, &key.public, &blob).unwrap();
    let sealed = std::fs::read(&blob).unwrap();
    let other = history_key().unwrap();
    let broken = a2.dir.path().join("broken");
    let tampered = |result: Result<Imported, ClientError>| {
        matches!(result, Err(ClientError::History(HistoryError::Tampered)))
    };

    assert!(tampered(a2.client.import_history(&blob, &other.private)));
    for bytes in [
        sealed[..sealed.len() - 1].to_vec(),
        sealed[..sealed.len() - 64 * 1024].to_vec(),
        {
            let mut flipped = sealed.clone();
            flipped[100] ^= 1;
            flipped
        },
        {
            let mut grown = sealed.clone();
            grown.push(0);
            grown
        },
    ] {
        std::fs::write(&broken, bytes).unwrap();
        assert!(tampered(a2.client.import_history(&broken, &key.private)));
    }
    // Nothing of it was written.
    assert!(a2.client.conversations().unwrap().is_empty());
    assert!(media_files(&a2).is_empty());
}

#[test]
fn a_history_since_a_time_leaves_older_messages_out() {
    let relay = Relay::new();
    let (mut a1, _b1, mut a2, conversation, _) = a_history(&relay);
    let key = history_key().unwrap();
    let blob = a1.dir.path().join("history");
    let tomorrow = items(&mut a1, &conversation).pop().unwrap().ts + 86_400_000;
    a1.client
        .export_history(Some(tomorrow), &key.public, &blob)
        .unwrap();
    let imported = a2.client.import_history(&blob, &key.private).unwrap();
    assert_eq!((imported.conversations, imported.items), (1, 0));
    assert!(items(&mut a2, &conversation).is_empty());
}

#[test]
fn an_imported_conversation_survives_a_refused_join_and_a_removal_stays() {
    let relay = Relay::new();
    let (mut a1, mut b1, mut a2, talk, _) = a_history(&relay);
    let mut c1 = Phone::new(&relay, "c", "c1");
    let gone = conversation(&mut a1, &mut c1);
    // As a commit removing this account leaves it.
    let group = spjall_client::api::group_id(&gone).unwrap();
    let mut store = spjall_store::Store::open(a1.dir.path(), &KEY).unwrap();
    store
        .write(|tx| {
            tx.execute(
                "UPDATE conversations SET state = 'removed' WHERE group_id = ?1",
                [&group],
            )
        })
        .unwrap();
    drop(store);
    let key = history_key().unwrap();
    let blob = a1.dir.path().join("history");
    a1.client.export_history(None, &key.public, &blob).unwrap();
    a2.client.import_history(&blob, &key.private).unwrap();

    relay.refuse_sends("a2", 1);
    a2.sync();
    let state = |a2: &mut Phone, id: &str| {
        a2.client
            .conversations()
            .unwrap()
            .into_iter()
            .find(|c| c.id == id)
            .map(|c| c.state)
    };
    assert_eq!(state(&mut a2, &talk), Some(State::Stale));
    assert_eq!(timeline_texts(&mut a2, &talk), ["fyrir", "svar"]);
    assert_eq!(state(&mut a2, &gone), Some(State::Removed));

    let mut store = spjall_store::Store::open(a2.dir.path(), &KEY).unwrap();
    store
        .write(|tx| {
            tx.execute(
                "UPDATE conversations SET join_refused_at = join_refused_at - 3600000",
                [],
            )
        })
        .unwrap();
    drop(store);
    assert_eq!(joined(&a2.sync()), vec![talk.clone()]);
    b1.deliver();
    b1.send(&talk, "aftur");
    b1.sync();
    assert_eq!(texts(&a2.deliver()), strings(&["aftur"]));
}

/// A browser of account `a` asks to be linked as `lnk_1` with `device`'s
/// key and `history`, and shows this code (0077).
fn link_code(relay: &Relay, device: &mut Phone, history: &[u8]) -> String {
    let device_key = device.client.device_key().unwrap();
    let in_ten_minutes = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
        + 600_000;
    relay.request_link("a", "lnk_1", &device_key, history, in_ten_minutes);
    LinkCode {
        link_id: "lnk_1".into(),
        device_key,
        history_key: history.to_vec(),
    }
    .to_string()
}

#[test]
fn a_phone_approves_a_link_code_and_sends_its_whole_history() {
    let relay = Relay::new();
    let (mut a1, _b1, mut a2, conversation, bytes) = a_history(&relay);
    let key = history_key().unwrap();
    let code = link_code(&relay, &mut a2, &key.public);

    let request = a1.client.inspect_link(&code).unwrap();
    assert_eq!(request.browser.as_deref(), Some("Firefox"));
    assert_eq!(request.os.as_deref(), Some("Linux"));
    assert!(!request.approved);

    let size = a1.client.approve_link(&code, None, true).unwrap();
    assert!(size > 0);
    assert_eq!(relay.link_approver("lnk_1").as_deref(), Some("a1"));
    let imported = a2.client.receive_history("lnk_1", &key.private).unwrap();
    assert_eq!((imported.conversations, imported.files), (1, 1));
    assert_eq!(timeline_texts(&mut a2, &conversation), ["fyrir", "svar"]);
    let photo = items(&mut a2, &conversation).pop().unwrap();
    let file = a2.client.media(&conversation, photo.seq.unwrap()).unwrap();
    assert_eq!(std::fs::read(file).unwrap(), bytes);

    // Once per link.
    assert!(a1.client.inspect_link(&code).unwrap().approved);
    assert!(matches!(
        a1.client.approve_link(&code, None, true),
        Err(ClientError::Link(LinkError::AlreadyApproved))
    ));
}

#[test]
fn a_phone_approves_a_link_code_with_only_the_slice_it_chose() {
    let relay = Relay::new();
    let (mut a1, _b1, mut a2, conversation, _) = a_history(&relay);
    let key = history_key().unwrap();
    let code = link_code(&relay, &mut a2, &key.public);
    let tomorrow = items(&mut a1, &conversation).pop().unwrap().ts + 86_400_000;

    a1.client.approve_link(&code, Some(tomorrow), true).unwrap();
    let imported = a2.client.receive_history("lnk_1", &key.private).unwrap();
    assert_eq!((imported.conversations, imported.items), (1, 0));
    assert!(items(&mut a2, &conversation).is_empty());
}

#[test]
fn a_phone_approves_a_link_code_and_sends_nothing() {
    let relay = Relay::new();
    let (mut a1, _b1, mut a2, _conversation, _) = a_history(&relay);
    let key = history_key().unwrap();
    let code = link_code(&relay, &mut a2, &key.public);

    assert_eq!(a1.client.approve_link(&code, None, false).unwrap(), 0);
    assert_eq!(relay.link_approver("lnk_1").as_deref(), Some("a1"));
    assert!(!relay.holds_history("lnk_1"));
    assert!(
        !relay
            .requests("a1")
            .iter()
            .any(|r| r.path.contains("/history"))
    );
    assert!(refused(
        a2.client.receive_history("lnk_1", &key.private).err(),
        404
    ));
    assert!(history_files(&a1).is_empty());
}

#[test]
fn a_phone_refuses_a_link_request_whose_keys_are_not_the_codes() {
    let relay = Relay::new();
    let (mut a1, _b1, mut a2, _conversation, _) = a_history(&relay);
    let key = history_key().unwrap();
    let code = link_code(&relay, &mut a2, &key.public);
    // The server swaps in a history key of its own.
    let other = history_key().unwrap();
    let parsed = LinkCode::parse(&code).unwrap();
    relay.request_link(
        "a",
        "lnk_1",
        &parsed.device_key,
        &other.public,
        4_000_000_000_000,
    );

    for error in [
        a1.client.inspect_link(&code).err(),
        a1.client.approve_link(&code, None, true).err(),
    ] {
        assert!(matches!(
            error,
            Some(ClientError::Link(LinkError::KeyMismatch))
        ));
    }
    assert_eq!(relay.link_approver("lnk_1"), None);
    assert!(!relay.holds_history("lnk_1"));
}

#[test]
fn only_a_phone_approves_a_live_link_code() {
    let relay = Relay::new();
    let (mut a1, _b1, mut a2, _conversation, _) = a_history(&relay);
    let key = history_key().unwrap();
    let code = link_code(&relay, &mut a2, &key.public);

    // Not a code.
    for text in ["", "SPJL2.lnk_1.a.b", "https://spjall.samtak.is/l/x"] {
        assert!(matches!(
            a1.client.inspect_link(text),
            Err(ClientError::Link(LinkError::InvalidCode))
        ));
    }
    // A browser cannot approve.
    relay.make_browser("a1");
    assert!(refused(
        a1.client.approve_link(&code, None, true).err(),
        403
    ));
    assert_eq!(relay.link_approver("lnk_1"), None);
    // Expired: no longer pending.
    relay.set_clock(u64::MAX - 1);
    let parsed = LinkCode::parse(&code).unwrap();
    relay.request_link("a", "lnk_1", &parsed.device_key, &key.public, 1);
    assert!(matches!(
        a2.client.inspect_link(&code),
        Err(ClientError::Link(LinkError::Gone))
    ));
}

/// `a`, `b` and `c` in one conversation, made by `a`.
fn group(relay: &Arc<Relay>) -> (Phone, Phone, Phone, String) {
    let mut a1 = Phone::new(relay, "a", "a1");
    let mut b1 = Phone::new(relay, "b", "b1");
    let mut c1 = Phone::new(relay, "c", "c1");
    let conversation = conversation(&mut a1, &mut b1);
    a1.client
        .add_accounts(&conversation, &strings(&["c"]))
        .unwrap();
    a1.sync();
    b1.deliver();
    assert_eq!(joined(&c1.deliver()), vec![conversation.clone()]);
    (a1, b1, c1, conversation)
}

fn name_of(phone: &mut Phone) -> Option<String> {
    phone.client.conversations().unwrap()[0].name.clone()
}

/// A group's name is encrypted group state, as the timer is (0078): a card
/// on every member, and clearing it is a card too.
#[test]
fn a_group_name_reaches_every_member_and_is_cleared_the_same_way() {
    let relay = Relay::new();
    let (mut a1, mut b1, mut c1, conversation) = group(&relay);

    a1.client
        .rename(&conversation, Some("  Hópurinn ".into()))
        .unwrap();
    a1.sync();
    b1.deliver();
    c1.deliver();
    for phone in [&mut a1, &mut b1, &mut c1] {
        assert_eq!(name_of(phone).as_deref(), Some("Hópurinn"));
        let items = items(phone, &conversation);
        let card = items.last().unwrap();
        assert_eq!(
            card.content,
            Content::Name {
                name: Some("Hópurinn".into())
            }
        );
        assert_eq!(card.sender.account, "a");
    }

    b1.client.rename(&conversation, Some("   ".into())).unwrap();
    b1.sync();
    a1.deliver();
    c1.deliver();
    for phone in [&mut a1, &mut b1, &mut c1] {
        assert_eq!(name_of(phone), None);
        let items = items(phone, &conversation);
        let card = items.last().unwrap();
        assert_eq!(card.content, Content::Name { name: None });
        assert_eq!(card.sender.account, "b");
    }
}

#[test]
fn only_a_group_takes_a_name_and_only_a_short_plain_one() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let one_to_one = conversation(&mut a1, &mut b1);
    assert!(matches!(
        a1.client.rename(&one_to_one, Some("Við".into())),
        Err(ClientError::NotAGroup)
    ));
    assert!(matches!(
        a1.client.leave(&one_to_one),
        Err(ClientError::NotAGroup)
    ));

    let (mut a1, _, _, conversation) = group(&relay);
    for name in ["x".repeat(65), "tvær\nlínur".into(), "\u{7}".into()] {
        assert!(matches!(
            a1.client.rename(&conversation, Some(name)),
            Err(ClientError::NameInvalid)
        ));
    }
    a1.client
        .rename(&conversation, Some("þ".repeat(64)))
        .unwrap();
}

/// An account added later, and a device that joins by external commit,
/// learn the name and the timer from a snapshot the others send; members
/// who knew them see no second card.
#[test]
fn whoever_joins_later_learns_the_name_and_the_timer() {
    let relay = Relay::new();
    let (mut a1, mut b1, mut c1, conversation) = group(&relay);
    a1.client
        .rename(&conversation, Some("Hópurinn".into()))
        .unwrap();
    a1.client
        .send(
            &conversation,
            Body::Disappearing {
                seconds: Some(3600),
            },
        )
        .unwrap();
    a1.sync();
    b1.deliver();
    c1.deliver();
    let before = items(&mut b1, &conversation).len();

    let mut d1 = Phone::new(&relay, "d", "d1");
    a1.client
        .add_accounts(&conversation, &strings(&["d"]))
        .unwrap();
    a1.sync();
    assert_eq!(joined(&d1.deliver()), vec![conversation.clone()]);
    b1.deliver();
    let d = d1.client.conversations().unwrap()[0].clone();
    assert_eq!(d.name.as_deref(), Some("Hópurinn"));
    assert_eq!(d.timer, Some(3600));
    // Only the members card of the add.
    let after = items(&mut b1, &conversation);
    assert_eq!(after.len(), before + 1, "{after:?}");
    assert!(matches!(
        after.last().unwrap().content,
        Content::Members { .. }
    ));

    let mut b2 = Phone::new(&relay, "b", "b2");
    a1.send(&conversation, "hæ");
    a1.sync();
    assert_eq!(joined(&b2.deliver()), vec![conversation.clone()]);
    for phone in [&mut a1, &mut b1, &mut c1, &mut d1] {
        phone.deliver();
    }
    b2.deliver();
    let b = b2.client.conversations().unwrap()[0].clone();
    assert_eq!(b.name.as_deref(), Some("Hópurinn"));
    assert_eq!(b.timer, Some(3600));
}

/// A member leaves on its own (0078): the server stops listing it, the
/// first member to sync removes its leaves, and it can be added again.
#[test]
fn a_member_leaves_and_can_be_added_again() {
    let relay = Relay::new();
    let (mut a1, mut b1, mut c1, conversation) = group(&relay);

    c1.client.leave(&conversation).unwrap();
    assert_eq!(c1.client.conversations().unwrap()[0].state, State::Left);
    assert!(matches!(
        c1.client.send(
            &conversation,
            Body::Text {
                text: "?".into(),
                forwarded: false
            }
        ),
        Err(ClientError::UnknownConversation)
    ));
    // The leave is idempotent where it is already done.
    c1.client.leave(&conversation).unwrap();

    assert_eq!(
        membership(&a1.deliver()),
        vec![(Vec::new(), strings(&["c"]))]
    );
    assert_eq!(
        membership(&b1.deliver()),
        vec![(Vec::new(), strings(&["c"]))]
    );
    let card = items(&mut b1, &conversation).last().unwrap().clone();
    let Content::Members { added, removed, .. } = card.content else {
        panic!("{card:?}");
    };
    assert!(added.is_empty());
    assert_eq!(
        removed
            .iter()
            .map(|p| p.account.as_str())
            .collect::<Vec<_>>(),
        ["c"]
    );
    b1.send(&conversation, "án c");
    b1.sync();
    assert_eq!(texts(&a1.deliver()), strings(&["án c"]));
    assert!(texts(&c1.deliver()).is_empty());

    b1.client
        .add_accounts(&conversation, &strings(&["c"]))
        .unwrap();
    b1.sync();
    a1.deliver();
    assert_eq!(joined(&c1.deliver()), vec![conversation.clone()]);
    assert_eq!(c1.client.conversations().unwrap()[0].state, State::Active);
    b1.send(&conversation, "aftur");
    b1.sync();
    assert_eq!(texts(&c1.deliver()), strings(&["aftur"]));
}

/// A PNG, not square, as a phone's gallery might hand over, in a file.
fn picture(dir: &TempDir, shade: u8) -> std::path::PathBuf {
    let image = image::RgbImage::from_fn(240, 160, |x, _| image::Rgb([shade, (x % 256) as u8, 40]));
    let path = dir.path().join(format!("picture-{shade}.png"));
    image.save(&path).unwrap();
    path
}

fn photo_of(phone: &mut Phone) -> Option<std::path::PathBuf> {
    phone.client.conversations().unwrap()[0].photo.clone()
}

/// What a member holds of the group photo: a 512 px JPEG, which is not the
/// file that was chosen (0094).
fn assert_made_by_the_core(path: &std::path::Path) {
    let bytes = std::fs::read(path).unwrap();
    assert_eq!(
        image::guess_format(&bytes).unwrap(),
        image::ImageFormat::Jpeg
    );
    let decoded = image::load_from_memory(&bytes).unwrap();
    assert_eq!((decoded.width(), decoded.height()), (512, 512));
}

/// A group's photo is encrypted group state like its name (0094): a card on
/// every member, the picture on each device, and clearing it is a card too.
#[test]
fn a_group_photo_reaches_every_member_and_is_cleared_the_same_way() {
    let relay = Relay::new();
    let (mut a1, mut b1, mut c1, conversation) = group(&relay);
    assert_eq!(photo_of(&mut b1), None);

    let first = picture(&a1.dir, 10);
    a1.client.set_group_photo(&conversation, &first).unwrap();
    a1.sync();
    b1.deliver();
    c1.deliver();
    assert!(relay.has_group_photo(&conversation));
    let mut seen = Vec::new();
    for phone in [&mut a1, &mut b1, &mut c1] {
        let path = photo_of(phone).expect("the photo is shown");
        assert_made_by_the_core(&path);
        seen.push(std::fs::read(&path).unwrap());
        let items = items(phone, &conversation);
        let card = items.last().unwrap();
        assert_eq!(card.content, Content::Photo { set: true });
        assert_eq!(card.sender.account, "a");
    }
    assert!(
        seen.windows(2).all(|w| w[0] == w[1]),
        "one picture on all three"
    );

    // Another member replaces it: the server keeps one, the members the new.
    let second = picture(&b1.dir, 200);
    b1.client.set_group_photo(&conversation, &second).unwrap();
    b1.sync();
    a1.deliver();
    c1.deliver();
    for phone in [&mut a1, &mut b1, &mut c1] {
        let path = photo_of(phone).expect("the photo is shown");
        assert_ne!(std::fs::read(&path).unwrap(), seen[0]);
    }

    c1.client.clear_group_photo(&conversation).unwrap();
    c1.sync();
    a1.deliver();
    b1.deliver();
    assert!(!relay.has_group_photo(&conversation));
    for phone in [&mut a1, &mut b1, &mut c1] {
        assert_eq!(photo_of(phone), None);
        let items = items(phone, &conversation);
        assert_eq!(items.last().unwrap().content, Content::Photo { set: false });
    }
}

/// The web has no file path (0094): the bytes go in and come out, and what
/// the server holds is ciphertext, not the picture.
#[test]
fn a_group_photo_from_bytes_is_stored_sealed_and_read_back_as_bytes() {
    let relay = Relay::new();
    let (mut a1, mut b1, _c1, conversation) = group(&relay);
    assert_eq!(b1.client.group_photo_bytes(&conversation).unwrap(), None);

    let source = std::fs::read(picture(&a1.dir, 10)).unwrap();
    a1.client
        .set_group_photo_bytes(&conversation, &source)
        .unwrap();
    a1.sync();
    b1.deliver();

    let seen = b1
        .client
        .group_photo_bytes(&conversation)
        .unwrap()
        .expect("the member has the photo");
    assert_eq!(&seen[..2], &[0xFF, 0xD8], "a JPEG");
    assert_eq!(
        a1.client.group_photo_bytes(&conversation).unwrap(),
        Some(seen.clone())
    );
    let kept = std::fs::read(photo_of(&mut a1).unwrap()).unwrap();
    assert_eq!(kept, seen);

    // The server holds ciphertext (0023): not a JPEG, not the sender's copy.
    let stored = relay.group_photo_object(&conversation).expect("stored");
    assert!(!stored.starts_with(&[0xFF, 0xD8, 0xFF]));
    assert_ne!(stored, kept);

    // No source is left on the sender's device.
    let out = a1.dir.path().join("media").join("out");
    assert!(
        !out.exists() || std::fs::read_dir(&out).unwrap().next().is_none(),
        "nothing of the upload is left in out/"
    );

    a1.client.clear_group_photo(&conversation).unwrap();
    a1.sync();
    b1.deliver();
    assert_eq!(b1.client.group_photo_bytes(&conversation).unwrap(), None);
    assert_eq!(a1.client.group_photo_bytes(&conversation).unwrap(), None);

    assert!(matches!(
        a1.client
            .set_group_photo_bytes(&conversation, b"not an image"),
        Err(ClientError::GroupPhoto(_))
    ));
}

/// Two people are not a group (0094): the core will not set a photo, and
/// drops one that arrives.
#[test]
fn a_conversation_of_two_has_no_group_photo() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let one_to_one = conversation(&mut a1, &mut b1);
    let file = picture(&a1.dir, 10);
    assert!(matches!(
        a1.client.set_group_photo(&one_to_one, &file),
        Err(ClientError::NotAGroup)
    ));
    assert!(matches!(
        a1.client.clear_group_photo(&one_to_one),
        Err(ClientError::NotAGroup)
    ));
    assert!(!relay.has_group_photo(&one_to_one));

    // A peer that sends one anyway (the body is well formed) is not obeyed.
    let before = items(&mut b1, &one_to_one).len();
    a1.client
        .send(
            &one_to_one,
            Body::Photo {
                photo: Some(spjall_envelope::PhotoRef {
                    id: "A".repeat(22),
                    mime: "image/jpeg".into(),
                    size: 10,
                    key: "k".into(),
                    sha256: "0".into(),
                }),
            },
        )
        .unwrap();
    a1.sync();
    b1.deliver();
    assert_eq!(photo_of(&mut b1), None);
    assert_eq!(items(&mut b1, &one_to_one).len(), before);
}

/// An account added later, and a device that joins by external commit,
/// learn the photo from the snapshot the others send (0094).
#[test]
fn whoever_joins_later_learns_the_group_photo() {
    let relay = Relay::new();
    let (mut a1, mut b1, mut c1, conversation) = group(&relay);
    let file = picture(&a1.dir, 77);
    a1.client.set_group_photo(&conversation, &file).unwrap();
    a1.sync();
    b1.deliver();
    c1.deliver();

    let mut d1 = Phone::new(&relay, "d", "d1");
    a1.client
        .add_accounts(&conversation, &strings(&["d"]))
        .unwrap();
    a1.sync();
    assert_eq!(joined(&d1.deliver()), vec![conversation.clone()]);
    d1.deliver();
    assert_made_by_the_core(&photo_of(&mut d1).expect("the new member sees it"));

    let mut b2 = Phone::new(&relay, "b", "b2");
    a1.send(&conversation, "hæ");
    a1.sync();
    assert_eq!(joined(&b2.deliver()), vec![conversation.clone()]);
    for phone in [&mut a1, &mut b1, &mut c1, &mut d1] {
        phone.deliver();
    }
    b2.deliver();
    assert_made_by_the_core(&photo_of(&mut b2).expect("the new device sees it"));
}
