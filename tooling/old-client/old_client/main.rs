//! The core of the last store release against the Worker of the tree under
//! test: every read goes through that core's own decoding, with that release's
//! Spjall-Client. old-client.yml copies this file into the tests of a checkout
//! of the tag tooling/old-client/release.json records, so it is compiled against
//! that API and never against the core of this tree.
//!
//! ```text
//! SPJALL_DEV_URL=http://127.0.0.1:8787 SPJALL_INVITE=<link> SPJALL_OLD_APP=0.17.7 \
//!   cargo test -p spjall-client --test old_client -- --ignored
//! ```

#![allow(clippy::disallowed_methods)] // tests use files

mod phone;

use std::time::{Duration, Instant, SystemTime};

use phone::{PIXEL, Phone, dev, kennitala};
use serde_json::{Value, json};
use spjall_client::api::{
    ApiError, Audience, Moderation, ModerationAction, ModerationState, NotificationAction,
    NotificationKind, Platform, Post,
};
use spjall_client::{ClientError, invite_token};

const PATIENCE: Duration = Duration::from_secs(30);

/// The rows of `notifications` a knowing client reads: the seed took.
fn knowing_rows(phone: &Phone) -> Vec<Value> {
    let (status, page) = phone.knowing("/v1/notifications?limit=50");
    assert_eq!(status, 200);
    page["notifications"].as_array().unwrap().clone()
}

/// Runs due jobs until `done` holds of the phone's rows, as the minute cron would.
fn await_rows(phone: &Phone, done: impl Fn(&[Value]) -> bool) -> Vec<Value> {
    let deadline = Instant::now() + PATIENCE;
    loop {
        dev("/dev/jobs");
        let rows = knowing_rows(phone);
        if done(&rows) {
            return rows;
        }
        assert!(Instant::now() < deadline, "only these arrived: {rows:?}");
        std::thread::sleep(Duration::from_millis(250));
    }
}

fn ids(posts: &[Post]) -> Vec<&str> {
    posts.iter().map(|post| post.post_id.as_str()).collect()
}

/// The four reads, all through the release's own decoding: an answer it cannot
/// decode is an `Err` here and fails the job.
fn reads_as_the_release(phone: &Phone, community: &str, shown: &[&str], removed: &str) {
    let hosted = phone.client.hosted();

    let page = hosted.notifications(None, 50).unwrap();
    let actions: Vec<_> = page.notifications.iter().map(|n| n.action).collect();
    assert!(
        actions.contains(&Some(NotificationAction::RemovePost)),
        "a notice the release knows is still shown: {actions:?}"
    );
    assert!(
        !actions.contains(&Some(NotificationAction::Unknown)),
        "an action the release words as a removal is withheld: {actions:?}"
    );
    assert_eq!(
        page.unread,
        page.notifications.len() as u64,
        "the counts leave out what the list leaves out"
    );

    let feed = hosted.feed(None, 50).unwrap();
    let in_community = hosted.community_posts(community, None, None, 50).unwrap();
    for (name, posts) in [("feed", feed.posts), ("community", in_community.posts)] {
        let found = ids(&posts);
        for post in shown {
            assert!(found.contains(post), "{name} lost {post}: {found:?}");
        }
        assert!(!found.contains(&removed), "{name} has the tombstone");
        assert!(
            posts.iter().all(|p| p.state != ModerationState::Removed),
            "{name} has a removed post"
        );
    }

    for post in shown {
        assert_eq!(hosted.post(post).unwrap().post_id, *post);
    }
    match hosted.post(removed) {
        Err(ClientError::Transport(ApiError::Refused { status: 404, .. })) => {}
        other => panic!("the removed post is a 404 to the release: {other:?}"),
    }
}

/// A friend notice is there for a knowing build, and the release's list and
/// count leave it out: it has no community, and the release fails its whole page
/// on one (0114).
fn friend_notice_withheld(phone: &Phone, kind: &str) {
    let rows = await_rows(phone, |rows| rows.iter().any(|row| row["kind"] == kind));
    let row = rows.iter().find(|row| row["kind"] == kind).unwrap();
    assert!(row["communityId"].is_null(), "{row:?}");
    let told = row["notificationId"].as_str().unwrap();

    let (status, knowing) = phone.knowing("/v1/notifications?limit=50");
    assert_eq!(status, 200);
    let page = phone.client.hosted().notifications(None, 50).unwrap();
    assert!(
        page.notifications.iter().all(|n| n.notification_id != told),
        "{kind} reached the release"
    );
    assert_eq!(
        page.unread,
        page.notifications.len() as u64,
        "the counts leave out what the list leaves out"
    );
    assert!(
        knowing["unread"].as_u64().unwrap() > page.unread,
        "a knowing build counts {kind}: {knowing:?}"
    );
}

/// A suspended account on the release: both notices reach a knowing client and
/// neither the release's list nor its counts, it still reads, and its refused
/// write is an answer the release decodes. Lifted, it writes again.
fn suspended_on_the_release(moderator: &Phone, phone: &Phone, community: &str, shown: &str) {
    let hosted = phone.client.hosted();
    let act = |action: &str| {
        moderator.knowing_post(
            "/v1/moderation/actions",
            &json!({ "action": action, "targetId": phone.account, "reason": "Prufa" }),
        );
        // The seed took: what the release does not get below is withheld, not missing.
        await_rows(phone, |rows| {
            rows.iter()
                .any(|row| row["action"] == action && row["communityId"].is_null())
        });
        let page = hosted.notifications(None, 50).unwrap();
        assert!(
            page.notifications.is_empty(),
            "{action} reached the release: {:?}",
            page.notifications
        );
        assert_eq!(page.unread, 0, "{action} is in the release's counts");
    };

    act("suspend_account");
    assert_eq!(hosted.post(shown).unwrap().post_id, shown);
    let feed = hosted.feed(None, 50).unwrap();
    assert!(ids(&feed.posts).contains(&shown), "the feed lost {shown}");
    match hosted.create_post(community, "Bönnuð", &[]) {
        Err(ClientError::Transport(ApiError::Refused { status: 403, .. })) => {}
        other => panic!("a suspended write is a 403 to the release: {other:?}"),
    }

    act("unsuspend_account");
    hosted.create_post(community, "Aftur", &[]).unwrap();
}

#[test]
#[ignore = "needs `cf dev --mode interop` of the tree under test; run by old-client.yml"]
fn the_last_store_release_reads_this_worker() {
    let run = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let operator = std::env::var("SPJALL_INVITE").expect("SPJALL_INVITE, an operator invite link");
    let operator = invite_token(&operator).expect("an invite link");

    let mut owner = Phone::new(&kennitala(run, 0), Some(&operator), Platform::Android);
    let invite = invite_token(&owner.client.rotate_invite().unwrap()).unwrap();
    let mut member = Phone::new(&kennitala(run, 1), Some(&invite), Platform::Android);
    let member_ios = Phone::new(&kennitala(run, 1), None, Platform::Ios);
    assert_eq!(member_ios.account, member.account);

    // The rows: posts of each shape, each kind of notice the release knows.
    let (from_owner, from_member) = (owner.client.hosted(), member.client.hosted());
    let community = from_owner
        .create_community("Prufa", "Lýsing", Audience::Open)
        .unwrap()
        .community_id;
    from_member.join_community(&community).unwrap();
    let plain = from_owner.create_post(&community, "Færsla", &[]).unwrap();
    let options = ["Já".to_owned(), "Nei".to_owned()];
    let poll = from_owner
        .create_post_with(&community, "Spurning", &[], false, Some(&options))
        .unwrap();
    let mine = from_member.create_post(&community, "Mín", &[]).unwrap();
    let removed = from_member.create_post(&community, "Burt", &[]).unwrap();
    let comment = from_member
        .create_comment(&plain.post_id, "Athugasemd", None, &[])
        .unwrap();
    from_owner
        .create_comment(&mine.post_id, "Svar", None, &[])
        .unwrap();
    from_member.react(&plain.post_id, "👍").unwrap();

    let moderation = |action, target: &str| Moderation {
        action,
        target_id: target.to_owned(),
        reason: "Prufa".to_owned(),
        report_id: None,
        until: None,
    };
    from_owner
        .moderate(
            &community,
            &moderation(ModerationAction::RemovePost, &removed.post_id),
        )
        .unwrap();
    // A notice with no community: the release fails its whole page on one (0114).
    let gallery = tempfile::tempdir().unwrap();
    let picked = gallery.path().join("picked.png");
    std::fs::write(&picked, PIXEL).unwrap();
    member.client.set_photo(&picked).unwrap();
    dev(&format!(
        "/dev/platform-moderator?account={}",
        owner.account
    ));
    owner.knowing_post(
        "/v1/moderation/actions",
        &json!({
            "action": "clear_account_photo",
            "targetId": member.account,
            "reason": "Prufa",
        }),
    );

    // An action added since, on a notice with a community: the release decodes
    // it as unknown and words it as a removal (0115). The removal's own review,
    // decided by someone other than the moderator who removed it.
    let decider = Phone::new(&kennitala(run, 2), Some(&invite), Platform::Android);
    dev(&format!(
        "/dev/platform-moderator?account={}",
        decider.account
    ));
    let (status, statements) = member.knowing("/v1/moderation/statements");
    assert_eq!(status, 200);
    let entry = statements["statements"]
        .as_array()
        .unwrap()
        .iter()
        .find(|statement| statement["action"] == "remove_post")
        .expect("the removal's statement")["entryId"]
        .as_u64()
        .unwrap();
    member.knowing_post(
        &format!("/v1/moderation/statements/{entry}/review"),
        &json!({}),
    );
    decider.knowing_post(
        &format!("/v1/moderation/reviews/{entry}"),
        &json!({ "outcome": "upheld", "reason": "Prufa" }),
    );

    // Friend notices, on the account with every other notice and on accounts
    // with nothing else, where the counts have nowhere to hide one.
    let request_to = |account: &str| format!("/v1/friend-requests/{account}");
    owner.knowing_put(&request_to(&member.account));
    let asked = Phone::new(&kennitala(run, 3), Some(&invite), Platform::Android);
    owner.knowing_put(&request_to(&asked.account));
    decider.knowing_put(&request_to(&asked.account));
    asked.knowing_post(
        &format!("{}/accept", request_to(&decider.account)),
        &json!({}),
    );

    // The seed took, read as a build that may see it all: what the release does
    // not get below is withheld, not missing.
    let rows = await_rows(&member, |rows| {
        let has = |action: &str| rows.iter().any(|row| row["action"] == action);
        has("remove_post")
            && has("review_upheld")
            && has("clear_account_photo")
            && rows.iter().any(|row| row["kind"] == "friend_request")
    });
    assert!(
        rows.iter()
            .any(|row| row["action"] == "clear_account_photo" && row["communityId"].is_null())
    );
    assert!(
        rows.iter()
            .any(|row| row["action"] == "review_upheld" && !row["communityId"].is_null())
    );
    let (status, feed) = member.knowing("/v1/feed?limit=50");
    assert_eq!(status, 200);
    let listed = feed["posts"].as_array().unwrap();
    assert!(
        listed
            .iter()
            .any(|p| p["postId"] == removed.post_id.as_str() && p["state"] == "removed"),
        "the tombstone reaches a knowing client: {listed:?}"
    );
    let (status, _) = member.knowing(&format!("/v1/posts/{}", removed.post_id));
    assert_eq!(status, 200);

    let shown = [
        plain.post_id.as_str(),
        poll.post_id.as_str(),
        mine.post_id.as_str(),
    ];
    reads_as_the_release(&member, &community, &shown, &removed.post_id);
    reads_as_the_release(&member_ios, &community, &shown, &removed.post_id);

    friend_notice_withheld(&member, "friend_request");
    friend_notice_withheld(&member_ios, "friend_request");
    friend_notice_withheld(&decider, "friend_accepted");
    friend_notice_withheld(&asked, "friend_request");
    let page = asked.client.hosted().notifications(None, 50).unwrap();
    assert!(page.notifications.is_empty(), "{:?}", page.notifications);
    assert_eq!((page.unread, page.unseen), (0, 0));
    let (status, knowing) = asked.knowing("/v1/notifications?limit=50");
    assert_eq!(status, 200);
    assert_eq!(knowing["unread"], 1, "{knowing:?}");

    // A suspension, of someone who has nothing else in their notices (0115).
    let suspended = Phone::new(&kennitala(run, 4), Some(&invite), Platform::Android);
    suspended
        .client
        .hosted()
        .join_community(&community)
        .unwrap();
    suspended_on_the_release(&owner, &suspended, &community, &plain.post_id);

    // The owner's page, with the notices of content: a comment and a reaction.
    await_rows(&owner, |rows| {
        let has = |kind: &str| rows.iter().any(|row| row["kind"] == kind);
        has("comment") && has("reaction")
    });
    let page = from_owner.notifications(None, 50).unwrap();
    let kinds: Vec<_> = page.notifications.iter().map(|n| n.kind).collect();
    assert!(kinds.contains(&NotificationKind::Comment), "{kinds:?}");
    assert!(kinds.contains(&NotificationKind::Reaction), "{kinds:?}");
    let plain_again = from_owner.post(&plain.post_id).unwrap();
    assert_eq!(plain_again.comment_count, 1);
    assert_eq!(
        plain_again.latest_comment.unwrap().comment_id,
        comment.comment_id
    );
}
