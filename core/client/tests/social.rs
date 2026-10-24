//! The social calls (0063) as the core makes them: each one's method, path
//! and body, and what it makes of the server's answer. Sign-in goes to the
//! in-memory relay; every social request is answered with the canned JSON
//! a test queued, as the Worker would answer it.

#![allow(clippy::disallowed_methods)] // tests use files

#[path = "support/relay.rs"]
#[allow(dead_code)]
mod relay;

use std::collections::VecDeque;
use std::path::Path;
use std::sync::{Arc, Mutex};

use relay::{Link, Relay};
use serde_json::{Value, json};
use spjall_client::api::{
    ApiError, Audience, Author, AuthorRole, Card, CardCommunity, JoinState, LogTargetKind, Method,
    Moderation, ModerationAction, ModerationLogAction, ModerationState, NewReport,
    NotificationKind, Platform, Provider, ReactionCount, ReactionKind, Ref, RefKind,
    ReportDecision, ReportReason, ReportState, Request, Response, Role, SocialMedia, Target,
    TargetKind, TargetStanding, TargetState, Transport, Unreachable,
};
use spjall_client::{Client, ClientError};
use tempfile::TempDir;

const KEY: [u8; 32] = [7; 32];

const SOCIAL: [&str; 8] = [
    "/v1/communities",
    "/v1/me/communities",
    "/v1/feed",
    "/v1/posts/",
    "/v1/comments/",
    "/v1/reports",
    "/v1/cards",
    "/v1/notifications",
];

#[derive(Default)]
struct Canned {
    answers: VecDeque<Response>,
    seen: Vec<Request>,
    uploaded: Vec<Vec<u8>>,
}

/// The bytes a canned image download writes.
const IMAGE: &[u8] = b"RIFF\0\0\0\0WEBPVP8 ";

/// The relay for sign-in, and the canned answers for the social calls.
struct Hosted {
    link: Link,
    canned: Arc<Mutex<Canned>>,
}

impl Transport for Hosted {
    fn request(&self, request: Request) -> Result<Response, Unreachable> {
        if !SOCIAL.iter().any(|p| request.path.starts_with(p)) {
            return self.link.request(request);
        }
        let mut canned = self.canned.lock().unwrap();
        canned.seen.push(request);
        Ok(canned.answers.pop_front().expect("an answer was queued"))
    }

    fn upload(&self, request: Request, file: &Path) -> Result<Response, Unreachable> {
        if !SOCIAL.iter().any(|p| request.path.starts_with(p)) {
            return self.link.upload(request, file);
        }
        let mut canned = self.canned.lock().unwrap();
        canned.uploaded.push(std::fs::read(file).unwrap());
        canned.seen.push(request);
        Ok(canned.answers.pop_front().expect("an answer was queued"))
    }

    /// A social download gets the queued answer, and on 200 the bytes
    /// `IMAGE` in the file.
    fn download(&self, request: Request, to: &Path) -> Result<Response, Unreachable> {
        if !SOCIAL.iter().any(|p| request.path.starts_with(p)) {
            return self.link.download(request, to);
        }
        let mut canned = self.canned.lock().unwrap();
        canned.seen.push(request);
        let answer = canned.answers.pop_front().expect("an answer was queued");
        if answer.status == 200 {
            std::fs::write(to, IMAGE).unwrap();
        }
        Ok(answer)
    }
}

struct Phone {
    canned: Arc<Mutex<Canned>>,
    client: Client<Hosted>,
    _dir: TempDir,
}

impl Phone {
    fn signed_in() -> Self {
        let relay = Relay::new();
        let canned = Arc::new(Mutex::new(Canned::default()));
        let dir = tempfile::tempdir().unwrap();
        let transport = Hosted {
            link: relay.link("a", "a1"),
            canned: canned.clone(),
        };
        let mut client = Client::open(dir.path(), &KEY, transport).unwrap();
        let url = client.begin_sign_in(Provider::Kenni).unwrap();
        client
            .complete_sign_in(&relay::kenni(&url), None, Platform::Android)
            .unwrap();
        Self {
            canned,
            client,
            _dir: dir,
        }
    }

    fn answer(&self, status: u16, body: Value) {
        let body = if body.is_null() {
            String::new()
        } else {
            body.to_string()
        };
        let mut canned = self.canned.lock().unwrap();
        canned.answers.push_back(Response { status, body });
    }

    fn ok(&self) {
        self.answer(204, Value::Null);
    }

    /// The social requests made since the last call, as method, path and
    /// the body parsed, each with the device's token.
    fn sent(&self) -> Vec<(Method, String, Value)> {
        let mut canned = self.canned.lock().unwrap();
        assert!(canned.answers.is_empty(), "every answer was asked for");
        canned
            .seen
            .drain(..)
            .map(|r| {
                assert_eq!(r.bearer.as_deref(), Some("token-a1"));
                let body = r
                    .body
                    .as_deref()
                    .map_or(Value::Null, |b| serde_json::from_str(b).unwrap());
                (r.method, r.path, body)
            })
            .collect()
    }
}

fn author(account: &str) -> Value {
    json!({ "accountId": account, "name": "Sigrún Jónsdóttir", "verified": true })
}

fn community(id: &str, audience: &str) -> Value {
    json!({
        "communityId": id,
        "name": "Kór Hlíðanna",
        "description": "Æfingar á þriðjudögum",
        "audience": audience,
        "createdAt": 1_760_000_000_000u64,
        "memberCount": 12,
        "role": "moderator",
        "joinRequested": false,
        "invited": false,
        "mutedUntil": null,
        "readOnly": false,
        "deletedAt": null,
        "joinDeclinedUntil": null,
        "pendingJoinRequests": 3,
    })
}

fn post(id: &str) -> Value {
    json!({
        "postId": id,
        "communityId": "cm_1",
        "author": author("acc_b"),
        "body": "Æfing fellur niður í kvöld.",
        "media": [{ "mediaId": "sm_1", "width": 1024, "height": 768 }],
        "createdAt": 1_760_000_100_000u64,
        "reactions": [{ "kind": "like", "count": 3 }, { "kind": "sad", "count": 1 }],
        "myReaction": "like",
        "commentCount": 2,
        "state": "visible",
    })
}

fn comment(id: &str) -> Value {
    json!({
        "commentId": id,
        "postId": "p_1",
        "author": author("acc_c"),
        "body": "Takk fyrir að láta vita.",
        "createdAt": 1_760_000_200_000u64,
        "state": "hidden",
    })
}

#[test]
fn communities_are_listed_created_joined_and_left() {
    let phone = Phone::signed_in();
    let c = &phone.client;

    phone.answer(
        200,
        json!({ "communities": [community("cm_1", "open")], "next": "1760000000000-cm_1" }),
    );
    let page = c
        .communities(Some("  Kór Hl "), Some("1760000000000-cm_0"), 500)
        .unwrap();
    assert_eq!(page.next.as_deref(), Some("1760000000000-cm_1"));
    let first = &page.communities[0];
    assert_eq!(
        (first.community_id.as_str(), first.audience, first.role),
        ("cm_1", Audience::Open, Some(Role::Moderator))
    );
    assert_eq!(first.member_count, Some(12));

    phone.answer(200, json!({ "communities": [] }));
    assert!(c.my_communities().unwrap().is_empty());

    phone.answer(200, community("cm_2", "private"));
    let made = c
        .create_community(" Kór Hlíðanna ", "Æfingar á þriðjudögum", Audience::Private)
        .unwrap();
    assert_eq!(made.audience, Audience::Private);

    phone.answer(200, community("cm_2", "private"));
    c.community("cm_2").unwrap();
    phone.answer(200, json!({ "state": "requested" }));
    assert_eq!(c.join_community("cm_2").unwrap(), JoinState::Requested);
    phone.ok();
    c.withdraw_join_request("cm_2").unwrap();
    phone.ok();
    c.leave_community("cm_2").unwrap();

    assert_eq!(
        phone.sent(),
        [
            (
                Method::Get,
                "/v1/communities?q=K%C3%B3r%20Hl&after=1760000000000-cm_0&limit=50".into(),
                Value::Null
            ),
            (Method::Get, "/v1/me/communities".into(), Value::Null),
            (
                Method::Post,
                "/v1/communities".into(),
                json!({
                    "name": "Kór Hlíðanna",
                    "description": "Æfingar á þriðjudögum",
                    "audience": "private",
                })
            ),
            (Method::Get, "/v1/communities/cm_2".into(), Value::Null),
            (Method::Post, "/v1/communities/cm_2/join".into(), json!({})),
            (
                Method::Delete,
                "/v1/communities/cm_2/join".into(),
                Value::Null
            ),
            (Method::Post, "/v1/communities/cm_2/leave".into(), json!({})),
        ]
    );
}

#[test]
fn posts_comments_and_reactions_go_by_their_ids() {
    let phone = Phone::signed_in();
    let c = &phone.client;

    phone.answer(200, json!({ "posts": [post("p_1")], "next": null }));
    let page = c
        .community_posts("cm_1", None, Some("1760000100000"), 0)
        .unwrap();
    assert_eq!(page.next, None);
    let first = &page.posts[0];
    assert_eq!(
        first.reactions,
        [
            ReactionCount {
                kind: ReactionKind::Like,
                count: 3
            },
            ReactionCount {
                kind: ReactionKind::Sad,
                count: 1
            }
        ]
    );
    assert_eq!(first.my_reaction, Some(ReactionKind::Like));
    assert_eq!(
        first.media,
        [SocialMedia {
            media_id: "sm_1".into(),
            width: 1024,
            height: 768
        }]
    );
    assert_eq!(
        (first.comment_count, first.state),
        (2, ModerationState::Visible)
    );
    assert_eq!(
        first.author,
        Author {
            account_id: "acc_b".into(),
            name: Some("Sigrún Jónsdóttir".into()),
            verified: true,
            photo: None,
            role: None,
        }
    );
    assert_eq!(first.latest_comment, None);

    phone.answer(200, post("p_2"));
    c.create_post("cm_1", "Æfing fellur niður í kvöld.", &[])
        .unwrap();
    phone.answer(200, post("p_1"));
    c.post("p_1").unwrap();
    phone.ok();
    c.delete_post("p_2").unwrap();
    phone.ok();
    c.react("p_1", ReactionKind::Love).unwrap();
    phone.ok();
    c.unreact("p_1").unwrap();

    phone.answer(
        200,
        json!({ "comments": [comment("p_1-0a1b")], "next": "1760000200000-0a1b" }),
    );
    let comments = c.comments("p_1", None, 1000).unwrap();
    assert_eq!(comments.comments[0].state, ModerationState::Hidden);
    assert_eq!(comments.next.as_deref(), Some("1760000200000-0a1b"));
    phone.answer(200, comment("p_1-0a1c"));
    let made = c
        .create_comment("p_1", "Takk fyrir að láta vita.", None, &[])
        .unwrap();
    assert_eq!(made.comment_id, "p_1-0a1c");
    phone.ok();
    c.delete_comment("p_1-0a1c").unwrap();

    assert_eq!(
        phone.sent(),
        [
            (
                Method::Get,
                "/v1/communities/cm_1/posts?before=1760000100000&limit=1".into(),
                Value::Null
            ),
            (
                Method::Post,
                "/v1/communities/cm_1/posts".into(),
                json!({ "body": "Æfing fellur niður í kvöld.", "media": [] })
            ),
            (Method::Get, "/v1/posts/p_1".into(), Value::Null),
            (Method::Delete, "/v1/posts/p_2".into(), Value::Null),
            (
                Method::Put,
                "/v1/posts/p_1/reaction".into(),
                json!({ "kind": "love" })
            ),
            (Method::Delete, "/v1/posts/p_1/reaction".into(), Value::Null),
            (
                Method::Get,
                "/v1/posts/p_1/comments?limit=100".into(),
                Value::Null
            ),
            (
                Method::Post,
                "/v1/posts/p_1/comments".into(),
                json!({ "body": "Takk fyrir að láta vita." })
            ),
            (Method::Delete, "/v1/comments/p_1-0a1c".into(), Value::Null),
        ]
    );
}

#[test]
fn reports_moderation_and_cards() {
    let phone = Phone::signed_in();
    let c = &phone.client;

    phone.ok();
    c.report(&NewReport {
        target: Target {
            kind: TargetKind::Comment,
            id: "p_1-0a1b".into(),
        },
        reason: ReportReason::Harassment,
        note: "Endurtekið".into(),
        to_platform: false,
    })
    .unwrap();

    phone.answer(
        200,
        json!({
            "reports": [{
                "reportId": "r_1",
                "communityId": "cm_1",
                "target": { "kind": "comment", "id": "p_1-0a1b" },
                "targetAccount": author("acc_c"),
                "reason": "harassment",
                "note": "Endurtekið",
                "state": "open",
                "createdAt": 1_760_000_300_000u64,
                "closedAt": null,
                "decision": null,
                "resolution": null,
                "closedBy": null,
                "targetStanding": null,
                "targetState": null,
            }],
            "next": null,
        }),
    );
    let queue = c
        .community_reports("cm_1", ReportState::Open, Some("1760000300000-r_0"), 20)
        .unwrap();
    let report = &queue.reports[0];
    assert_eq!(
        (report.reason, report.state, report.target.kind),
        (
            ReportReason::Harassment,
            ReportState::Open,
            TargetKind::Comment
        )
    );
    assert_eq!(report.target_account.as_ref().unwrap().account_id, "acc_c");

    phone.ok();
    c.moderate(
        "cm_1",
        &Moderation {
            action: ModerationAction::HideComment,
            target_id: "p_1-0a1b".into(),
            reason: "Áreitni".into(),
            report_id: Some("r_1".into()),
            until: None,
        },
    )
    .unwrap();
    phone.ok();
    c.moderate(
        "cm_1",
        &Moderation {
            action: ModerationAction::MuteMember,
            target_id: "acc_c".into(),
            reason: "Áreitni".into(),
            report_id: None,
            until: Some(1_760_086_400_000),
        },
    )
    .unwrap();
    phone.ok();
    c.close_report("r_1", "Falið").unwrap();

    let refs = [
        Ref {
            kind: RefKind::Post,
            id: "p_1".into(),
        },
        Ref {
            kind: RefKind::Comment,
            id: "p_1-0a1b".into(),
        },
        Ref {
            kind: RefKind::Community,
            id: "cm_1".into(),
        },
        Ref {
            kind: RefKind::Post,
            id: "p_9".into(),
        },
    ];
    let named = json!({ "communityId": "cm_1", "name": "Kór Hlíðanna", "photo": "ph_kor" });
    phone.answer(
        200,
        json!({ "cards": [
            {
                "kind": "post", "ref": { "kind": "post", "id": "p_1" }, "community": named,
                "author": author("acc_b"), "excerpt": "Æfing fellur…",
                "image": { "mediaId": "sm_1", "width": 1024, "height": 768 },
                "createdAt": 1_760_000_100_000u64,
            },
            {
                "kind": "comment", "ref": { "kind": "comment", "id": "p_1-0a1b" },
                "community": named, "postId": "p_1", "author": author("acc_c"),
                "excerpt": "Takk", "createdAt": 1_760_000_200_000u64,
            },
            {
                "kind": "community", "ref": { "kind": "community", "id": "cm_1" },
                "community": named, "description": "Æfingar", "audience": "open",
                "memberCount": null,
            },
            { "kind": "unavailable", "ref": { "kind": "post", "id": "p_9" } },
        ] }),
    );
    let cards = c.cards(&refs).unwrap();
    let community = CardCommunity {
        community_id: "cm_1".into(),
        name: "Kór Hlíðanna".into(),
        photo: Some("ph_kor".into()),
    };
    assert!(
        matches!(&cards[0], Card::Post { excerpt, image: Some(image), community: on, .. }
        if excerpt == "Æfing fellur…" && image.media_id == "sm_1" && *on == community)
    );
    assert!(matches!(&cards[1], Card::Comment { post_id, .. } if post_id == "p_1"));
    assert!(matches!(
        &cards[2],
        Card::Community {
            audience: Audience::Open,
            member_count: None,
            ..
        }
    ));
    assert_eq!(
        cards[3],
        Card::Unavailable {
            reference: refs[3].clone()
        }
    );
    // None asked, none sent.
    assert!(c.cards(&[]).unwrap().is_empty());

    assert_eq!(
        phone.sent(),
        [
            (
                Method::Post,
                "/v1/reports".into(),
                json!({
                    "target": { "kind": "comment", "id": "p_1-0a1b" },
                    "reason": "harassment",
                    "note": "Endurtekið",
                    "toPlatform": false,
                })
            ),
            (
                Method::Get,
                "/v1/communities/cm_1/reports?state=open&after=1760000300000-r_0&limit=20".into(),
                Value::Null
            ),
            (
                Method::Post,
                "/v1/communities/cm_1/actions".into(),
                json!({
                    "action": "hide_comment",
                    "targetId": "p_1-0a1b",
                    "reason": "Áreitni",
                    "reportId": "r_1",
                })
            ),
            (
                Method::Post,
                "/v1/communities/cm_1/actions".into(),
                json!({
                    "action": "mute_member",
                    "targetId": "acc_c",
                    "reason": "Áreitni",
                    "until": 1_760_086_400_000u64,
                })
            ),
            (
                Method::Post,
                "/v1/reports/r_1/close".into(),
                json!({ "resolution": "Falið" })
            ),
            (
                Method::Post,
                "/v1/cards".into(),
                json!({ "refs": [
                    { "kind": "post", "id": "p_1" },
                    { "kind": "comment", "id": "p_1-0a1b" },
                    { "kind": "community", "id": "cm_1" },
                    { "kind": "post", "id": "p_9" },
                ] })
            ),
        ]
    );
}

#[test]
fn notifications_are_paged_and_read_and_an_unknown_kind_is_left_out() {
    let phone = Phone::signed_in();
    let c = &phone.client;

    let notification = |id: &str, kind: &str, action: Value| {
        json!({
            "notificationId": id,
            "kind": kind,
            "actor": if kind == "moderated" { Value::Null } else { author("acc_b") },
            "communityId": "cm_1",
            "postId": "p_1",
            "commentId": null,
            "action": action,
            "createdAt": 1_760_000_400_000u64,
            "read": false,
        })
    };
    phone.answer(
        200,
        json!({
            "notifications": [
                notification("n_3", "reaction", Value::Null),
                notification("n_2", "mention", Value::Null),
                notification("n_1", "moderated", json!("hide_post")),
                notification("n_0", "moderated", json!("pin_post")),
            ],
            "unread": 4,
            "next": "1760000400000",
        }),
    );
    let page = c.notifications(Some("1760000500000"), 20).unwrap();
    assert_eq!(page.unread, 4);
    assert_eq!(page.next.as_deref(), Some("1760000400000"));
    let kinds: Vec<_> = page
        .notifications
        .iter()
        .map(|n| (n.notification_id.as_str(), n.kind, n.action))
        .collect();
    assert_eq!(
        kinds,
        [
            ("n_3", NotificationKind::Reaction, None),
            (
                "n_1",
                NotificationKind::Moderated,
                Some(ModerationAction::HidePost)
            ),
            ("n_0", NotificationKind::Moderated, None),
        ]
    );
    assert_eq!(page.notifications[1].actor, None);

    phone.ok();
    c.read_notifications(1_760_000_400_000).unwrap();

    assert_eq!(
        phone.sent(),
        [
            (
                Method::Get,
                "/v1/notifications?before=1760000500000&limit=20".into(),
                Value::Null
            ),
            (
                Method::Post,
                "/v1/notifications/read".into(),
                json!({ "upTo": 1_760_000_400_000u64 })
            ),
        ]
    );
}

/// 0080: a byline carries its photo and role, and a post its newest comment;
/// a server from before sends none of them, and a role this core does not
/// know decodes as `Unknown` instead of failing the page.
#[test]
fn a_byline_and_a_latest_comment_decode_with_or_without_the_new_fields() {
    let phone = Phone::signed_in();
    let c = &phone.client;
    let mut byline = author("acc_b");
    byline["photo"] = json!("ph_0123");
    byline["role"] = json!("owner");
    let mut with = post("p_1");
    with["author"] = byline;
    with["latestComment"] = {
        let mut latest = comment("p_1-0a");
        latest["author"]["role"] = json!("curator");
        latest["author"]["photo"] = Value::Null;
        latest
    };
    phone.answer(200, with);
    let found = c.post("p_1").unwrap();
    assert_eq!(found.author.photo.as_deref(), Some("ph_0123"));
    assert_eq!(found.author.role, Some(AuthorRole::Owner));
    let latest = found.latest_comment.unwrap();
    assert_eq!(latest.comment_id, "p_1-0a");
    assert_eq!(latest.author.role, Some(AuthorRole::Unknown));
    assert_eq!(latest.author.photo, None);

    let mut explicit_null = post("p_2");
    explicit_null["author"]["photo"] = Value::Null;
    explicit_null["author"]["role"] = Value::Null;
    explicit_null["latestComment"] = Value::Null;
    phone.answer(200, explicit_null);
    let none = c.post("p_2").unwrap();
    assert_eq!(
        (none.author.photo, none.author.role, none.latest_comment),
        (None, None, None)
    );

    phone.answer(200, post("p_3"));
    assert_eq!(c.post("p_3").unwrap().latest_comment, None);
}

#[test]
fn a_refusal_keeps_its_code_and_a_bad_id_is_never_sent() {
    let phone = Phone::signed_in();
    let c = &phone.client;

    phone.answer(
        409,
        json!({ "error": "owner_cannot_leave", "requestId": "relay-1" }),
    );
    assert!(matches!(
        c.leave_community("cm_1"),
        Err(ClientError::Transport(ApiError::Refused { status: 409, code, request_id: Some(id) }))
            if code == "owner_cannot_leave" && id == "relay-1"
    ));
    phone.answer(200, json!({ "postId": "p_1" }));
    assert!(matches!(
        c.post("p_1"),
        Err(ClientError::Transport(ApiError::Malformed("getPost")))
    ));
    phone.sent();

    for refused in [
        c.community("../me").map(drop),
        c.post("p_1?x=1").map(drop),
        c.delete_comment("").map(drop),
        c.react("p 1", ReactionKind::Like),
        c.create_comment("p_1", "  ", None, &[]).map(drop),
        c.create_comment("p_1", "", None, &["sm_1".into(), "sm_2".into()])
            .map(drop),
        c.close_report("r_1", " ").map(drop),
        c.create_community(" ", "", Audience::Open).map(drop),
        c.moderate("cm_1", &mute(None)),
        c.moderate(
            "cm_1",
            &Moderation {
                action: ModerationAction::BanMember,
                ..mute(Some(1_760_086_400_000))
            },
        ),
    ] {
        assert!(matches!(refused, Err(ClientError::Invalid(_))));
    }
    assert!(phone.sent().is_empty());

    // Not signed in: no request at all.
    let dir = tempfile::tempdir().unwrap();
    let relay = Relay::new();
    let transport = Hosted {
        link: relay.link("b", "b1"),
        canned: Arc::default(),
    };
    let signed_out = Client::open(dir.path(), &KEY, transport).unwrap();
    assert!(matches!(
        signed_out.my_communities(),
        Err(ClientError::NotRegistered)
    ));
}

#[test]
fn a_post_takes_images_uploaded_first() {
    let phone = Phone::signed_in();
    let c = &phone.client;
    let dir = tempfile::tempdir().unwrap();
    let photo = dir.path().join("kor.jpg");
    std::fs::write(&photo, b"\xff\xd8\xff\xe0 a jpeg").unwrap();

    phone.answer(
        200,
        json!({ "mediaId": "sm_1", "width": 2048, "height": 1536 }),
    );
    let image = c.upload_social_media("cm_1", &photo).unwrap();
    assert_eq!(
        image,
        SocialMedia {
            media_id: "sm_1".into(),
            width: 2048,
            height: 1536
        }
    );
    phone.answer(200, post("p_1"));
    c.create_post("cm_1", "", &["sm_1".into()]).unwrap();

    phone.answer(200, Value::Null);
    let kept = c.post_media("p_1", "sm_1").unwrap();
    assert_eq!(std::fs::read(&kept).unwrap(), IMAGE);
    // Kept: the second call asks nothing.
    assert_eq!(c.post_media("p_1", "sm_1").unwrap(), kept);

    phone.answer(404, json!({ "error": "not_found" }));
    assert!(matches!(
        c.post_media("p_1", "sm_2"),
        Err(ClientError::Transport(ApiError::Refused {
            status: 404,
            ..
        }))
    ));
    assert!(!kept.with_file_name("sm_2.part").exists());

    assert_eq!(
        phone.canned.lock().unwrap().uploaded,
        [b"\xff\xd8\xff\xe0 a jpeg".to_vec()]
    );
    assert_eq!(
        phone.sent(),
        [
            (
                Method::Post,
                "/v1/communities/cm_1/media".into(),
                Value::Null
            ),
            (
                Method::Post,
                "/v1/communities/cm_1/posts".into(),
                json!({ "body": "", "media": ["sm_1"] })
            ),
            (Method::Get, "/v1/posts/p_1/media/sm_1".into(), Value::Null),
            (Method::Get, "/v1/posts/p_1/media/sm_2".into(), Value::Null),
        ]
    );
}

#[test]
fn images_are_refused_before_they_are_sent() {
    let phone = Phone::signed_in();
    let c = &phone.client;
    let dir = tempfile::tempdir().unwrap();
    let empty = dir.path().join("empty.png");
    std::fs::write(&empty, b"").unwrap();
    let big = dir.path().join("big.png");
    std::fs::File::create(&big)
        .unwrap()
        .set_len(spjall_client::MAX_POST_IMAGE + 1)
        .unwrap();

    let refused = |r: Result<_, ClientError>| matches!(r, Err(ClientError::Invalid(_)));
    assert!(refused(c.upload_social_media("cm_1", &empty).map(drop)));
    assert!(refused(c.upload_social_media("cm_1", &big).map(drop)));
    let five: Vec<String> = (1..=5).map(|i| format!("sm_{i}")).collect();
    assert!(refused(c.create_post("cm_1", "Myndir", &five).map(drop)));
    assert!(refused(c.create_post("cm_1", "  ", &[]).map(drop)));
    assert!(refused(
        c.create_post("cm_1", "", &["../x".into()]).map(drop)
    ));
    assert!(refused(c.post_media("p_1", "../../x").map(drop)));
    assert!(phone.sent().is_empty());
}

fn mute(until: Option<u64>) -> Moderation {
    Moderation {
        action: ModerationAction::MuteMember,
        target_id: "acc_c".into(),
        reason: "Áreitni".into(),
        report_id: None,
        until,
    }
}

#[test]
fn the_lifecycle_calls_go_to_their_paths_and_decode() {
    let phone = Phone::signed_in();
    let c = &phone.client;

    phone.answer(
        200,
        json!({ "requests": [{
            "accountId": "acc_r",
            "name": null,
            "verified": false,
            "requestedAt": 1_760_000_500_000u64,
        }] }),
    );
    let waiting = c.join_requests("cm_1").unwrap();
    assert_eq!(waiting.len(), 1);
    assert_eq!(waiting[0].account_id, "acc_r");
    assert_eq!(waiting[0].name, None);
    assert_eq!(waiting[0].requested_at, 1_760_000_500_000);

    phone.ok();
    c.approve_join_request("cm_1", "acc_r").unwrap();
    phone.ok();
    c.decline_join_request("cm_1", "acc_s").unwrap();
    phone.ok();
    c.delete_community("cm_1").unwrap();
    phone.answer(200, community("cm_1", "open"));
    let restored = c.restore_community("cm_1").unwrap();
    assert_eq!(restored.community_id, "cm_1");

    assert_eq!(
        phone.sent(),
        [
            (
                Method::Get,
                "/v1/communities/cm_1/join-requests".into(),
                Value::Null
            ),
            (
                Method::Post,
                "/v1/communities/cm_1/join-requests/acc_r".into(),
                json!({})
            ),
            (
                Method::Delete,
                "/v1/communities/cm_1/join-requests/acc_s".into(),
                Value::Null
            ),
            (Method::Delete, "/v1/communities/cm_1".into(), Value::Null),
            (
                Method::Post,
                "/v1/communities/cm_1/restore".into(),
                json!({})
            ),
        ]
    );

    for refused in [
        c.join_requests("../x").map(drop),
        c.approve_join_request("cm_1", "a/b"),
        c.decline_join_request("", "acc_r"),
        c.delete_community("cm 1"),
        c.restore_community("cm_1?x").map(drop),
    ] {
        assert!(
            matches!(refused, Err(ClientError::Invalid(_))),
            "{refused:?}"
        );
    }
    assert!(phone.sent().is_empty());
}

#[test]
fn a_community_with_lifecycle_fields_decodes() {
    let phone = Phone::signed_in();
    let mut body = community("cm_1", "private");
    body["deletedAt"] = json!(1_760_000_900_000u64);
    body["joinDeclinedUntil"] = json!(1_760_100_000_000u64);
    body["pendingJoinRequests"] = json!(4);
    body["openReports"] = json!(2);
    phone.answer(200, body);
    let got = phone.client.community("cm_1").unwrap();
    assert_eq!(got.deleted_at, Some(1_760_000_900_000));
    assert_eq!(got.join_declined_until, Some(1_760_100_000_000));
    assert_eq!(got.pending_join_requests, Some(4));
    assert_eq!(got.open_reports, Some(2));
}

#[test]
fn a_community_is_edited_and_its_members_and_log_read() {
    let phone = Phone::signed_in();
    let c = &phone.client;

    phone.answer(200, community("cm_1", "private"));
    let edited = c
        .update_community(
            "cm_1",
            Some("  Kór Hlíðanna "),
            None,
            Some(Audience::Private),
        )
        .unwrap();
    assert_eq!(edited.name, "Kór Hlíðanna");
    // A server older than the reports count sends none.
    assert_eq!(edited.open_reports, None);

    phone.answer(
        200,
        json!({ "members": [
            {
                "accountId": "acc_a", "name": "Sigrún Jónsdóttir", "verified": true,
                "role": "owner", "joinedAt": 1_760_000_000_000u64,
                "photo": "ph_a",
            },
            {
                "accountId": "acc_b", "name": null, "verified": false,
                "role": "member", "joinedAt": 1_760_000_600_000u64,
            },
        ] }),
    );
    let members = c.community_members("cm_1").unwrap();
    assert_eq!(members.len(), 2);
    assert_eq!(
        (
            members[0].account_id.as_str(),
            members[0].role,
            members[0].joined_at
        ),
        ("acc_a", Role::Owner, 1_760_000_000_000)
    );
    assert_eq!(
        (members[1].name.as_deref(), members[1].role),
        (None, Role::Member)
    );
    // The photo version decodes; a row from an older server has none.
    assert_eq!(members[0].photo.as_deref(), Some("ph_a"));
    assert_eq!(members[1].photo, None);

    phone.ok();
    c.set_community_role("cm_1", "acc_b", Role::Moderator)
        .unwrap();

    phone.answer(
        200,
        json!({ "entries": [
            {
                "entryId": 7,
                "communityId": "cm_1",
                "actor": author("acc_a"),
                "asPlatform": false,
                "action": "hide_comment",
                "target": { "kind": "comment", "id": "p_1-0a1b" },
                "targetAccount": author("acc_c"),
                "reason": "Áreitni",
                "createdAt": 1_760_000_700_000u64,
            },
            {
                "entryId": 6,
                "communityId": null,
                "actor": null,
                "asPlatform": true,
                "action": "teleported",
                "target": { "kind": "planet", "id": "x_1" },
                "targetAccount": null,
                "reason": "",
                "createdAt": 1_760_000_690_000u64,
            },
        ], "next": "7" }),
    );
    let log = c.community_moderation_log("cm_1", Some("8"), 500).unwrap();
    let newest = &log.entries[0];
    assert_eq!(
        (newest.entry_id, newest.action, newest.target.kind),
        (7, ModerationLogAction::HideComment, LogTargetKind::Comment)
    );
    assert_eq!(newest.target.id, "p_1-0a1b");
    assert_eq!(newest.actor.as_ref().unwrap().account_id, "acc_a");
    assert_eq!(newest.target_account.as_ref().unwrap().account_id, "acc_c");
    assert!(!newest.as_platform);
    assert_eq!(log.next.as_deref(), Some("7"));
    let unknown = &log.entries[1];
    assert_eq!(unknown.action, ModerationLogAction::Unknown);
    assert_eq!(unknown.target.kind, LogTargetKind::Unknown);
    assert!(unknown.as_platform);
    assert!(unknown.community_id.is_none() && unknown.actor.is_none());

    assert_eq!(
        phone.sent(),
        [
            (
                Method::Patch,
                "/v1/communities/cm_1".into(),
                json!({ "name": "Kór Hlíðanna", "audience": "private" })
            ),
            (
                Method::Get,
                "/v1/communities/cm_1/members".into(),
                Value::Null
            ),
            (
                Method::Put,
                "/v1/communities/cm_1/members/acc_b/role".into(),
                json!({ "role": "moderator" })
            ),
            (
                Method::Get,
                "/v1/communities/cm_1/moderation-log?before=8&limit=100".into(),
                Value::Null
            ),
        ]
    );

    for refused in [
        c.update_community("cm_1", Some("  "), None, None).map(drop),
        c.update_community("../me", None, Some("x"), None).map(drop),
        c.community_members("cm 1").map(drop),
        c.set_community_role("cm_1", "a/b", Role::Member),
        c.community_moderation_log("cm_1?x", None, 20).map(drop),
    ] {
        assert!(
            matches!(refused, Err(ClientError::Invalid(_))),
            "{refused:?}"
        );
    }
    assert!(phone.sent().is_empty());
}

#[test]
fn the_feed_gathers_the_communities_and_a_search_names_the_words() {
    let phone = Phone::signed_in();
    let c = &phone.client;

    phone.answer(
        200,
        json!({ "posts": [post("p_1")], "next": "1760000100000" }),
    );
    let page = c.feed(Some("1760000200000"), 500).unwrap();
    assert_eq!(page.posts.len(), 1);
    assert_eq!(page.next.as_deref(), Some("1760000100000"));

    phone.answer(200, json!({ "posts": [], "next": null }));
    let searched = c
        .community_posts("cm_1", Some("  Æfing "), None, 20)
        .unwrap();
    assert!(searched.posts.is_empty());

    assert_eq!(
        phone.sent(),
        [
            (
                Method::Get,
                "/v1/feed?before=1760000200000&limit=50".into(),
                Value::Null
            ),
            (
                Method::Get,
                "/v1/communities/cm_1/posts?q=%C3%86fing&limit=20".into(),
                Value::Null
            ),
        ]
    );
}

#[test]
fn a_reply_names_the_comment_it_answers() {
    let phone = Phone::signed_in();
    let c = &phone.client;

    let mut answered = comment("p_1-0a1d");
    answered["parentCommentId"] = json!("p_1-0a1b");
    phone.answer(200, answered);
    let made = c
        .create_comment("p_1", "Rétt hjá þér.", Some("p_1-0a1b"), &[])
        .unwrap();
    assert_eq!(made.parent_comment_id.as_deref(), Some("p_1-0a1b"));

    assert_eq!(
        phone.sent(),
        [(
            Method::Post,
            "/v1/posts/p_1/comments".into(),
            json!({ "body": "Rétt hjá þér.", "parentCommentId": "p_1-0a1b" })
        )]
    );

    assert!(matches!(
        c.create_comment("p_1", "Svar", Some("../x"), &[]),
        Err(ClientError::Invalid("comment id"))
    ));
    assert!(phone.sent().is_empty());
}
#[test]
fn a_closed_report_decodes_and_unknown_values_fall_back() {
    let phone = Phone::signed_in();
    let closed = |decision: &str, standing: &str, state: &str| {
        json!({
            "reportId": "r_1",
            "communityId": "cm_1",
            "target": { "kind": "post", "id": "p_1" },
            "targetAccount": author("acc_c"),
            "reason": "spam",
            "note": "",
            "state": "closed",
            "createdAt": 1_760_000_300_000u64,
            "closedAt": 1_760_000_400_000u64,
            "decision": decision,
            "resolution": "Falið",
            "closedBy": author("acc_m"),
            "targetStanding": standing,
            "targetState": state,
        })
    };
    phone.answer(
        200,
        json!({ "reports": [
            closed("hide_post", "muted", "hidden"),
            closed("something_new", "exiled", "frozen"),
        ], "next": null }),
    );
    let queue = phone
        .client
        .community_reports("cm_1", ReportState::Closed, None, 20)
        .unwrap();
    let known = &queue.reports[0];
    assert_eq!(known.decision, Some(ReportDecision::HidePost));
    assert_eq!(known.resolution.as_deref(), Some("Falið"));
    assert_eq!(known.closed_by.as_ref().unwrap().account_id, "acc_m");
    assert_eq!(known.target_standing, Some(TargetStanding::Muted));
    assert_eq!(known.target_state, Some(TargetState::Hidden));
    let unknown = &queue.reports[1];
    assert_eq!(unknown.decision, Some(ReportDecision::Unknown));
    assert_eq!(unknown.target_standing, Some(TargetStanding::Unknown));
    assert_eq!(unknown.target_state, Some(TargetState::Unknown));
}

#[test]
fn a_declined_join_keeps_its_code() {
    let phone = Phone::signed_in();
    phone.answer(409, json!({ "error": "join_declined" }));
    assert!(matches!(
        phone.client.join_community("cm_1"),
        Err(ClientError::Transport(ApiError::Refused { status: 409, code, .. }))
            if code == "join_declined"
    ));
}

#[test]
fn a_community_picture_and_cover_are_uploaded_and_removed() {
    let phone = Phone::signed_in();
    let c = &phone.client;
    let dir = tempfile::tempdir().unwrap();
    let image = dir.path().join("kor.jpg");
    std::fs::write(&image, b"image:first").unwrap();

    phone.answer(200, json!({ "version": "ph_one" }));
    assert_eq!(c.set_community_avatar("cm_1", &image).unwrap(), "ph_one");
    phone.answer(200, json!({ "version": "ph_two" }));
    assert_eq!(c.set_community_cover("cm_1", &image).unwrap(), "ph_two");
    phone.ok();
    c.remove_community_avatar("cm_1").unwrap();
    phone.ok();
    c.remove_community_cover("cm_1").unwrap();
    assert_eq!(
        phone
            .sent()
            .into_iter()
            .map(|(method, path, _)| (method, path))
            .collect::<Vec<_>>(),
        [
            (Method::Put, "/v1/communities/cm_1/avatar".to_string()),
            (Method::Put, "/v1/communities/cm_1/cover".to_string()),
            (Method::Delete, "/v1/communities/cm_1/avatar".to_string()),
            (Method::Delete, "/v1/communities/cm_1/cover".to_string()),
        ]
    );
    assert_eq!(phone.canned.lock().unwrap().uploaded.len(), 2);

    // A community carries their versions.
    let mut body = community("cm_1", "open");
    body["photo"] = json!("ph_one");
    body["cover"] = json!("ph_two");
    phone.answer(200, body);
    let got = c.community("cm_1").unwrap();
    assert_eq!(got.photo.as_deref(), Some("ph_one"));
    assert_eq!(got.cover.as_deref(), Some("ph_two"));
    // A server older than the images sends neither.
    phone.answer(200, community("cm_1", "open"));
    let old = c.community("cm_1").unwrap();
    assert_eq!((old.photo, old.cover), (None, None));
}

#[test]
fn the_hub_pins_likes_and_unread_are_sent_and_decoded() {
    let phone = Phone::signed_in();
    let c = &phone.client;
    for _ in 0..6 {
        phone.ok();
    }
    c.pin_community("cm_1").unwrap();
    c.unpin_community("cm_1").unwrap();
    c.pin_post("cm_1", "p_1").unwrap();
    c.unpin_post("cm_1", "p_1").unwrap();
    c.like_comment("p_1-0a1b").unwrap();
    c.unlike_comment("p_1-0a1b").unwrap();
    assert_eq!(
        phone
            .sent()
            .into_iter()
            .map(|(method, path, _)| (method, path))
            .collect::<Vec<_>>(),
        [
            (Method::Put, "/v1/communities/cm_1/pin".to_string()),
            (Method::Delete, "/v1/communities/cm_1/pin".to_string()),
            (
                Method::Put,
                "/v1/communities/cm_1/posts/p_1/pin".to_string()
            ),
            (
                Method::Delete,
                "/v1/communities/cm_1/posts/p_1/pin".to_string()
            ),
            (Method::Put, "/v1/comments/p_1-0a1b/like".to_string()),
            (Method::Delete, "/v1/comments/p_1-0a1b/like".to_string()),
        ]
    );
    // A bad id never reaches the network.
    assert!(c.pin_community("no spaces").is_err());
    assert!(c.pin_post("cm_1", "no spaces").is_err());
    assert!(c.like_comment("no spaces").is_err());
    assert!(phone.sent().is_empty());

    // New fields decode.
    let mut body = community("cm_1", "open");
    body["unread"] = json!(4);
    body["lastPostAt"] = json!(1_760_000_300_000u64);
    body["pinned"] = json!(true);
    phone.answer(200, body);
    let got = c.community("cm_1").unwrap();
    assert_eq!(
        (got.unread, got.last_post_at, got.pinned),
        (4, Some(1_760_000_300_000), true)
    );
    let mut pinned = post("p_1");
    pinned["pinned"] = json!(true);
    phone.answer(200, pinned);
    assert!(c.post("p_1").unwrap().pinned);
    let mut liked = comment("p_1-0a1b");
    liked["likes"] = json!(3);
    liked["liked"] = json!(true);
    phone.answer(200, json!({ "comments": [liked], "next": null }));
    let first = &c.comments("p_1", None, 10).unwrap().comments[0];
    assert_eq!((first.likes, first.liked), (3, true));

    // A server older than the hub sends none of them.
    phone.answer(200, community("cm_1", "open"));
    let old = c.community("cm_1").unwrap();
    assert_eq!((old.unread, old.last_post_at, old.pinned), (0, None, false));
    phone.answer(200, post("p_1"));
    assert!(!c.post("p_1").unwrap().pinned);
    phone.answer(
        200,
        json!({ "comments": [comment("p_1-0a1b")], "next": null }),
    );
    let old = &c.comments("p_1", None, 10).unwrap().comments[0];
    assert_eq!((old.likes, old.liked), (0, false));
}

#[test]
fn a_community_image_is_refused_before_a_request_when_empty_or_too_big() {
    let phone = Phone::signed_in();
    let c = &phone.client;
    let dir = tempfile::tempdir().unwrap();
    let empty = dir.path().join("empty.png");
    std::fs::write(&empty, b"").unwrap();
    let big = dir.path().join("big.png");
    std::fs::File::create(&big)
        .unwrap()
        .set_len(spjall_client::MAX_PHOTO + 1)
        .unwrap();
    let ok = dir.path().join("ok.png");
    std::fs::write(&ok, b"image").unwrap();

    let refused = |r: Result<_, ClientError>| matches!(r, Err(ClientError::Invalid(_)));
    assert!(refused(c.set_community_avatar("cm_1", &empty).map(drop)));
    assert!(refused(c.set_community_avatar("cm_1", &big).map(drop)));
    assert!(refused(c.set_community_cover("cm_1", &empty).map(drop)));
    assert!(refused(c.set_community_cover("cm_1", &big).map(drop)));
    assert!(refused(c.set_community_avatar("../x", &ok).map(drop)));
    assert!(refused(c.remove_community_cover("a/b")));
    assert!(phone.sent().is_empty());
}

#[test]
fn a_community_picture_and_cover_are_fetched_once_per_version() {
    let mut phone = Phone::signed_in();
    for cover in [false, true] {
        let kind = if cover { "cover" } else { "avatar" };
        let fetch = |phone: &mut Phone, version: &str| {
            if cover {
                phone.client.community_cover("cm_1", version)
            } else {
                phone.client.community_picture("cm_1", version)
            }
        };
        phone.answer(200, Value::Null);
        let first = fetch(&mut phone, "ph_one").unwrap().unwrap();
        assert!(first.ends_with(format!("communities/cm_1/{kind}/ph_one.webp")));
        assert_eq!(std::fs::read(&first).unwrap(), IMAGE);
        // Kept: the second call asks nothing.
        assert_eq!(fetch(&mut phone, "ph_one").unwrap().unwrap(), first);
        // A new version is fetched and replaces the old file.
        phone.answer(200, Value::Null);
        let second = fetch(&mut phone, "ph_two").unwrap().unwrap();
        assert!(second.ends_with(format!("communities/cm_1/{kind}/ph_two.webp")));
        assert!(!first.exists());
        assert_eq!(
            phone
                .sent()
                .into_iter()
                .map(|(method, path, _)| (method, path))
                .collect::<Vec<_>>(),
            [
                (Method::Get, format!("/v1/communities/cm_1/{kind}")),
                (Method::Get, format!("/v1/communities/cm_1/{kind}")),
            ]
        );
    }
}

#[test]
fn a_community_picture_the_server_lacks_is_none_and_clears_the_kept_file() {
    let mut phone = Phone::signed_in();
    phone.answer(200, Value::Null);
    let kept = phone
        .client
        .community_picture("cm_1", "ph_one")
        .unwrap()
        .unwrap();
    assert!(kept.exists());
    phone.answer(404, json!({ "error": "not_found" }));
    assert_eq!(
        phone.client.community_picture("cm_1", "ph_two").unwrap(),
        None
    );
    assert!(!kept.exists());
    assert!(!kept.parent().unwrap().exists());
    // A server error is not a 404: it propagates and keeps nothing half-fetched.
    phone.answer(500, json!({ "error": "internal" }));
    assert!(matches!(
        phone.client.community_cover("cm_1", "ph_three"),
        Err(ClientError::Transport(ApiError::Refused {
            status: 500,
            ..
        }))
    ));
    let _ = phone.sent();
}

#[test]
fn a_bad_community_picture_id_is_refused_without_a_request() {
    let mut phone = Phone::signed_in();
    assert!(matches!(
        phone.client.community_picture("../x", "ph_one"),
        Err(ClientError::Invalid(_))
    ));
    assert!(matches!(
        phone.client.community_cover("cm_1", "../x"),
        Err(ClientError::Invalid(_))
    ));
    assert!(phone.sent().is_empty());
}

#[test]
fn a_comment_carries_one_image() {
    let phone = Phone::signed_in();
    let c = &phone.client;

    let mut with_image = comment("p_1-0a1e");
    with_image["media"] = json!([{ "mediaId": "sm_1", "width": 30, "height": 20 }]);
    phone.answer(200, with_image);
    let made = c.create_comment("p_1", "", None, &["sm_1".into()]).unwrap();
    assert_eq!(made.media.len(), 1);
    assert_eq!(made.media[0].media_id, "sm_1");
    assert_eq!(
        phone.sent(),
        [(
            Method::Post,
            "/v1/posts/p_1/comments".into(),
            json!({ "body": "", "media": ["sm_1"] })
        )]
    );

    // A comment from a server before 0082 has no `media`.
    phone.answer(200, comment("p_1-0a1f"));
    assert!(
        c.create_comment("p_1", "Text", None, &[])
            .unwrap()
            .media
            .is_empty()
    );
}
