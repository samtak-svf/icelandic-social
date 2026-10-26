use crate::common::{conversation, notices};
use crate::phone::{KEY, Phone};
use crate::relay::Relay;
use spjall_client::api::ApiError;
use spjall_client::{ClientError, Event, Mute, MuteFor, NoticeKind};

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
