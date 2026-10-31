//! Friends, snoozes and suggestions (0114) as the client reads them.

#![allow(clippy::disallowed_methods)] // tests use files

#[path = "support/hosted.rs"]
mod hosted;
#[path = "support/relay.rs"]
#[allow(dead_code)]
mod relay;

use hosted::{Phone, author};
use serde_json::{Value, json};
use spjall_client::ClientError;
use spjall_client::api::{
    ApiError, FriendSort, Method, NotificationKind, NotificationLevel, Relation,
};

const AT: u64 = 1_760_000_400_000;

fn person(relation: &str) -> Value {
    json!({
        "accountId": "acc_b", "name": "Sigrún Jónsdóttir", "verified": true,
        "relation": relation, "friendCount": 3, "mutualCount": 1,
        "mutualFriends": [author("acc_c")], "sharedCommunities": [],
    })
}

/// Every state the contract names, and one it may name later.
#[test]
fn a_relation_reads_as_itself_and_a_later_one_as_unknown() {
    let phone = Phone::signed_in();
    let hosted = phone.client.hosted();
    for (wire, relation) in [
        ("self", Relation::Oneself),
        ("none", Relation::None),
        ("sent", Relation::Sent),
        ("incoming", Relation::Incoming),
        ("friends", Relation::Friends),
        ("blocked_later", Relation::Unknown),
    ] {
        phone.answer(200, person(wire));
        assert_eq!(hosted.person("acc_b").unwrap().relation, relation, "{wire}");
    }
    let sent = phone.sent();
    assert_eq!(sent[0].0, Method::Get);
    assert_eq!(sent[0].1, "/v1/people/acc_b");
}

/// What only a friend has reads when the server sends it.
#[test]
fn a_friend_carries_since_when_and_a_snooze() {
    let phone = Phone::signed_in();
    let mut friend = person("friends");
    friend["friendsSince"] = json!(AT);
    friend["snoozedUntil"] = json!(AT + 1);
    phone.answer(200, friend);
    let read = phone.client.hosted().person("acc_b").unwrap();
    assert_eq!(read.friends_since, Some(AT));
    assert_eq!(read.snoozed_until, Some(AT + 1));
    assert_eq!(read.mutual_friends[0].account_id, "acc_c");
    phone.sent();
}

#[test]
fn the_friend_list_sends_its_order_and_only_a_real_query() {
    let phone = Phone::signed_in();
    let page = json!({ "count": 1, "friends": [{ "person": author("acc_b"), "since": AT }] });
    phone.answer(200, page.clone());
    phone.answer(200, page);
    let hosted = phone.client.hosted();
    let read = hosted.friends(Some("  "), FriendSort::Newest).unwrap();
    assert_eq!((read.count, read.friends[0].since), (1, AT));
    hosted.friends(Some("sig"), FriendSort::Name).unwrap();
    let sent = phone.sent();
    assert_eq!(sent[0].1, "/v1/friends?sort=newest");
    assert_eq!(sent[1].1, "/v1/friends?q=sig&sort=name");
}

#[test]
fn the_requests_read_both_ways() {
    let phone = Phone::signed_in();
    phone.answer(
        200,
        json!({
            "incoming": [{ "person": author("acc_b"), "sentAt": AT }],
            "sent": [{ "person": author("acc_c"), "sentAt": AT + 1 }],
        }),
    );
    let requests = phone.client.hosted().friend_requests().unwrap();
    assert_eq!(requests.incoming[0].person.account_id, "acc_b");
    assert_eq!(requests.sent[0].sent_at, AT + 1);
    assert_eq!(phone.sent()[0].1, "/v1/friend-requests");
}

/// Asking someone who had already asked makes friends at once, and the app
/// reads which of the two came back.
#[test]
fn asking_answers_with_where_it_left_things() {
    let phone = Phone::signed_in();
    phone.answer(200, json!({ "relation": "sent" }));
    phone.answer(200, json!({ "relation": "friends" }));
    let hosted = phone.client.hosted();
    assert_eq!(hosted.send_friend_request("acc_b").unwrap(), Relation::Sent);
    assert_eq!(
        hosted.send_friend_request("acc_b").unwrap(),
        Relation::Friends
    );
    let sent = phone.sent();
    assert_eq!(sent[0].0, Method::Put);
    assert_eq!(sent[0].1, "/v1/friend-requests/acc_b");
}

#[test]
fn each_answer_to_a_request_has_its_own_route() {
    let phone = Phone::signed_in();
    for _ in 0..4 {
        phone.ok();
    }
    let hosted = phone.client.hosted();
    hosted.cancel_friend_request("acc_b").unwrap();
    hosted.accept_friend_request("acc_b").unwrap();
    hosted.decline_friend_request("acc_b").unwrap();
    hosted.end_friendship("acc_b").unwrap();
    let sent: Vec<_> = phone.sent().into_iter().map(|s| (s.0, s.1)).collect();
    assert_eq!(
        sent,
        [
            (Method::Delete, "/v1/friend-requests/acc_b".to_owned()),
            (Method::Post, "/v1/friend-requests/acc_b/accept".to_owned()),
            (Method::Post, "/v1/friend-requests/acc_b/decline".to_owned()),
            (Method::Delete, "/v1/friends/acc_b".to_owned()),
        ]
    );
}

#[test]
fn a_snooze_says_until_when_and_can_end() {
    let phone = Phone::signed_in();
    phone.answer(200, json!({ "until": AT }));
    phone.answer(
        200,
        json!({ "snoozed": [{ "person": author("acc_b"), "until": AT }] }),
    );
    phone.ok();
    let hosted = phone.client.hosted();
    assert_eq!(hosted.snooze_person("acc_b").unwrap(), AT);
    assert_eq!(hosted.snoozes().unwrap()[0].until, AT);
    hosted.unsnooze_person("acc_b").unwrap();
    let sent: Vec<_> = phone.sent().into_iter().map(|s| (s.0, s.1)).collect();
    assert_eq!(
        sent,
        [
            (Method::Put, "/v1/snoozes/acc_b".to_owned()),
            (Method::Get, "/v1/snoozes".to_owned()),
            (Method::Delete, "/v1/snoozes/acc_b".to_owned()),
        ]
    );
}

/// An id that would change the route never leaves the device.
#[test]
fn a_bad_id_stops_here() {
    let phone = Phone::signed_in();
    let hosted = phone.client.hosted();
    assert!(matches!(
        hosted.send_friend_request("acc/../x"),
        Err(ClientError::Invalid(_))
    ));
    assert!(phone.sent().is_empty());
}

#[test]
fn a_refusal_of_a_request_stays_typed() {
    let phone = Phone::signed_in();
    phone.answer(429, json!({ "error": "rate_limited", "requestId": "r1" }));
    let refused = phone.client.hosted().send_friend_request("acc_b");
    let Err(ClientError::Transport(ApiError::Refused {
        status: 429, code, ..
    })) = refused
    else {
        panic!("{refused:?}")
    };
    assert_eq!(code, "rate_limited");
    phone.sent();
}

/// A friend's notices have levels of their own in the settings (0114).
#[test]
fn a_friends_notices_have_their_own_levels() {
    let phone = Phone::signed_in();
    phone.answer(
        200,
        json!({
            "kinds": { "friend_request": "off", "friend_accepted": "in_app" },
            "communities": [],
        }),
    );
    let settings = phone.client.hosted().notification_settings().unwrap();
    assert_eq!(
        settings.kinds[5..],
        [
            (NotificationKind::FriendRequest, NotificationLevel::Off),
            (NotificationKind::FriendAccepted, NotificationLevel::InApp),
        ]
    );
    phone.sent();
}

/// A suggestion is the row a friend is: the server's profile, photo and all, and
/// a cursor to the next page.
#[test]
fn a_suggestion_reads_as_the_row_a_friend_has_with_its_cursor() {
    let phone = Phone::signed_in();
    let mut row = author("acc_b");
    row["photo"] = json!("ph_1");
    row["photoFrames"] = Value::Null;
    phone.answer(200, json!({ "people": [row], "next": "c2" }));
    phone.answer(200, json!({ "people": [], "next": null }));
    let hosted = phone.client.hosted();
    let first = hosted.friend_suggestions(None, 20).unwrap();
    assert_eq!(first.people[0].account_id, "acc_b");
    assert_eq!(first.people[0].name.as_deref(), Some("Sigrún Jónsdóttir"));
    assert!(first.people[0].verified);
    assert_eq!(first.people[0].photo.as_deref(), Some("ph_1"));
    assert_eq!(first.next.as_deref(), Some("c2"));
    let last = hosted
        .friend_suggestions(first.next.as_deref(), 20)
        .unwrap();
    assert!(last.people.is_empty());
    assert_eq!(last.next, None);
    let sent = phone.sent();
    assert_eq!(sent[0].0, Method::Get);
    assert_eq!(sent[0].1, "/v1/friend-suggestions?limit=20");
    assert_eq!(sent[1].1, "/v1/friend-suggestions?after=c2&limit=20");
}

/// The server refuses a limit outside 1 to 50, and a blank cursor is not one.
#[test]
fn a_page_of_suggestions_stays_within_what_the_server_takes() {
    let phone = Phone::signed_in();
    let page = json!({ "people": [], "next": null });
    phone.answer(200, page.clone());
    phone.answer(200, page);
    let hosted = phone.client.hosted();
    hosted.friend_suggestions(Some("  "), 500).unwrap();
    hosted.friend_suggestions(None, 0).unwrap();
    let sent = phone.sent();
    assert_eq!(sent[0].1, "/v1/friend-suggestions?limit=50");
    assert_eq!(sent[1].1, "/v1/friend-suggestions?limit=1");
}

#[test]
fn the_suggestion_setting_reads_both_ways() {
    let phone = Phone::signed_in();
    phone.answer(200, json!({ "included": true }));
    phone.answer(200, json!({ "included": false }));
    let hosted = phone.client.hosted();
    assert!(hosted.friend_suggestions_included().unwrap());
    assert!(!hosted.friend_suggestions_included().unwrap());
    let sent = phone.sent();
    assert_eq!(sent[0].0, Method::Get);
    assert_eq!(sent[0].1, "/v1/friend-suggestion-settings");
}

/// Stepping out and back in are the one write, and the body says which.
#[test]
fn opting_out_of_suggestions_writes_what_it_says() {
    let phone = Phone::signed_in();
    phone.ok();
    phone.ok();
    let hosted = phone.client.hosted();
    hosted.set_friend_suggestions_included(false).unwrap();
    hosted.set_friend_suggestions_included(true).unwrap();
    let sent = phone.sent();
    assert_eq!(
        sent,
        [
            (
                Method::Put,
                "/v1/friend-suggestion-settings".to_owned(),
                json!({ "included": false })
            ),
            (
                Method::Put,
                "/v1/friend-suggestion-settings".to_owned(),
                json!({ "included": true })
            ),
        ]
    );
}

/// An answer that is not the contract's says so rather than reading as nobody
/// suggested, or as taking part.
#[test]
fn a_malformed_suggestion_answer_is_an_error_not_an_empty_page() {
    let phone = Phone::signed_in();
    let hosted = phone.client.hosted();
    for (body, what) in [
        (json!({ "next": null }), "listFriendSuggestions"),
        (
            json!({ "people": [{ "accountId": "acc_b" }], "next": null }),
            "listFriendSuggestions",
        ),
    ] {
        phone.answer(200, body);
        let read = hosted.friend_suggestions(None, 20);
        assert!(
            matches!(read, Err(ClientError::Transport(ApiError::Malformed(w))) if w == what),
            "{read:?}"
        );
    }
    phone.answer(200, json!({ "included": "yes" }));
    let read = hosted.friend_suggestions_included();
    assert!(
        matches!(
            read,
            Err(ClientError::Transport(ApiError::Malformed(
                "friendSuggestionSettings"
            )))
        ),
        "{read:?}"
    );
    phone.sent();
}

/// A refused write did not happen, and the app has to hear that: the switch must
/// not read as off while the account is still suggested.
#[test]
fn a_refused_opt_out_stays_typed() {
    let phone = Phone::signed_in();
    phone.answer(
        400,
        json!({ "error": "invalid_request", "requestId": "r1" }),
    );
    let refused = phone.client.hosted().set_friend_suggestions_included(false);
    let Err(ClientError::Transport(ApiError::Refused {
        status: 400, code, ..
    })) = refused
    else {
        panic!("{refused:?}")
    };
    assert_eq!(code, "invalid_request");
    phone.sent();
}

/// Any refusal of the read, a server's 404 among them, stays the typed error and
/// never reads as nobody to suggest.
#[test]
fn a_refused_suggestion_read_is_not_an_empty_page() {
    let phone = Phone::signed_in();
    phone.answer(404, json!({ "error": "not_found", "requestId": "r1" }));
    let refused = phone.client.hosted().friend_suggestions(None, 20);
    let Err(ClientError::Transport(ApiError::Refused {
        status: 404, code, ..
    })) = refused
    else {
        panic!("{refused:?}")
    };
    assert_eq!(code, "not_found");
    phone.sent();
}
