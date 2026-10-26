use crate::common::{classic, conversation, items, membership, shown, strings, texts};
use crate::phone::Phone;
use crate::relay::Relay;
use spjall_client::api::ApiError;
use spjall_client::{ClientError, Event};
use spjall_envelope::Body;

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
