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
    ApiError, Audience, Author, Card, CardCommunity, JoinState, Method, Moderation,
    ModerationAction, ModerationState, NewReport, NotificationKind, Platform, Provider,
    ReactionCount, ReactionKind, Ref, RefKind, ReportReason, ReportState, Request, Response, Role,
    SocialMedia, Target, TargetKind, Transport, Unreachable,
};
use spjall_client::{Client, ClientError};
use tempfile::TempDir;

const KEY: [u8; 32] = [7; 32];

const SOCIAL: [&str; 7] = [
    "/v1/communities",
    "/v1/me/communities",
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
}

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
        self.link.upload(request, file)
    }

    fn download(&self, request: Request, to: &Path) -> Result<Response, Unreachable> {
        self.link.download(request, to)
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
    let page = c.community_posts("cm_1", Some("1760000100000"), 0).unwrap();
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
            verified: true
        }
    );

    phone.answer(200, post("p_2"));
    c.create_post("cm_1", "Æfing fellur niður í kvöld.")
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
    let made = c.create_comment("p_1", "Takk fyrir að láta vita.").unwrap();
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
                json!({ "body": "Æfing fellur niður í kvöld." })
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
    let named = json!({ "communityId": "cm_1", "name": "Kór Hlíðanna" });
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
        c.create_comment("p_1", "  ").map(drop),
        c.close_report("r_1", " ").map(drop),
        c.create_community(" ", "", Audience::Open).map(drop),
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
