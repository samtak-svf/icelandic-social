use crate::common::{conversation, items, notices, photo, strings, urgency};
use crate::phone::Phone;
use crate::relay::Relay;
use spjall_client::{ClientError, NoticeKind};
use spjall_envelope::Body;

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
