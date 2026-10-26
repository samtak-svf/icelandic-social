use crate::common::{conversation, items, newest, notices_of, two_conversations, urgency};
use crate::phone::Phone;
use crate::relay::Relay;
use spjall_client::{ClientError, Content, NoticeKind};
use spjall_envelope::Body;

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
