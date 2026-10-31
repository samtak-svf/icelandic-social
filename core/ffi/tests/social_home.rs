//! Friends, the wall and the home feed through the exported client, as an app
//! calls them (0114, 0115, 0116).

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
use spjall_core::social::{
    FriendSort, HomePage, PostTarget, Relation, WallAudience, default_post_target,
};

const POST: &str = r#"{"postId":"post_1","communityId":"wall_1","author":null,"body":"b",
    "media":[],"createdAt":1,"emojis":[],"myEmoji":null,"commentCount":0,"state":"visible",
    "wall":{"accountId":"a"},"audience":"friends"}"#;

fn answer(phone: &Phone, status: u16, body: &str) {
    phone.app.canned.lock().unwrap().push_back(HttpResponse {
        status,
        body: body.into(),
    });
}

fn last_path(phone: &Phone) -> String {
    phone.app.seen.lock().unwrap().last().unwrap().path.clone()
}

/// A page the server emptied by filtering it keeps its cursor in the app's type.
#[test]
fn an_empty_home_page_with_a_cursor_is_more() {
    let relay = Relay::new();
    let a1 = phone(&relay, "a", "a1");
    answer(&a1, 200, r#"{"posts":[],"next":"c2"}"#);
    let page = a1.client.home(None, 30).unwrap();
    assert!(matches!(page, HomePage::More { posts, next } if posts.is_empty() && next == "c2"));
    answer(&a1, 200, &format!(r#"{{"posts":[{POST}],"next":null}}"#));
    let page = a1.client.home(Some("c2".into()), 30).unwrap();
    let HomePage::End { posts } = page else {
        panic!("{page:?}")
    };
    assert_eq!(posts[0].wall_owner.as_deref(), Some("a"));
    assert_eq!(posts[0].audience, Some(WallAudience::Friends));
    assert_eq!(last_path(&a1), "/v1/home?before=c2&limit=30");
}

/// The default target is the core's, not one each app writes for itself.
#[test]
fn the_default_target_is_the_own_wall_for_friends() {
    assert_eq!(
        default_post_target(),
        PostTarget::Wall {
            audience: WallAudience::Friends
        }
    );
}

#[test]
fn a_post_goes_to_its_target() {
    let relay = Relay::new();
    let a1 = phone(&relay, "a", "a1");
    answer(&a1, 200, POST);
    a1.client
        .post_to(default_post_target(), "b".into(), vec![], None)
        .unwrap();
    assert_eq!(last_path(&a1), "/v1/wall/posts");
    answer(&a1, 200, POST);
    let community = PostTarget::Community {
        community_id: "cm_1".into(),
        anonymous: false,
    };
    a1.client
        .post_to(community, "b".into(), vec![], None)
        .unwrap();
    assert_eq!(last_path(&a1), "/v1/communities/cm_1/posts");
}

#[test]
fn a_person_and_a_friend_list_reach_the_app() {
    let relay = Relay::new();
    let a1 = phone(&relay, "a", "a1");
    answer(
        &a1,
        200,
        r#"{"accountId":"b","name":null,"verified":false,"relation":"self","friendCount":0,
            "mutualCount":0,"mutualFriends":[],"sharedCommunities":[]}"#,
    );
    assert_eq!(
        a1.client.person("b".into()).unwrap().relation,
        Relation::Oneself
    );
    answer(&a1, 200, r#"{"count":0,"friends":[]}"#);
    let page = a1
        .client
        .friends(FriendSort::Name, Some("sig".into()))
        .unwrap();
    assert_eq!(page.count, 0);
    assert_eq!(last_path(&a1), "/v1/friends?q=sig&sort=name");
    answer(&a1, 200, r#"{"relation":"friends"}"#);
    assert_eq!(
        a1.client.send_friend_request("b".into()).unwrap(),
        Relation::Friends
    );
}

#[test]
fn a_wall_reaches_the_app() {
    let relay = Relay::new();
    let a1 = phone(&relay, "a", "a1");
    answer(&a1, 200, r#"{"accountId":"b","joinedMonth":"2026-05"}"#);
    let wall = a1.client.wall("b".into()).unwrap();
    assert_eq!(wall.wall_id, None);
    assert_eq!(wall.joined_month, "2026-05");
    answer(&a1, 204, "");
    a1.client
        .remove_wall_comment("cmt_1".into(), "r".into())
        .unwrap();
    assert_eq!(last_path(&a1), "/v1/wall/comments/cmt_1/remove");
}

/// A suspension on the new calls is the refusal the apps already read.
#[test]
fn a_refusal_reaches_the_app_as_the_existing_error() {
    let relay = Relay::new();
    let a1 = phone(&relay, "a", "a1");
    answer(&a1, 403, r#"{"error":"suspended","requestId":"r1"}"#);
    let refused = a1.client.home(None, 30).unwrap_err();
    assert!(
        matches!(&refused, CoreError::Refused { status: 403, code, .. } if code == "suspended"),
        "{refused:?}"
    );
}

/// The apps' section: the row and its cursor.
#[test]
fn suggestions_reach_the_app_as_author_rows_with_a_cursor() {
    let relay = Relay::new();
    let a1 = phone(&relay, "a", "a1");
    answer(
        &a1,
        200,
        r#"{"people":[{"accountId":"b","name":null,"verified":true,"photo":"ph_1",
            "photoFrames":null}],"next":"c2"}"#,
    );
    let page = a1.client.friend_suggestions(None, 20).unwrap();
    assert_eq!(page.people[0].account_id, "b");
    assert_eq!(page.people[0].name, None);
    assert!(page.people[0].verified);
    assert_eq!(page.people[0].photo.as_deref(), Some("ph_1"));
    assert_eq!(page.next.as_deref(), Some("c2"));
    assert_eq!(last_path(&a1), "/v1/friend-suggestions?limit=20");
    answer(&a1, 200, r#"{"people":[],"next":null}"#);
    let page = a1.client.friend_suggestions(page.next, 20).unwrap();
    assert_eq!(page.next, None);
    assert_eq!(last_path(&a1), "/v1/friend-suggestions?after=c2&limit=20");
}

/// The apps' switch, both ways, through to what goes on the wire.
#[test]
fn the_suggestion_switch_reaches_the_app() {
    let relay = Relay::new();
    let a1 = phone(&relay, "a", "a1");
    answer(&a1, 200, r#"{"included":false}"#);
    assert!(!a1.client.friend_suggestions_included().unwrap());
    answer(&a1, 204, "");
    a1.client.set_friend_suggestions_included(false).unwrap();
    let seen = a1.app.seen.lock().unwrap();
    let write = seen.last().unwrap();
    assert_eq!(write.path, "/v1/friend-suggestion-settings");
    assert!(
        matches!(write.method, HttpMethod::Put),
        "{:?}",
        write.method
    );
    assert_eq!(write.body.as_deref(), Some(r#"{"included":false}"#));
}

/// A refused write and an answer off the contract are the errors the apps
/// already read, so the switch can go back and the section can stay away.
#[test]
fn a_refused_or_malformed_suggestion_call_is_the_existing_error() {
    let relay = Relay::new();
    let a1 = phone(&relay, "a", "a1");
    answer(&a1, 429, r#"{"error":"rate_limited","requestId":"r1"}"#);
    let refused = a1
        .client
        .set_friend_suggestions_included(false)
        .unwrap_err();
    assert!(
        matches!(&refused, CoreError::Refused { status: 429, code, .. } if code == "rate_limited"),
        "{refused:?}"
    );
    answer(&a1, 200, r#"{"people":"nobody","next":null}"#);
    let malformed = a1.client.friend_suggestions(None, 20).unwrap_err();
    assert!(
        matches!(malformed, CoreError::Protocol { .. }),
        "{malformed:?}"
    );
    answer(&a1, 200, r#"{}"#);
    let malformed = a1.client.friend_suggestions_included().unwrap_err();
    assert!(
        matches!(malformed, CoreError::Protocol { .. }),
        "{malformed:?}"
    );
}
