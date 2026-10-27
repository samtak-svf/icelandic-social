//! The notification calls (0063, 0103 to 0107) as the core makes them: each
//! one's method, path and body, what it makes of the server's answer, and
//! what `notices()` announces of it.

#![allow(clippy::disallowed_methods)] // tests use files

#[path = "support/hosted.rs"]
mod hosted;
#[path = "support/relay.rs"]
#[allow(dead_code)]
mod relay;

use hosted::{Phone, author};
use serde_json::{Value, json};
use spjall_client::api::{Method, ModerationAction, NotificationKind, NotificationLevel};

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
            "emoji": if kind == "reaction" { json!("🙏") } else { Value::Null },
            "createdAt": 1_760_000_400_000u64,
            "read": false,
            "actors": if kind == "moderated" { json!([]) } else { json!([author("acc_b"), author("acc_c")]) },
            "actorCount": if kind == "moderated" { 0 } else { 5 },
            "snippet": if kind == "comment" || kind == "reply" { json!("Sæl öll") } else { Value::Null },
            "announce": kind == "reaction",
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
            "unseen": 2,
            "seenAt": 1_760_000_100_000u64,
            "next": "1760000400000",
        }),
    );
    let page = c.notifications(Some("1760000500000"), 20).unwrap();
    assert_eq!(page.unread, 4);
    assert_eq!(page.unseen, 2);
    assert_eq!(page.seen_at, Some(1_760_000_100_000));
    assert_eq!(page.notifications[0].actors.len(), 2);
    assert_eq!(page.notifications[0].actor_count, 5);
    assert!(page.notifications[0].announce);
    assert!(!page.notifications[1].announce);
    assert_eq!(page.notifications[1].actor_count, 0);
    assert_eq!(page.next.as_deref(), Some("1760000400000"));
    let kinds: Vec<_> = page
        .notifications
        .iter()
        .map(|n| {
            (
                n.notification_id.as_str(),
                n.kind,
                n.action,
                n.emoji.as_deref(),
            )
        })
        .collect();
    assert_eq!(
        kinds,
        [
            ("n_3", NotificationKind::Reaction, None, Some("🙏")),
            (
                "n_1",
                NotificationKind::Moderated,
                Some(ModerationAction::HidePost),
                None
            ),
            ("n_0", NotificationKind::Moderated, None, None),
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

/// 0103 to 0106: the reply kind, the actors, snippet and announce of a row,
/// and the seen time and unseen count of a page. A body from a server before
/// them still decodes, with the old defaults.
#[test]
fn a_notification_decodes_with_or_without_the_grouping_fields() {
    let phone = Phone::signed_in();
    let row = |id: &str, kind: &str| {
        json!({
            "notificationId": id, "kind": kind, "actor": author("acc_b"),
            "communityId": "cm_1", "postId": "p_1", "commentId": "co_1",
            "action": null, "createdAt": 1_760_000_400_000u64, "read": false,
        })
    };
    phone.answer(
        200,
        json!({
            "notifications": [row("n_1", "reply"), row("n_0", "comment")],
            "unread": 2, "next": null,
        }),
    );
    let page = phone.client.notifications(None, 20).unwrap();
    assert_eq!(page.seen_at, None);
    assert_eq!(page.unseen, 0);
    assert_eq!(page.notifications[0].kind, NotificationKind::Reply);
    for n in &page.notifications {
        assert_eq!(n.actors, Vec::new());
        assert_eq!(n.actor_count, 0);
        assert_eq!(n.snippet, None);
        assert!(!n.announce);
    }
    assert_eq!(
        phone.sent(),
        [(
            Method::Get,
            "/v1/notifications?limit=20".into(),
            Value::Null
        )]
    );
}

/// 0104 and 0106: the calls that mark seen, read one row, delete one, and
/// set the levels.
#[test]
fn seen_one_read_delete_and_the_levels_are_sent_as_the_server_reads_them() {
    let phone = Phone::signed_in();
    let c = &phone.client;
    phone.ok();
    c.seen_notifications(1_760_000_400_000).unwrap();
    phone.ok();
    c.read_notification("n_1", false).unwrap();
    phone.ok();
    c.delete_notification("n_1").unwrap();
    phone.answer(
        200,
        json!({
            "kinds": {
                "comment": "push", "reply": "in_app", "reaction": "off",
                "join_approved": "push", "moderated": "in_app"
            },
            "communities": [{ "communityId": "cm_1", "level": "off" }],
        }),
    );
    let settings = c.notification_settings().unwrap();
    assert_eq!(
        settings.kinds,
        [
            (NotificationKind::Comment, NotificationLevel::Push),
            (NotificationKind::Reply, NotificationLevel::InApp),
            (NotificationKind::Reaction, NotificationLevel::Off),
            (NotificationKind::JoinApproved, NotificationLevel::Push),
            (NotificationKind::Moderated, NotificationLevel::InApp),
        ]
    );
    assert_eq!(
        settings.communities,
        [("cm_1".to_owned(), NotificationLevel::Off)]
    );
    phone.ok();
    c.set_notification_settings(&[(NotificationKind::Reaction, NotificationLevel::InApp)])
        .unwrap();
    phone.ok();
    c.set_community_notification_level("cm_1", NotificationLevel::Push)
        .unwrap();
    assert_eq!(
        phone.sent(),
        [
            (
                Method::Post,
                "/v1/notifications/seen".into(),
                json!({ "upTo": 1_760_000_400_000u64 })
            ),
            (
                Method::Post,
                "/v1/notifications/read".into(),
                json!({ "notificationId": "n_1", "read": false })
            ),
            (Method::Delete, "/v1/notifications/n_1".into(), Value::Null),
            (Method::Get, "/v1/notification-settings".into(), Value::Null),
            (
                Method::Put,
                "/v1/notification-settings".into(),
                json!({ "kinds": { "reaction": "in_app" } })
            ),
            (
                Method::Put,
                "/v1/communities/cm_1/notification-level".into(),
                json!({ "level": "push" })
            ),
        ]
    );
    // An id the server would refuse is refused before it is sent, and one
    // with a slash cannot change the path.
    assert!(c.delete_notification("").is_err());
    assert!(c.delete_notification(&"n".repeat(201)).is_err());
    assert!(c.read_notification("", true).is_err());
    assert!(
        c.set_community_notification_level("cm 1", NotificationLevel::Off)
            .is_err()
    );
}

/// What `notices()` asked of the server: the first page of 20.
const FIRST_PAGE: &str = "/v1/notifications?limit=20";

/// A page the server answers `notices()` with. Each row is `(id, createdAt,
/// read, announce)`.
fn announce_page(phone: &Phone, rows: &[(&str, u64, bool, bool)], next: Option<&str>) {
    let rows: Vec<Value> = rows
        .iter()
        .map(|(id, created, read, announce)| {
            json!({
                "notificationId": id, "kind": "comment", "actor": author("acc_b"),
                "actors": [author("acc_b")], "actorCount": 1,
                "communityId": "cm_1", "postId": "p_1", "commentId": "co_1",
                "action": null, "emoji": null, "createdAt": created, "read": read,
                "snippet": "Aldrei á lásskjá", "announce": announce,
            })
        })
        .collect();
    phone.answer(
        200,
        json!({
            "notifications": rows, "unread": 0, "unseen": 0, "seenAt": null,
            "next": next,
        }),
    );
}

fn shown(phone: &mut Phone) -> (Vec<(String, u64)>, Vec<String>) {
    let notices = phone.client.notices().unwrap();
    assert_eq!(notices.shown, Vec::new(), "no chat here");
    let social = notices
        .social
        .iter()
        .map(|n| (n.notification_id.clone(), n.created_at))
        .collect();
    (social, notices.social_cleared)
}

/// 0107: the first run on a device announces nothing old, a row is shown
/// once, shown again when its group gains an actor, and never when it has no
/// `announce`.
#[test]
fn social_notices_seed_on_first_run_then_show_a_row_once_and_again_when_it_grows() {
    let mut phone = Phone::signed_in();
    announce_page(
        &phone,
        &[("n_1", 100, false, true), ("n_0", 50, false, true)],
        None,
    );
    assert_eq!(shown(&mut phone), (Vec::new(), Vec::new()));

    // The same page again: nothing new.
    announce_page(
        &phone,
        &[("n_1", 100, false, true), ("n_0", 50, false, true)],
        None,
    );
    assert_eq!(shown(&mut phone), (Vec::new(), Vec::new()));

    // A new row, one that gained an actor (newer created_at), one at a level
    // below push (no announce).
    announce_page(
        &phone,
        &[
            ("n_3", 400, false, true),
            ("n_2", 300, false, false),
            ("n_1", 200, false, true),
            ("n_0", 50, false, true),
        ],
        None,
    );
    assert_eq!(
        shown(&mut phone),
        (vec![("n_1".into(), 200), ("n_3".into(), 400)], Vec::new())
    );
    announce_page(
        &phone,
        &[
            ("n_3", 400, false, true),
            ("n_1", 200, false, true),
            ("n_0", 50, false, true),
        ],
        None,
    );
    assert_eq!(shown(&mut phone), (Vec::new(), Vec::new()));

    // The core asked for the first page only.
    let sent = phone.sent();
    assert_eq!(sent.len(), 4);
    assert!(
        sent.iter()
            .all(|(m, p, _)| *m == Method::Get && p == FIRST_PAGE)
    );
}

/// A first page with nothing on it still seeds: the next unread row is news.
#[test]
fn an_empty_first_page_still_seeds() {
    let mut phone = Phone::signed_in();
    announce_page(&phone, &[], None);
    assert_eq!(shown(&mut phone), (Vec::new(), Vec::new()));
    announce_page(&phone, &[("n_1", 100, false, true)], None);
    assert_eq!(shown(&mut phone), (vec![("n_1".into(), 100)], Vec::new()));
}

/// 0107: reading a row, here or elsewhere, or its going away, takes its
/// notice away once. A row that only fell off the first page stays.
#[test]
fn a_read_or_deleted_row_clears_its_notice_once() {
    let mut phone = Phone::signed_in();
    announce_page(&phone, &[], None);
    shown(&mut phone);
    announce_page(
        &phone,
        &[
            ("n_3", 400, false, true),
            ("n_2", 300, false, true),
            ("n_1", 200, false, true),
        ],
        None,
    );
    assert_eq!(shown(&mut phone).0.len(), 3);

    // n_3 read, n_2 gone, n_1 still unread.
    announce_page(
        &phone,
        &[("n_3", 400, true, false), ("n_1", 200, false, true)],
        None,
    );
    assert_eq!(
        shown(&mut phone),
        (Vec::new(), vec!["n_2".into(), "n_3".into()])
    );
    announce_page(&phone, &[("n_1", 200, false, true)], None);
    assert_eq!(shown(&mut phone), (Vec::new(), Vec::new()));

    // Twenty newer rows push n_1 off the page: it is not gone.
    announce_page(
        &phone,
        &[("n_9", 900, true, false), ("n_8", 800, true, false)],
        Some("800"),
    );
    assert_eq!(shown(&mut phone), (Vec::new(), Vec::new()));
    announce_page(&phone, &[("n_9", 900, true, false)], None);
    assert_eq!(shown(&mut phone), (Vec::new(), vec!["n_1".into()]));
}

/// 0107: no lock screen carries a snippet, and a failed fetch is silent.
#[test]
fn a_failed_fetch_leaves_the_social_part_empty() {
    let mut phone = Phone::signed_in();
    phone.answer(503, json!({ "error": "unavailable" }));
    let notices = phone.client.notices().unwrap();
    assert!(notices.social.is_empty() && notices.social_cleared.is_empty());
    // The failed run seeded nothing, so the next one still does.
    announce_page(&phone, &[("n_1", 100, false, true)], None);
    assert_eq!(shown(&mut phone), (Vec::new(), Vec::new()));
    phone.sent();
}
