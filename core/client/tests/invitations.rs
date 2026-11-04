//! Community invitations (0130) as the core reads them: the notice, the
//! inviter on a community, and the moderator's list and withdrawal.

#![allow(clippy::disallowed_methods)] // tests use files

#[path = "support/hosted.rs"]
mod hosted;
#[path = "support/relay.rs"]
#[allow(dead_code)]
mod relay;

use hosted::{Phone, author};
use serde_json::{Value, json};
use spjall_client::ClientError;
use spjall_client::api::{ApiError, Method, NotificationKind, NotificationLevel};

fn community(extra: Value) -> Value {
    let mut body = json!({
        "communityId": "cm_1",
        "name": "Kór Hlíðanna",
        "description": "Æfingar á þriðjudögum",
        "audience": "private",
        "createdAt": 1_760_000_000_000u64,
        "memberCount": null,
        "role": null,
        "joinRequested": false,
        "invited": true,
        "mutedUntil": null,
        "readOnly": false,
        "deletedAt": null,
        "joinDeclinedUntil": null,
        "pendingJoinRequests": null,
    });
    for (key, value) in extra.as_object().unwrap() {
        body[key] = value.clone();
    }
    body
}

#[test]
fn an_invitation_notice_decodes_with_its_inviter_and_community() {
    let phone = Phone::signed_in();
    phone.answer(
        200,
        json!({
            "notifications": [{
                "notificationId": "n_1",
                "kind": "community_invite",
                "actor": author("acc_b"),
                "communityId": "cm_1",
                "postId": null,
                "commentId": null,
                "action": null,
                "emoji": null,
                "createdAt": 1_760_000_400_000u64,
                "read": false,
                "actors": [author("acc_b")],
                "actorCount": 1,
                "snippet": null,
                "announce": true,
            }],
            "unread": 1, "unseen": 1, "seenAt": null, "next": null,
        }),
    );
    let page = phone.client.hosted().notifications(None, 20).unwrap();
    assert_eq!(page.notifications.len(), 1);
    let row = &page.notifications[0];
    assert_eq!(row.kind, NotificationKind::CommunityInvite);
    assert_eq!(row.actor.as_ref().unwrap().account_id, "acc_b");
    assert_eq!(row.community_id.as_deref(), Some("cm_1"));
}

#[test]
fn the_settings_carry_the_invitation_kind() {
    let phone = Phone::signed_in();
    phone.answer(
        200,
        json!({
            "kinds": { "community_invite": "in_app" },
            "communities": [],
        }),
    );
    let settings = phone.client.hosted().notification_settings().unwrap();
    assert!(
        settings
            .kinds
            .contains(&(NotificationKind::CommunityInvite, NotificationLevel::InApp)),
        "{:?}",
        settings.kinds
    );
    phone.ok();
    phone
        .client
        .hosted()
        .set_notification_settings(&[(NotificationKind::CommunityInvite, NotificationLevel::Off)])
        .unwrap();
    assert_eq!(
        phone.sent()[1],
        (
            Method::Put,
            "/v1/notification-settings".into(),
            json!({ "kinds": { "community_invite": "off" } })
        )
    );
}

#[test]
fn a_community_keeps_its_inviter_and_an_older_server_has_none() {
    let phone = Phone::signed_in();
    let c = phone.client.hosted();

    phone.answer(
        200,
        community(json!({ "invitedBy": { "accountId": "acc_b", "name": "Anna" } })),
    );
    let with_name = c.community("cm_1").unwrap();
    let by = with_name.invited_by.unwrap();
    assert_eq!(
        (by.account_id.as_str(), by.name.as_deref()),
        ("acc_b", Some("Anna"))
    );

    phone.answer(
        200,
        community(json!({ "invitedBy": { "accountId": "acc_b", "name": null } })),
    );
    let nameless = c.community("cm_1").unwrap().invited_by.unwrap();
    assert_eq!(nameless.name, None);

    phone.answer(200, community(json!({ "invitedBy": null })));
    assert_eq!(c.community("cm_1").unwrap().invited_by, None);

    // A server before 0130 does not send the field.
    phone.answer(200, community(json!({})));
    assert_eq!(c.community("cm_1").unwrap().invited_by, None);
}

#[test]
fn a_moderator_lists_and_withdraws_invitations() {
    let phone = Phone::signed_in();
    let c = phone.client.hosted();

    phone.answer(
        200,
        json!({ "invitations": [
            {
                "accountId": "acc_c", "name": null,
                "invitedBy": { "accountId": "acc_b", "name": "Anna" },
                "createdAt": 1_760_000_700_000u64,
            },
            {
                "accountId": "acc_d", "name": "Dóra", "invitedBy": null,
                "createdAt": 1_760_000_600_000u64,
            },
        ] }),
    );
    let listed = c.community_invitations("cm_1").unwrap();
    assert_eq!(listed.len(), 2);
    assert_eq!(listed[0].account_id, "acc_c");
    assert_eq!(listed[0].name, None);
    assert_eq!(listed[0].invited_by.as_ref().unwrap().account_id, "acc_b");
    assert_eq!(listed[0].created_at, 1_760_000_700_000);
    assert_eq!(listed[1].name.as_deref(), Some("Dóra"));
    assert_eq!(listed[1].invited_by, None);

    phone.ok();
    c.withdraw_invitation("cm_1", "acc_c").unwrap();
    assert_eq!(
        phone.sent(),
        [
            (
                Method::Get,
                "/v1/communities/cm_1/invitations".into(),
                Value::Null
            ),
            (
                Method::Delete,
                "/v1/communities/cm_1/invitations/acc_c".into(),
                Value::Null
            ),
        ]
    );

    phone.answer(403, json!({ "error": "not_permitted" }));
    assert!(matches!(
        c.community_invitations("cm_1"),
        Err(ClientError::Transport(ApiError::Refused {
            status: 403,
            ..
        }))
    ));
    phone.answer(404, json!({ "error": "not_found" }));
    assert!(matches!(
        c.withdraw_invitation("cm_1", "acc_c"),
        Err(ClientError::Transport(ApiError::Refused {
            status: 404,
            ..
        }))
    ));

    phone.sent();
    for refused in [
        c.community_invitations("../x").map(drop),
        c.withdraw_invitation("cm_1", "a/b"),
        c.withdraw_invitation("", "acc_c"),
    ] {
        assert!(
            matches!(refused, Err(ClientError::Invalid(_))),
            "{refused:?}"
        );
    }
    assert!(phone.sent().is_empty());
}
