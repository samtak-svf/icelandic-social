use crate::common::{classic, conversation, devices, items, joined, membership, strings, texts};
use crate::phone::{KEY, Phone};
use crate::relay::Relay;
use spjall_client::api::ApiError;
use spjall_client::{ClientError, Event, State, Status};
use spjall_mls::group::forge;

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
