use crate::common::{conversation, items, joined, notices_of, strings, texts};
use crate::phone::{KEY, Phone};
use crate::relay::Relay;
use spjall_client::{ClientError, Content, Event, NoticeKind};
use spjall_envelope::Body;

#[test]
fn people_are_named_by_the_server() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let mut c1 = Phone::new(&relay, "c", "c1");
    assert!(a1.client.people().unwrap().is_empty());
    // Every account is named to every signed-in one, without sharing
    // anything (0034, 0036).
    assert_eq!(
        a1.client.profile("c").unwrap().name.as_deref(),
        Some("Name of c")
    );

    let conversation = a1.client.create_conversation(&strings(&["b"])).unwrap();
    let events = a1.sync();
    // This account's own name too: its quotes and cards show it (#68).
    assert!(events.contains(&Event::Profiles {
        accounts: strings(&["a", "b"])
    }));
    b1.deliver();
    a1.send(&conversation, "hæ");
    a1.sync();
    let own = items(&mut a1, &conversation).pop().unwrap();
    assert!(own.own);
    assert_eq!(own.sender.name.as_deref(), Some("Name of a"));
    assert!(
        !relay
            .requests("a1")
            .iter()
            .any(|r| r.path == "/v1/accounts/a"),
        "the server names no one to themselves; /v1/me does"
    );
    let people = a1.client.people().unwrap();
    assert_eq!(people.len(), 1);
    assert_eq!(people[0].name.as_deref(), Some("Name of b"));
    assert!(people[0].verified);
    let listed = a1.client.conversations().unwrap();
    assert_eq!(listed[0].members, people);
    // Fetched once, then from the store.
    let asked = || {
        relay
            .requests("a1")
            .iter()
            .filter(|r| r.path == "/v1/accounts/b")
            .count()
    };
    assert_eq!(asked(), 1);
    a1.sync();
    assert_eq!(asked(), 1);

    a1.client
        .add_accounts(&conversation, &strings(&["c"]))
        .unwrap();
    a1.sync();
    c1.deliver();
    assert_eq!(
        a1.client.profile("c").unwrap().name.as_deref(),
        Some("Name of c")
    );
}

/// The conversation list is searched by the names in each title, at the
/// start of a word and without the Icelandic letters (0038), on this device
/// alone.
#[test]
fn conversations_are_found_by_the_start_of_a_name() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let mut c1 = Phone::new(&relay, "c", "c1");
    let with_b = conversation(&mut a1, &mut b1);
    let with_c = conversation(&mut a1, &mut c1);
    let mut store = spjall_store::Store::open(a1.dir.path(), &KEY).unwrap();
    store
        .write(|tx| {
            tx.execute(
                "UPDATE profiles SET name = 'Þórdís Ýr Ævarsdóttir' WHERE account = 'b'",
                [],
            )?;
            tx.execute(
                "UPDATE profiles SET name = 'Sóley Bergs-Guðnadóttir' WHERE account = 'c'",
                [],
            )
        })
        .unwrap();
    drop(store);
    let asked = relay.requests("a1").len();

    let found = |phone: &mut Phone, search: &str| -> Vec<String> {
        phone
            .client
            .search_conversations(search)
            .unwrap()
            .into_iter()
            .map(|c| c.id)
            .collect()
    };
    for (search, expected) in [
        ("thor", vec![with_b.clone()]),
        ("Þór", vec![with_b.clone()]),
        ("aevars", vec![with_b.clone()]),
        ("gudna", vec![with_c.clone()]),
        ("dottir", vec![]),
        ("  ", vec![with_c.clone(), with_b.clone()]),
    ] {
        assert_eq!(found(&mut a1, search), expected, "{search:?}");
    }
    assert!(matches!(
        a1.client.search_conversations(&"þ".repeat(101)),
        Err(ClientError::Invalid(_))
    ));
    assert_eq!(
        relay.requests("a1").len(),
        asked,
        "searched on the phone alone"
    );
}

/// The list's search shows a person once (0038): someone whose 1:1 the
/// conversations found is left out of the people from the directory, and
/// someone met only in a group is not.
#[test]
fn the_list_search_shows_no_one_twice() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let mut c1 = Phone::new(&relay, "c", "c1");
    let _d1 = Phone::new(&relay, "d", "d1");
    let with_b = conversation(&mut a1, &mut b1);
    let group = a1
        .client
        .create_conversation(&strings(&["c", "d"]))
        .unwrap();
    a1.sync();
    c1.deliver();

    let found = a1.client.search_list("name", 20).unwrap();
    let ids: Vec<&str> = found.conversations.iter().map(|c| c.id.as_str()).collect();
    assert_eq!(ids, vec![group.as_str(), with_b.as_str()]);
    let people: Vec<&str> = found.people.iter().map(|p| p.account.as_str()).collect();
    assert_eq!(people, vec!["c", "d"], "b is reached through the 1:1 above");

    // A blank search is the list itself and asks the directory nothing.
    let asked = relay.requests("a1").len();
    let blank = a1.client.search_list("  ", 20).unwrap();
    assert_eq!(blank.conversations.len(), 2);
    assert!(blank.people.is_empty());
    assert_eq!(relay.requests("a1").len(), asked);
}

#[test]
fn an_invite_opens_a_one_to_one_with_its_maker() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let link = a1.client.rotate_invite().unwrap();
    let token = spjall_client::invite_token(&link).unwrap();

    assert!(matches!(
        a1.client.open_invite(&token),
        Err(ClientError::Invalid(_))
    ));
    let one = b1.client.open_invite(&token).unwrap();
    b1.sync();
    assert_eq!(joined(&a1.deliver()), vec![one.clone()]);
    assert_eq!(b1.client.open_invite(&token).unwrap(), one);
    assert_eq!(
        a1.client.conversations().unwrap()[0].members[0].account,
        "b"
    );

    // A group with the inviter is not the 1:1.
    let mut c1 = Phone::new(&relay, "c", "c1");
    let group = conversation(&mut a1, &mut c1);
    a1.client.add_accounts(&group, &strings(&["b"])).unwrap();
    a1.sync();
    b1.deliver();
    assert_eq!(b1.client.open_invite(&token).unwrap(), one);
}

#[test]
fn anyone_in_fljotid_opens_a_one_to_one_without_a_link() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let mut c1 = Phone::new(&relay, "c", "c1");

    assert!(matches!(
        a1.client.open_direct("a"),
        Err(ClientError::Invalid(_))
    ));
    assert!(matches!(
        a1.client.open_direct("not an id"),
        Err(ClientError::Invalid(_))
    ));
    // b found a by name (0036): no invite, no shared conversation before.
    let one = b1.client.open_direct("a").unwrap();
    b1.sync();
    assert_eq!(joined(&a1.deliver()), vec![one.clone()]);
    assert_eq!(b1.client.open_direct("a").unwrap(), one);
    // From the other side it is the same 1:1, not a second one.
    assert_eq!(a1.client.open_direct("b").unwrap(), one);
    a1.send(&one, "hæ");
    a1.sync();
    assert_eq!(texts(&b1.deliver()), vec!["hæ"]);

    // A group with both is not the 1:1.
    let group = conversation(&mut a1, &mut c1);
    a1.client.add_accounts(&group, &strings(&["b"])).unwrap();
    a1.sync();
    b1.deliver();
    assert_eq!(b1.client.open_direct("a").unwrap(), one);

    // Nor with an account this one blocked.
    c1.client.block("b").unwrap();
    assert!(matches!(
        c1.client.open_direct("b"),
        Err(ClientError::Invalid(_))
    ));
}

/// 0044: a post shared under 0040 still reads as its id. The item, the
/// list's last line and the notice name nothing of the post, and nothing
/// asks the server for it: the posts are deleted.
#[test]
fn a_shared_post_from_before_0044_reads_as_its_id_and_asks_the_server_nothing() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let conversation = conversation(&mut b1, &mut a1);
    b1.client.notices().unwrap();

    for bad in ["", "../posts", "a b"] {
        assert!(matches!(
            b1.client.send(
                &conversation,
                Body::Post {
                    post_id: bad.into(),
                    forwarded: false,
                }
            ),
            Err(ClientError::Invalid(_))
        ));
    }
    let shared = Content::Post {
        post_id: "post_0001".into(),
    };
    // b shares a post by its id (0080).
    b1.client
        .send(
            &conversation,
            Body::Post {
                post_id: "post_0001".into(),
                forwarded: false,
            },
        )
        .unwrap();
    b1.sync();
    a1.deliver();

    let item = items(&mut a1, &conversation).pop().unwrap();
    assert_eq!(item.content, shared);
    let listed = a1.client.conversations().unwrap().pop().unwrap();
    assert_eq!(listed.last.as_ref().map(|i| &i.content), Some(&shared));
    assert_eq!(listed.unread, 1);
    let shown = a1.client.notices().unwrap().shown;
    assert_eq!(
        notices_of(&shown),
        vec![(conversation.clone(), "b".into(), NoticeKind::Post, None)]
    );
    assert!(
        !relay
            .requests("a1")
            .iter()
            .any(|r| r.path.contains("/posts") || r.path.contains("/feed"))
    );
}
