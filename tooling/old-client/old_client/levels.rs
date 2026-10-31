//! Grouped rows and levels on the release (0103, 0106).

use spjall_client::api::{NotificationKind, NotificationLevel, Platform};

use crate::await_rows;
use crate::phone::{Phone, kennitala};

/// Grouped rows and levels (0103, 0106), read through the release's own decoding,
/// which has `actors`, `actor_count`, `announce` and the two level calls and no
/// more: two reactions to one post are one row that counts both, the row is
/// announced while the community is at its default and not once the owner lowers
/// it, and the kind and community levels read back as they were set.
pub fn grouped_and_levelled_on_the_release(
    owner: &Phone,
    run: u64,
    invite: &str,
    community: &str,
    post: &str,
) {
    let hosted = owner.client.hosted();
    // A second reaction to the post the first one reacted to: the server groups them (0103).
    let second = Phone::new(&kennitala(run, 6), Some(invite), Platform::Android);
    second.client.hosted().join_community(community).unwrap();
    second.client.hosted().react(post, "❤️").unwrap();
    // The seed took: the row has both reactors before the release reads it.
    await_rows(owner, |rows| {
        rows.iter()
            .any(|row| row["kind"] == "reaction" && row["postId"] == post && row["actorCount"] == 2)
    });
    let page = hosted.notifications(None, 50).unwrap();
    let rows: Vec<_> = page
        .notifications
        .iter()
        .filter(|n| n.kind == NotificationKind::Reaction && n.post_id.as_deref() == Some(post))
        .collect();
    assert_eq!(rows.len(), 1, "two reactions are one row: {rows:?}");
    let row = rows[0];
    assert_eq!(row.actor_count, 2, "{row:?}");
    assert_eq!(row.actors.len(), 2, "both reactors are named: {row:?}");
    assert!(
        row.announce,
        "an unread row at the default level is announced: {row:?}"
    );

    let levels = hosted.notification_settings().unwrap();
    assert!(!levels.kinds.is_empty(), "the kinds are listed: {levels:?}");
    assert!(
        !levels.communities.iter().any(|(id, _)| id == community),
        "no level is stored for the community yet: {levels:?}"
    );

    hosted
        .set_notification_settings(&[(NotificationKind::Reaction, NotificationLevel::InApp)])
        .unwrap();
    hosted
        .set_community_notification_level(community, NotificationLevel::InApp)
        .unwrap();
    let levels = hosted.notification_settings().unwrap();
    assert!(
        levels
            .kinds
            .contains(&(NotificationKind::Reaction, NotificationLevel::InApp)),
        "{levels:?}"
    );
    assert!(
        levels
            .communities
            .contains(&(community.to_owned(), NotificationLevel::InApp)),
        "{levels:?}"
    );

    // The row is still there, now only in the list: the release reads it as not announced.
    let page = hosted.notifications(None, 50).unwrap();
    let row = page
        .notifications
        .iter()
        .find(|n| n.kind == NotificationKind::Reaction && n.post_id.as_deref() == Some(post))
        .expect("the row stays in the list at a lower level");
    assert!(!row.announce, "a lowered level is not announced: {row:?}");
}
