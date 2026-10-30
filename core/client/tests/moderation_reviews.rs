//! The statement of reasons, the single review and the tombstone (0063, 0115)
//! as the client reads them, and that each new value reads as itself.

#![allow(clippy::disallowed_methods)] // tests use files

#[path = "support/hosted.rs"]
mod hosted;
#[path = "support/relay.rs"]
#[allow(dead_code)]
mod relay;

use hosted::Phone;
use serde_json::{Value, json};
use spjall_client::api::{
    Me, Method, ModerationLogAction, ModerationReviewState, ModerationState, NotificationAction,
    ReviewOutcome,
};

const AT: u64 = 1_760_000_400_000;

/// A removed post a member reads where it stood: no author, no text.
#[test]
fn a_tombstone_reads_with_no_author_and_no_text() {
    let phone = Phone::signed_in();
    phone.answer(
        200,
        json!({
            "postId": "post_1", "communityId": "cm_1", "author": null, "body": "", "media": [],
            "createdAt": AT, "emojis": [], "myEmoji": null, "commentCount": 0,
            "state": "removed",
        }),
    );
    let post = phone.client.hosted().post("post_1").unwrap();
    assert_eq!(post.author, None);
    assert_eq!(post.body, "");
    assert_eq!(post.state, ModerationState::Removed);
}

/// Each notice 0115 adds reads as itself, and a null community does not fail
/// the page.
#[test]
fn the_new_notices_read_as_themselves_with_no_community() {
    let phone = Phone::signed_in();
    let row = |id: &str, action: &str, community: Value| {
        json!({
            "notificationId": id, "kind": "moderated", "actor": null,
            "actors": [], "actorCount": 0, "communityId": community,
            "postId": null, "commentId": null, "action": action, "emoji": null,
            "createdAt": AT, "read": false, "snippet": null, "announce": false,
        })
    };
    phone.answer(
        200,
        json!({
            "notifications": [
                row("n_3", "clear_account_photo", Value::Null),
                row("n_2", "review_upheld", json!("cm_1")),
                row("n_1", "review_overturned", Value::Null),
                row("n_0", "suspend_account", Value::Null),
                row("n_z", "unsuspend_account", Value::Null),
            ],
            "unread": 5, "unseen": 5, "seenAt": null, "next": null,
        }),
    );
    let page = phone.client.hosted().notifications(None, 50).unwrap();
    let got: Vec<_> = page
        .notifications
        .iter()
        .map(|n| (n.action, n.community_id.is_none()))
        .collect();
    assert_eq!(
        got,
        [
            (Some(NotificationAction::ClearAccountPhoto), true),
            (Some(NotificationAction::ReviewUpheld), false),
            (Some(NotificationAction::ReviewOverturned), true),
            (Some(NotificationAction::SuspendAccount), true),
            (Some(NotificationAction::UnsuspendAccount), true),
        ]
    );
}

#[test]
fn a_statement_reads_with_its_review_and_never_names_who_acted() {
    let phone = Phone::signed_in();
    phone.answer(
        200,
        json!({
            "statements": [
                {
                    "entryId": 7, "action": "remove_post",
                    "target": { "kind": "post", "id": "post_1" }, "communityId": "cm_1",
                    "reason": "off topic", "createdAt": AT, "until": 1_800_000_000_000_u64,
                    "body": "the text", "canAsk": true, "review": null,
                },
                {
                    "entryId": 6, "action": "clear_account_photo",
                    "target": { "kind": "account", "id": "acc_1" }, "communityId": null,
                    "reason": "not a person", "createdAt": AT, "body": null, "canAsk": false,
                    "review": {
                        "state": "overturned", "askedAt": AT, "decidedAt": AT,
                        "reason": "a mistake", "restored": false,
                    },
                },
            ],
            "next": "6",
        }),
    );
    let page = phone
        .client
        .hosted()
        .moderation_statements(Some("8"), 1_000)
        .unwrap();
    let canned = phone.canned.lock().unwrap();
    let asked = canned.seen.last().unwrap();
    assert!(asked.path.starts_with("/v1/moderation/statements?"));
    assert!(asked.path.contains("before=8"));
    assert!(asked.path.contains("limit=100"), "{}", asked.path);
    assert_eq!(page.next.as_deref(), Some("6"));
    let [first, second] = page.statements.as_slice() else {
        panic!("two statements");
    };
    assert_eq!(first.action, ModerationLogAction::RemovePost);
    assert_eq!(first.body.as_deref(), Some("the text"));
    assert_eq!(first.until, Some(1_800_000_000_000));
    assert_eq!(second.until, None, "a server before the field");
    assert!(first.can_ask && first.review.is_none());
    let review = second.review.as_ref().unwrap();
    assert_eq!(second.action, ModerationLogAction::ClearAccountPhoto);
    assert_eq!(review.state, ModerationReviewState::Overturned);
    assert!(!review.restored);
}

#[test]
fn a_person_asks_and_a_moderator_answers() {
    let phone = Phone::signed_in();
    phone.answer(204, Value::Null);
    phone.client.hosted().ask_moderation_review(7).unwrap();
    phone.answer(204, Value::Null);
    phone
        .client
        .hosted()
        .decide_moderation_review(7, ReviewOutcome::Overturned, "  a mistake ")
        .unwrap();
    let canned = phone.canned.lock().unwrap();
    let [.., ask, decide] = canned.seen.as_slice() else {
        panic!("two calls");
    };
    assert_eq!(ask.method, Method::Post);
    assert_eq!(ask.path, "/v1/moderation/statements/7/review");
    assert_eq!(decide.path, "/v1/moderation/reviews/7");
    let sent: Value = serde_json::from_str(decide.body.as_deref().unwrap()).unwrap();
    assert_eq!(
        sent,
        json!({ "outcome": "overturned", "reason": "a mistake" })
    );
}

#[test]
fn a_decision_needs_a_reason_and_the_queue_reads() {
    let phone = Phone::signed_in();
    let hosted = phone.client.hosted();
    assert!(
        hosted
            .decide_moderation_review(7, ReviewOutcome::Upheld, "  ")
            .is_err()
    );
    phone.answer(
        200,
        json!({
            "reviews": [{
                "entryId": 7, "action": "hide_comment",
                "target": { "kind": "comment", "id": "post_1-c" }, "communityId": "cm_1",
                "postId": "post_1", "actor": null, "targetAccount": null, "reason": "rude",
                "createdAt": AT, "body": null, "askedAt": AT, "canDecide": false,
            }],
            "next": null,
        }),
    );
    let page = hosted.open_moderation_reviews(None, 50).unwrap();
    let [review] = page.reviews.as_slice() else {
        panic!("one review");
    };
    assert_eq!(review.post_id.as_deref(), Some("post_1"));
    assert!(review.body.is_none() && !review.can_decide);
}

/// `Me` reads the two fields of decision 0115, and a server before them reads
/// as nobody suspended and no platform moderator. `/v1/me` goes to the relay in
/// these tests, so this reads the body directly.
#[test]
fn me_reads_a_suspension_and_a_server_before_it_reads_as_none() {
    let me = |more: Value| -> Me {
        let mut body = json!({
            "accountId": "acct_1", "name": null, "verified": true, "photo": null, "devices": [],
        });
        body.as_object_mut()
            .unwrap()
            .extend(more.as_object().unwrap().clone());
        serde_json::from_value(body).unwrap()
    };

    let got = me(json!({ "suspension": { "until": AT }, "platformModerator": true }));
    assert_eq!(got.suspension.map(|s| s.until), Some(Some(AT)));
    assert!(got.platform_moderator);

    let got = me(json!({ "suspension": { "until": null }, "platformModerator": false }));
    assert_eq!(got.suspension.map(|s| s.until), Some(None));
    assert!(!got.platform_moderator);

    let got = me(json!({}));
    assert_eq!(got.suspension, None);
    assert!(!got.platform_moderator);
}
