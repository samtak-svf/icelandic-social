use crate::common::{items, media_gets, newest, photo, two_conversations};
use crate::phone::Phone;
use crate::relay::Relay;
use spjall_client::{ClientError, Content, Unforwardable};
use spjall_envelope::Body;

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
