//! A wall on the release (decision 0115): what 0.17.7 cannot word stays out of
//! what it reads, and all it does read still decodes.

use std::time::{Duration, Instant};

use serde_json::{Value, json};
use spjall_client::api::NotificationAction;

use super::phone::{Phone, dev};
use super::{PATIENCE, ids};

/// A notice of a wall's reaches the web and no app that cannot word it (0115):
/// the release neither gets it nor counts it, and what it does get still decodes.
fn wall_notice_withheld(phone: &Phone, what: &str, is_it: impl Fn(&Value) -> bool) {
    let deadline = Instant::now() + PATIENCE;
    let (told, on_the_web) = loop {
        dev("/dev/jobs");
        let (status, page) = phone.on_the_web("/v1/notifications?limit=50");
        assert_eq!(status, 200);
        let rows = page["notifications"].as_array().unwrap();
        if let Some(row) = rows.iter().find(|row| is_it(row)) {
            break (
                row["notificationId"].as_str().unwrap().to_owned(),
                page.clone(),
            );
        }
        assert!(
            Instant::now() < deadline,
            "{what}: only these arrived: {rows:?}"
        );
        std::thread::sleep(Duration::from_millis(250));
    };

    let page = phone.client.hosted().notifications(None, 50).unwrap();
    assert!(
        page.notifications.iter().all(|n| n.notification_id != told),
        "{what} reached the release"
    );
    assert!(
        page.notifications
            .iter()
            .all(|n| n.action != Some(NotificationAction::Unknown)),
        "{what}: an action the release words as a removal"
    );
    assert_eq!(
        page.unread,
        page.notifications.len() as u64,
        "{what}: the counts leave out what the list leaves out"
    );
    assert!(
        on_the_web["unread"].as_u64().unwrap() > page.unread,
        "{what}: the web counts it: {on_the_web:?}"
    );
}

/// A wall, its post readable by all, its comment removed by its owner, its post
/// and bio acted on by the platform: nothing of it reaches a read of the release
/// that it cannot word, and everything the release does read still decodes (0115).
pub fn a_wall_on_the_release(walled: &Phone, reader: &mut Phone, platform: &Phone) {
    walled.knowing_put_json("/v1/me/bio", &json!({ "bio": "Prufa" }));
    let post = walled.knowing_made(
        "/v1/wall/posts",
        &json!({ "body": "Prufa", "audience": "everyone" }),
    );
    let post_id = post["postId"].as_str().unwrap().to_owned();
    let wall = post["communityId"].as_str().unwrap().to_owned();
    let on_this_wall = |row: &Value| row["communityId"] == wall.as_str();

    // The profile a bio is now part of, as the release reads and stores it.
    reader.client.profile(&walled.account).unwrap();
    for phone in [walled, &*reader] {
        let hosted = phone.client.hosted();
        assert_eq!(hosted.post(&post_id).unwrap().post_id, post_id);
        hosted.me().unwrap();
        let feed = hosted.feed(None, 50).unwrap();
        assert!(
            !ids(&feed.posts).contains(&post_id.as_str()),
            "wall in the feed"
        );
        let listed = hosted.communities(None, None, 50).unwrap();
        let mine = hosted.my_communities().unwrap();
        assert!(
            listed
                .communities
                .iter()
                .chain(&mine)
                .all(|c| c.community_id != wall),
            "a wall among the communities"
        );
    }

    let comment = reader.knowing_made(
        &format!("/v1/posts/{post_id}/comments"),
        &json!({ "body": "Prufa" }),
    );
    let comment_id = comment["commentId"].as_str().unwrap();
    wall_notice_withheld(walled, "a comment on a wall", |row| {
        on_this_wall(row) && row["kind"] == "comment"
    });

    walled.knowing_post(
        &format!("/v1/wall/comments/{comment_id}/remove"),
        &json!({ "reason": "Prufa" }),
    );
    wall_notice_withheld(reader, "the owner's removal", |row| {
        on_this_wall(row) && row["action"] == "remove_comment"
    });

    reader.knowing_post(
        "/v1/reports",
        &json!({ "target": { "kind": "post", "id": post_id }, "reason": "spam", "note": "" }),
    );
    platform.knowing_post(
        &format!("/v1/communities/{wall}/actions"),
        &json!({ "action": "remove_post", "targetId": post_id, "reason": "Prufa" }),
    );
    wall_notice_withheld(walled, "the platform's removal", |row| {
        on_this_wall(row) && row["action"] == "remove_post"
    });

    platform.knowing_post(
        "/v1/moderation/actions",
        &json!({ "action": "clear_account_bio", "targetId": walled.account, "reason": "Prufa" }),
    );
    wall_notice_withheld(walled, "a cleared bio", |row| {
        row["action"] == "clear_account_bio"
    });
}
