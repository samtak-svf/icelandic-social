use crate::common::{conversation, group, items, joined, membership, strings, texts};
use crate::phone::Phone;
use crate::relay::Relay;
use spjall_client::{ClientError, Content, State};
use spjall_envelope::Body;

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
