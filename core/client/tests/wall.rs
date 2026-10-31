//! The wall (0115) as the client reads it and what its owner may change.

#![allow(clippy::disallowed_methods)] // tests use files

#[path = "support/hosted.rs"]
mod hosted;
#[path = "support/relay.rs"]
#[allow(dead_code)]
mod relay;

use hosted::{IMAGE, Phone, author};
use serde_json::{Value, json};
use spjall_client::ClientError;
use spjall_client::api::{ApiError, Method, WallAudience};
use spjall_client::frames::{Frame, Framing};

const AT: u64 = 1_760_000_400_000;

fn post() -> Value {
    json!({
        "postId": "post_1", "communityId": "wall_1", "author": author("acc_b"), "body": "b",
        "media": [], "createdAt": AT, "emojis": [], "myEmoji": null, "commentCount": 0,
        "state": "visible", "wall": { "accountId": "acc_b" }, "audience": "everyone",
    })
}

/// An account with no wall post yet still has a wall to show.
#[test]
fn a_wall_with_no_post_yet_reads() {
    let phone = Phone::signed_in();
    phone.answer(
        200,
        json!({ "accountId": "acc_b", "joinedMonth": "2026-05" }),
    );
    phone.answer(
        200,
        json!({
            "accountId": "acc_b", "wallId": "wall_1", "bio": "b", "cover": "v1",
            "joinedMonth": "2026-05",
        }),
    );
    let hosted = phone.client.hosted();
    let empty = hosted.wall("acc_b").unwrap();
    assert_eq!((empty.wall_id, empty.bio, empty.cover), (None, None, None));
    let full = hosted.wall("acc_b").unwrap();
    assert_eq!(full.wall_id.as_deref(), Some("wall_1"));
    assert_eq!(full.cover.as_deref(), Some("v1"));
    assert_eq!(phone.sent()[0].1, "/v1/accounts/acc_b/wall");
}

#[test]
fn a_page_of_a_wall_stays_within_what_the_server_takes() {
    let phone = Phone::signed_in();
    phone.answer(200, json!({ "posts": [post()], "next": "c2" }));
    phone.answer(200, json!({ "images": [], "next": null }));
    let hosted = phone.client.hosted();
    let page = hosted.wall_posts("acc_b", Some("c1"), 500).unwrap();
    assert_eq!(page.next.as_deref(), Some("c2"));
    assert_eq!(page.posts[0].audience, Some(WallAudience::Everyone));
    hosted.wall_images("acc_b", None, 0).unwrap();
    let sent = phone.sent();
    assert_eq!(
        sent[0].1,
        "/v1/accounts/acc_b/wall/posts?before=c1&limit=50"
    );
    assert_eq!(sent[1].1, "/v1/accounts/acc_b/wall/images?limit=1");
}

/// A wall post carries its audience; a poll goes as a community's does.
#[test]
fn a_wall_post_goes_with_its_audience_and_its_poll() {
    let phone = Phone::signed_in();
    phone.answer(200, post());
    let options = ["a".to_owned(), "b".to_owned()];
    phone
        .client
        .hosted()
        .create_wall_post("b", &[], Some(&options), WallAudience::Friends)
        .unwrap();
    let sent = phone.sent();
    assert_eq!(
        (sent[0].0, sent[0].1.as_str()),
        (Method::Post, "/v1/wall/posts")
    );
    assert_eq!(sent[0].2["audience"], "friends");
    assert_eq!(sent[0].2["poll"]["options"], json!(["a", "b"]));
}

/// The checks a community's post has hold on a wall, before anything is sent.
#[test]
fn a_wall_post_has_a_communitys_checks() {
    let phone = Phone::signed_in();
    let refused = phone
        .client
        .hosted()
        .create_wall_post("", &[], None, WallAudience::Friends);
    assert!(matches!(refused, Err(ClientError::Invalid(_))));
    assert!(phone.sent().is_empty());
}

#[test]
fn an_audience_changes_on_the_post() {
    let phone = Phone::signed_in();
    phone.ok();
    phone
        .client
        .hosted()
        .set_post_audience("post_1", WallAudience::Everyone)
        .unwrap();
    let sent = phone.sent();
    assert_eq!(sent[0].0, Method::Patch);
    assert_eq!(sent[0].1, "/v1/posts/post_1/audience");
    assert_eq!(sent[0].2, json!({ "audience": "everyone" }));
}

/// The server takes one trimmed line and refuses more than 120 characters, so
/// that is what leaves the device.
#[test]
fn a_bio_goes_as_one_clean_line() {
    let phone = Phone::signed_in();
    phone.ok();
    phone.client.hosted().set_bio(" a\nb ").unwrap();
    let sent = phone.sent();
    assert_eq!((sent[0].0, sent[0].1.as_str()), (Method::Put, "/v1/me/bio"));
    assert_eq!(sent[0].2, json!({ "bio": "a b" }));
    let over = "þ".repeat(121);
    assert!(matches!(
        phone.client.hosted().set_bio(&over),
        Err(ClientError::Invalid(_))
    ));
    assert!(phone.sent().is_empty());
}

/// The writer reads the reason, so it is required, trimmed and within 500.
#[test]
fn a_removed_comment_goes_with_a_reason() {
    let phone = Phone::signed_in();
    phone.ok();
    let hosted = phone.client.hosted();
    hosted
        .remove_wall_comment("cmt_1", "  off topic  ")
        .unwrap();
    let sent = phone.sent();
    assert_eq!(sent[0].1, "/v1/wall/comments/cmt_1/remove");
    assert_eq!(sent[0].2, json!({ "reason": "off topic" }));
    for reason in ["   ".to_owned(), "þ".repeat(501)] {
        assert!(matches!(
            hosted.remove_wall_comment("cmt_1", &reason),
            Err(ClientError::Invalid(_))
        ));
    }
    assert!(phone.sent().is_empty());
}

/// Removing a comment on another's wall is the server's call, and its answer
/// reaches the app typed.
#[test]
fn a_refused_removal_stays_typed() {
    let phone = Phone::signed_in();
    phone.answer(403, json!({ "error": "forbidden", "requestId": "r1" }));
    let refused = phone.client.hosted().remove_wall_comment("cmt_1", "r");
    assert!(matches!(
        refused,
        Err(ClientError::Transport(ApiError::Refused {
            status: 403,
            ..
        }))
    ));
    phone.sent();
}

#[test]
fn a_post_image_and_a_cover_go_up_to_the_wall() {
    let phone = Phone::signed_in();
    let image = phone._dir.path().join("i.webp");
    std::fs::write(&image, IMAGE).unwrap();
    phone.answer(
        200,
        json!({ "mediaId": "m1", "contentType": "image/webp", "width": 1, "height": 1 }),
    );
    phone.answer(200, json!({ "version": "v2" }));
    phone.ok();
    let media = phone.client.upload_wall_media(&image).unwrap();
    assert_eq!(media.media_id, "m1");
    assert_eq!(phone.client.set_wall_cover(&image).unwrap(), "v2");
    phone.client.hosted().remove_wall_cover().unwrap();
    let sent: Vec<_> = phone.sent().into_iter().map(|s| (s.0, s.1)).collect();
    assert_eq!(
        sent,
        [
            (Method::Post, "/v1/wall/media".to_owned()),
            (Method::Put, "/v1/wall/cover".to_owned()),
            (Method::Delete, "/v1/wall/cover".to_owned()),
        ]
    );
}

/// The file is kept per version: a second read asks nothing, and a server that
/// no longer has the cover takes the kept file with it.
#[test]
fn a_cover_is_kept_per_version_and_goes_when_the_server_has_none() {
    let mut phone = Phone::signed_in();
    phone.answer(200, Value::Null);
    let kept = phone.client.wall_cover("acc_b", "v1").unwrap().unwrap();
    assert_eq!(std::fs::read(&kept).unwrap(), IMAGE);
    assert!(kept.starts_with(phone._dir.path()));
    assert_eq!(phone.sent()[0].1, "/v1/accounts/acc_b/wall/cover");
    assert_eq!(
        phone.client.wall_cover("acc_b", "v1").unwrap(),
        Some(kept.clone())
    );
    assert!(phone.sent().is_empty());

    phone.answer(404, json!({ "error": "not_found" }));
    assert_eq!(phone.client.wall_cover("acc_b", "v2").unwrap(), None);
    assert!(!kept.exists());
    phone.sent();
}

#[test]
fn a_cover_comes_only_in_the_frames_a_cover_has() {
    let mut phone = Phone::signed_in();
    phone.answer(200, Value::Null);
    phone
        .client
        .wall_cover_framed("acc_b", "v1", Frame::Compact)
        .unwrap()
        .unwrap();
    assert!(
        phone.sent()[0]
            .1
            .starts_with("/v1/accounts/acc_b/wall/cover?frame=")
    );
    assert!(matches!(
        phone.client.wall_cover_framed("acc_b", "v1", Frame::Square),
        Err(ClientError::Invalid(_))
    ));
    assert!(phone.sent().is_empty());
}

/// A framing is on the device only until the server has the new one; a cover
/// from before masters were kept has its own error, as a community's has.
#[test]
fn framing_a_cover_again_forgets_the_kept_files() {
    let mut phone = Phone::signed_in();
    phone.answer(200, Value::Null);
    let kept = phone.client.wall_cover("a", "v1").unwrap().unwrap();
    phone.sent();

    phone.answer(200, json!({ "version": "v2" }));
    let version = phone
        .client
        .set_wall_cover_framing(&Framing::centred())
        .unwrap();
    assert_eq!(version, "v2");
    assert_eq!(phone.sent()[0].1, "/v1/wall/cover/frames");
    assert!(!kept.exists());

    phone.answer(409, json!({ "error": "no_master", "requestId": "r" }));
    assert!(matches!(
        phone.client.set_wall_cover_framing(&Framing::centred()),
        Err(ClientError::NoMaster)
    ));
    phone.sent();
}

#[test]
fn the_master_comes_for_the_editor_and_none_is_false() {
    let mut phone = Phone::signed_in();
    let to = phone._dir.path().join("source.webp");
    phone.answer(200, Value::Null);
    assert!(phone.client.wall_cover_source(&to).unwrap());
    assert_eq!(std::fs::read(&to).unwrap(), IMAGE);
    phone.answer(404, json!({ "error": "not_found" }));
    assert!(!phone.client.wall_cover_source(&to).unwrap());
    assert_eq!(phone.sent()[0].1, "/v1/wall/cover/source");
}
