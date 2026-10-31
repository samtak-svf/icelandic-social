//! The home feed and its composer's targets (0116) as the client reads them.

#![allow(clippy::disallowed_methods)] // tests use files

#[path = "support/hosted.rs"]
mod hosted;
#[path = "support/relay.rs"]
#[allow(dead_code)]
mod relay;

use hosted::{Phone, author};
use serde_json::{Value, json};
use spjall_client::api::{
    ApiError, Card, HomePage, Method, NotificationAction, NotificationKind, Ref, RefKind,
    WallAudience,
};
use spjall_client::{ClientError, PostTarget};

const AT: u64 = 1_760_000_400_000;

/// A post of today's server; `extra` is merged over it.
fn post(extra: Value) -> Value {
    let mut fields = json!({
        "postId": "post_1", "communityId": "wall_1", "author": author("acc_b"), "body": "b",
        "media": [], "createdAt": AT, "emojis": [], "myEmoji": null, "commentCount": 0,
        "state": "visible",
    });
    for (key, value) in extra.as_object().unwrap() {
        fields[key] = value.clone();
    }
    fields
}

/// The server filters a page after reading it, so a page with nothing to show
/// can have more behind it: it must not read as the end.
#[test]
fn an_empty_page_with_a_cursor_is_not_the_end() {
    let phone = Phone::signed_in();
    phone.answer(200, json!({ "posts": [], "next": "c2" }));
    let page = phone.client.hosted().home(None, 30).unwrap();
    assert_eq!(
        page,
        HomePage::More {
            posts: vec![],
            next: "c2".into()
        }
    );
    let sent = phone.sent();
    assert_eq!(sent[0].0, Method::Get);
    assert_eq!(sent[0].1, "/v1/home?limit=30");
}

#[test]
fn only_a_page_with_no_cursor_is_the_end() {
    let phone = Phone::signed_in();
    phone.answer(200, json!({ "posts": [post(json!({}))], "next": null }));
    let page = phone.client.hosted().home(Some("c2"), 30).unwrap();
    let HomePage::End { posts } = page else {
        panic!("{page:?}")
    };
    assert_eq!(posts.len(), 1);
    assert_eq!(phone.sent()[0].1, "/v1/home?before=c2&limit=30");
}

/// The server refuses a limit over 30, which would fail the whole feed.
#[test]
fn a_page_size_stays_within_what_the_server_takes() {
    let phone = Phone::signed_in();
    phone.answer(200, json!({ "posts": [], "next": null }));
    phone.answer(200, json!({ "posts": [], "next": null }));
    phone.client.hosted().home(None, 500).unwrap();
    phone.client.hosted().home(None, 0).unwrap();
    let sent = phone.sent();
    assert_eq!(sent[0].1, "/v1/home?limit=30");
    assert_eq!(sent[1].1, "/v1/home?limit=1");
}

/// One post type carries both: a wall's owner and audience, and a community's
/// post with neither.
#[test]
fn one_post_type_reads_a_wall_post_and_a_community_post() {
    let phone = Phone::signed_in();
    phone.answer(
        200,
        json!({
            "posts": [
                post(json!({ "wall": { "accountId": "acc_b" }, "audience": "friends" })),
                post(json!({ "communityId": "cm_1" })),
            ],
            "next": null,
        }),
    );
    let HomePage::End { posts } = phone.client.hosted().home(None, 30).unwrap() else {
        panic!("a cursor")
    };
    let wall = posts[0].wall.as_ref().unwrap();
    assert_eq!(wall.account_id, "acc_b");
    assert_eq!(posts[0].audience, Some(WallAudience::Friends));
    assert_eq!(posts[1].wall, None);
    assert_eq!(posts[1].audience, None);
    phone.sent();
}

/// A suspension reaches the app as every other refusal does.
#[test]
fn a_refusal_stays_typed() {
    let phone = Phone::signed_in();
    phone.answer(403, json!({ "error": "suspended", "requestId": "r1" }));
    let refused = phone.client.hosted().home(None, 30);
    let Err(ClientError::Transport(ApiError::Refused { status, code, .. })) = refused else {
        panic!("{refused:?}")
    };
    assert_eq!((status, code.as_str()), (403, "suspended"));
    phone.sent();
}

/// The own wall, for friends, is where the composer starts (0115, 0116).
#[test]
fn the_composer_starts_on_the_own_wall_for_friends() {
    assert_eq!(
        PostTarget::default(),
        PostTarget::Wall {
            audience: WallAudience::Friends
        }
    );
}

/// The target decides the route, the audience and the anonymous choice: a wall
/// has no anonymous post and a community no audience.
#[test]
fn a_post_goes_where_its_target_says() {
    let phone = Phone::signed_in();
    phone.answer(200, post(json!({ "audience": "everyone" })));
    phone.answer(
        200,
        post(json!({ "communityId": "cm_1", "anonymous": true })),
    );
    let hosted = phone.client.hosted();
    let wall = PostTarget::Wall {
        audience: WallAudience::Everyone,
    };
    hosted.post_to(&wall, "b", &[], None).unwrap();
    let community = PostTarget::Community {
        community_id: "cm_1".into(),
        anonymous: true,
    };
    hosted.post_to(&community, "b", &[], None).unwrap();
    let sent = phone.sent();
    assert_eq!(sent[0].1, "/v1/wall/posts");
    assert_eq!(sent[0].2["audience"], "everyone");
    assert_eq!(sent[0].2.get("anonymous"), None);
    assert_eq!(sent[1].1, "/v1/communities/cm_1/posts");
    assert_eq!(sent[1].2["anonymous"], true);
    assert_eq!(sent[1].2.get("audience"), None);
}

/// An image for a wall post does not go up under a community, or the reverse.
#[test]
fn an_image_goes_up_where_its_post_goes() {
    let phone = Phone::signed_in();
    let image = phone._dir.path().join("i.webp");
    std::fs::write(&image, hosted::IMAGE).unwrap();
    let media = json!({ "mediaId": "m1", "contentType": "image/webp", "width": 1, "height": 1 });
    phone.answer(200, media.clone());
    phone.answer(200, media);
    phone
        .client
        .upload_post_media(&PostTarget::default(), &image)
        .unwrap();
    let community = PostTarget::Community {
        community_id: "cm_1".into(),
        anonymous: false,
    };
    phone.client.upload_post_media(&community, &image).unwrap();
    let sent = phone.sent();
    assert_eq!(sent[0].1, "/v1/wall/media");
    assert_eq!(sent[1].1, "/v1/communities/cm_1/media");
}

/// `my_communities` answers; what the composer offers is filtered from it.
#[test]
fn the_composer_offers_only_a_community_that_takes_posts() {
    let phone = Phone::signed_in();
    let community = |id: &str, read_only: bool| {
        json!({
            "communityId": id, "name": "n", "description": "", "audience": "open",
            "role": "member", "memberCount": 1, "createdAt": 1, "joinRequested": false,
            "invited": false, "mutedUntil": null, "readOnly": read_only, "deletedAt": null,
        })
    };
    phone.answer(
        200,
        json!({ "communities": [community("cm_1", false), community("cm_2", true)] }),
    );
    let offered = phone.client.hosted().post_communities().unwrap();
    let ids: Vec<_> = offered.iter().map(|c| c.community_id.as_str()).collect();
    assert_eq!(ids, ["cm_1"]);
    phone.sent();
}

/// A wall has no card: "A card names a community, and a wall has none". It
/// answers `unavailable` with the existing shape, so nothing new reaches an app.
#[test]
fn a_card_for_a_wall_post_reads_unavailable() {
    let phone = Phone::signed_in();
    let reference = Ref {
        kind: RefKind::Post,
        id: "post_1".into(),
    };
    phone.answer(
        200,
        json!({ "cards": [{ "kind": "unavailable", "ref": { "kind": "post", "id": "post_1" } }] }),
    );
    let cards = phone
        .client
        .hosted()
        .cards(std::slice::from_ref(&reference))
        .unwrap();
    assert_eq!(cards, [Card::Unavailable { reference }]);
    phone.sent();
}

/// Whether a schema has `field`, itself or through an `allOf`.
fn has_field(schemas: &Value, schema: &str, field: &str) -> bool {
    let schema = &schemas[schema];
    if schema["properties"].get(field).is_some() {
        return true;
    }
    schema["allOf"].as_array().is_some_and(|parts| {
        parts.iter().any(|part| {
            part["properties"].get(field).is_some()
                || part["$ref"]
                    .as_str()
                    .and_then(|r| r.rsplit('/').next())
                    .is_some_and(|name| has_field(schemas, name, field))
        })
    })
}

/// The server's shape of each new thing: a renamed field fails here rather
/// than on a phone.
#[test]
fn the_contract_has_every_field_the_client_reads() {
    let contract: Value = serde_json::from_str(include_str!("../../../api/openapi.json")).unwrap();
    let schemas = &contract["components"]["schemas"];
    for (schema, fields) in [
        ("Post", &["wall", "audience"][..]),
        (
            "Person",
            &[
                "accountId",
                "name",
                "verified",
                "photo",
                "photoFrames",
                "relation",
                "friendsSince",
                "friendCount",
                "mutualCount",
                "mutualFriends",
                "sharedCommunities",
                "snoozedUntil",
            ][..],
        ),
        (
            "WallProfile",
            &[
                "accountId",
                "wallId",
                "bio",
                "cover",
                "coverFrames",
                "joinedMonth",
            ][..],
        ),
    ] {
        for field in fields {
            assert!(has_field(schemas, schema, field), "{schema}.{field}");
        }
    }
    for (path, method) in [
        ("/v1/home", "get"),
        ("/v1/friends", "get"),
        ("/v1/friend-requests", "get"),
        ("/v1/friend-requests/{accountId}", "put"),
        ("/v1/friend-requests/{accountId}/accept", "post"),
        ("/v1/friend-requests/{accountId}/decline", "post"),
        ("/v1/snoozes", "get"),
        ("/v1/snoozes/{accountId}", "put"),
        ("/v1/people/{accountId}", "get"),
        ("/v1/accounts/{accountId}/wall", "get"),
        ("/v1/accounts/{accountId}/wall/posts", "get"),
        ("/v1/accounts/{accountId}/wall/images", "get"),
        ("/v1/accounts/{accountId}/wall/cover", "get"),
        ("/v1/wall/posts", "post"),
        ("/v1/wall/media", "post"),
        ("/v1/wall/cover", "put"),
        ("/v1/wall/cover/frames", "patch"),
        ("/v1/wall/cover/source", "get"),
        ("/v1/me/bio", "put"),
    ] {
        assert!(
            contract["paths"][path].get(method).is_some(),
            "{method} {path}"
        );
    }
}

/// The notices the client shows: each case the contract's vectors hold, as this
/// core reads it.
#[test]
fn every_notice_vector_reads_as_a_known_kind_and_action() {
    let vectors: Value =
        serde_json::from_str(include_str!("../../../api/presentation.vectors.json")).unwrap();
    let cases = vectors["notice"].as_array().unwrap();
    assert_eq!(cases.len(), 27);
    for case in cases {
        let _: NotificationKind = serde_json::from_value(case["kind"].clone()).unwrap();
        if let Some(action) = case.get("action") {
            let action: NotificationAction = serde_json::from_value(action.clone()).unwrap();
            assert_ne!(action, NotificationAction::Unknown, "{case}");
        }
    }
}
