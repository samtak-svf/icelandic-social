use crate::common::{classic, conversation, joined, membership, strings, texts};
use crate::phone::Phone;
use crate::relay::Relay;
use spjall_client::api::ApiError;
use spjall_client::{ClientError, Event, State};
use spjall_envelope::Body;
use spjall_mls::group::GroupError;

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
