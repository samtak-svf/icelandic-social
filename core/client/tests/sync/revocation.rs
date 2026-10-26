use crate::common::{conversation, joined, membership, strings, texts, with_a_sibling};
use crate::phone::Phone;
use crate::relay::Relay;
use spjall_client::api::{ApiError, Platform};
use spjall_client::{ClientError, State};

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
