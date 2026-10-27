//! The action a notification carries (0063): its own type, apart from the
//! one a moderator sends.

#![allow(clippy::disallowed_methods)] // tests use files

#[path = "support/hosted.rs"]
mod hosted;
#[path = "support/relay.rs"]
#[allow(dead_code)]
mod relay;

use hosted::Phone;
use serde_json::{Value, json};
use spjall_client::api::NotificationAction;

/// The notification's own action type: a declined anonymous post is told
/// apart, a value a later server adds is kept as `Unknown`, and an absent one
/// stays none.
#[test]
fn a_notification_action_reads_decline_anonymous_post_and_keeps_an_unheard_of_one() {
    let phone = Phone::signed_in();
    let row = |id: &str, action: Value| {
        json!({
            "notificationId": id, "kind": "moderated", "actor": null,
            "actors": [], "actorCount": 0, "communityId": "cm_1",
            "postId": null, "commentId": null, "action": action, "emoji": null,
            "createdAt": 1_760_000_400_000u64, "read": false,
            "snippet": null, "announce": false,
        })
    };
    phone.answer(
        200,
        json!({
            "notifications": [
                row("n_3", json!("decline_anonymous_post")),
                row("n_2", json!("some_future_action")),
                row("n_1", json!("hide_post")),
                row("n_0", Value::Null),
            ],
            "unread": 4, "unseen": 0, "seenAt": null, "next": null,
        }),
    );
    let page = phone.client.notifications(None, 20).unwrap();
    let actions: Vec<_> = page
        .notifications
        .iter()
        .map(|n| (n.notification_id.as_str(), n.action))
        .collect();
    assert_eq!(
        actions,
        [
            ("n_3", Some(NotificationAction::DeclineAnonymousPost)),
            ("n_2", Some(NotificationAction::Unknown)),
            ("n_1", Some(NotificationAction::HidePost)),
            ("n_0", None),
        ]
    );
}

/// The notice carries the action through, so an app can word it.
#[test]
fn a_social_notice_carries_the_notification_action() {
    let mut phone = Phone::signed_in();
    let page = |rows: Vec<Value>| json!({ "notifications": rows, "unread": 0, "unseen": 0, "seenAt": null, "next": null });
    let row = json!({
        "notificationId": "n_1", "kind": "moderated", "actor": null,
        "actors": [], "actorCount": 0, "communityId": "cm_1",
        "postId": null, "commentId": null, "action": "decline_anonymous_post",
        "emoji": null, "createdAt": 100, "read": false,
        "snippet": null, "announce": true,
    });
    // The first run seeds; the row announced next is a later one.
    phone.answer(200, page(vec![]));
    assert!(phone.client.notices().unwrap().social.is_empty());
    phone.answer(200, page(vec![row]));
    let notices = phone.client.notices().unwrap();
    assert_eq!(notices.social.len(), 1);
    assert_eq!(
        notices.social[0].action,
        Some(NotificationAction::DeclineAnonymousPost)
    );
}
