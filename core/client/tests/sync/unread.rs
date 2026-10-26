use crate::common::{conversation, items, strings, texts};
use crate::phone::Phone;
use crate::relay::Relay;
use spjall_client::api::ApiError;
use spjall_client::{ClientError, Content, Event, Settings, Status};
use spjall_envelope::Body;

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
