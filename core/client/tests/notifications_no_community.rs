//! A notification with no community (0114) as the core decodes it.

#![allow(clippy::disallowed_methods)] // tests use files

#[path = "support/hosted.rs"]
mod hosted;
#[path = "support/relay.rs"]
#[allow(dead_code)]
mod relay;

use hosted::Phone;
use serde_json::{Value, json};

/// A row with no community decodes, and does not cost the page its other rows:
/// before this, one null failed the decode of the whole page.
#[test]
fn a_notification_with_no_community_does_not_fail_the_page() {
    let phone = Phone::signed_in();
    let row = |id: &str, community: Value| {
        json!({
            "notificationId": id,
            "kind": "moderated",
            "actor": null,
            "communityId": community,
            "postId": null,
            "commentId": null,
            "action": "hide_post",
            "createdAt": 1_760_000_400_000u64,
            "read": false,
        })
    };
    phone.answer(
        200,
        json!({
            "notifications": [row("n_2", Value::Null), row("n_1", json!("cm_1"))],
            "unread": 2,
            "next": null,
        }),
    );
    let page = phone.client.hosted().notifications(None, 20).unwrap();
    let communities: Vec<_> = page
        .notifications
        .iter()
        .map(|n| (n.notification_id.as_str(), n.community_id.as_deref()))
        .collect();
    assert_eq!(communities, [("n_2", None), ("n_1", Some("cm_1"))]);
}
