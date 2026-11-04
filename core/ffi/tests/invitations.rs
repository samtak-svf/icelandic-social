//! Community invitations (0130) through the exported client, as an app calls
//! them: the notice, the inviter on a community and the moderator's calls.

#[path = "support/app.rs"]
#[allow(dead_code)]
mod app;
#[path = "../../client/tests/support/relay.rs"]
#[allow(dead_code)]
mod relay;

use app::{Phone, phone};
use relay::Relay;
use spjall_core::CoreError;
use spjall_core::client::{HttpMethod, HttpResponse};
use spjall_core::social::SocialNotificationKind;

fn answer(phone: &Phone, status: u16, body: &str) {
    phone.app.canned.lock().unwrap().push_back(HttpResponse {
        status,
        body: body.into(),
    });
}

#[test]
fn the_notice_the_inviter_and_the_moderators_calls_cross_the_boundary() {
    let relay = Relay::new();
    let a1 = phone(&relay, "a", "a1");
    a1.app.seen.lock().unwrap().clear();

    answer(
        &a1,
        200,
        r#"{"notifications":[{"notificationId":"n_1","kind":"community_invite",
        "actor":{"accountId":"b","name":"Anna","verified":false},"communityId":"cm_1",
        "postId":null,"commentId":null,"action":null,"emoji":null,"createdAt":1,
        "read":false,"actors":[],"actorCount":1,"snippet":null,"announce":true}],
        "unread":1,"unseen":1,"seenAt":null,"next":null}"#,
    );
    let page = a1.client.notifications(None, 20).unwrap();
    assert_eq!(
        page.notifications[0].kind,
        SocialNotificationKind::CommunityInvite
    );
    assert_eq!(page.notifications[0].community_id.as_deref(), Some("cm_1"));

    answer(
        &a1,
        200,
        r#"{"communityId":"cm_1","name":"Kór","description":"","audience":"private",
        "createdAt":1,"memberCount":null,"role":null,"joinRequested":false,"invited":true,
        "invitedBy":{"accountId":"b","name":null},"mutedUntil":null,"readOnly":false}"#,
    );
    let community = a1.client.community("cm_1".into()).unwrap();
    let by = community.invited_by.unwrap();
    assert_eq!((by.account_id.as_str(), by.name), ("b", None));

    answer(
        &a1,
        200,
        r#"{"invitations":[{"accountId":"c","name":null,
        "invitedBy":{"accountId":"b","name":"Anna"},"createdAt":5}]}"#,
    );
    let listed = a1.client.community_invitations("cm_1".into()).unwrap();
    assert_eq!(listed[0].account_id, "c");
    assert_eq!(
        listed[0].invited_by.as_ref().unwrap().name.as_deref(),
        Some("Anna")
    );
    assert_eq!(listed[0].created_at, 5);

    answer(&a1, 204, "");
    a1.client
        .withdraw_invitation("cm_1".into(), "c".into())
        .unwrap();
    let seen = a1.app.seen.lock().unwrap();
    let last = seen.last().unwrap();
    assert_eq!(last.method, HttpMethod::Delete);
    assert_eq!(last.path, "/v1/communities/cm_1/invitations/c");
    drop(seen);

    answer(&a1, 404, r#"{"error":"not_found"}"#);
    let gone = a1.client.withdraw_invitation("cm_1".into(), "c".into());
    assert!(
        matches!(gone, Err(CoreError::Refused { status: 404, .. })),
        "{gone:?}"
    );
}
