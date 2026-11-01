use super::*;

/// What this device queued shows on the items it returns with no
/// request (0099): a reaction, its removal, an edit, a delete.
#[test]
fn a_queued_reaction_shows_before_any_sync() {
    let mut fold = Fold::new();
    fold.apply(("b", "b1"), "m", text("eitt"));
    fold.apply(("c", "c1"), "r0", react("m", false));
    fold.queue("r1", react("m", false));
    let items = fold.items();
    // The reaction itself is no item of its own.
    assert_eq!(items.len(), 1);
    let reactions = &items[0].reactions;
    assert_eq!(reactions.len(), 1);
    assert!(reactions[0].own);
    let people: Vec<_> = reactions[0].people.iter().map(|p| &*p.account).collect();
    assert_eq!(people, ["a", "c"]);
}

#[test]
fn a_queued_removal_hides_an_own_reaction() {
    let mut fold = Fold::new();
    fold.apply(("b", "b1"), "m", text("eitt"));
    fold.apply(("a", "a1"), "r0", react("m", false));
    fold.apply(("c", "c1"), "r1", react("m", false));
    fold.queue("r2", react("m", true));
    let reactions = &fold.items()[0].reactions;
    assert_eq!(reactions.len(), 1);
    assert!(!reactions[0].own);
    assert_eq!(reactions[0].people.len(), 1);
    // The last own reaction taken back leaves no chip.
    fold.apply(("c", "c1"), "r3", react("m", true));
    assert!(fold.items()[0].reactions.is_empty());
}

#[test]
fn a_queued_reaction_and_its_echo_count_once() {
    let mut fold = Fold::new();
    fold.apply(("b", "b1"), "m", text("eitt"));
    fold.queue("r1", react("m", false));
    // The echo folds while the row is still in the outbox.
    fold.apply(("a", "a1"), "r1", react("m", false));
    let reactions = &fold.items()[0].reactions;
    assert_eq!(reactions.len(), 1);
    assert_eq!(reactions[0].people.len(), 1);
    // And once the row is gone the result is the same.
    let before = fold.items();
    fold.store
        .write(|tx| tx.execute("DELETE FROM outbox", []))
        .unwrap();
    assert_eq!(fold.items(), before);
}

#[test]
fn queued_reactions_apply_in_order() {
    let mut fold = Fold::new();
    fold.apply(("b", "b1"), "m", text("eitt"));
    fold.queue("r1", react("m", false));
    fold.queue("r2", react("m", true));
    assert!(fold.items()[0].reactions.is_empty());
    fold.queue("r3", react("m", false));
    assert_eq!(fold.items()[0].reactions.len(), 1);
}

#[test]
fn a_queued_reaction_to_a_deleted_or_unknown_message_shows_nothing() {
    let mut fold = Fold::new();
    fold.apply(("b", "b1"), "m", text("eitt"));
    fold.apply(("b", "b1"), "d", Body::Delete { target: "m".into() });
    fold.queue("r1", react("m", false));
    fold.queue("r2", react("x", false));
    let items = fold.items();
    assert_eq!(items.len(), 1);
    assert!(items[0].reactions.is_empty());
}

#[test]
fn a_queued_edit_shows_its_text() {
    let mut fold = Fold::new();
    fold.apply(("a", "a1"), "m", text("eitt"));
    fold.apply(("b", "b1"), "n", text("annað"));
    let edit = |target: &str| Body::Edit {
        target: target.into(),
        text: "tvö".into(),
    };
    fold.queue("e1", edit("m"));
    // Never another account's message.
    fold.queue("e2", edit("n"));
    let items = fold.items();
    assert_eq!(
        items[0].content,
        Content::Text {
            text: "tvö".into(),
            reply_to: None
        }
    );
    assert!(items[0].edited);
    assert!(!items[1].edited);
    assert_eq!(
        items[1].content,
        Content::Text {
            text: "annað".into(),
            reply_to: None
        }
    );
}

#[test]
fn a_queued_delete_shows_the_tombstone() {
    let mut fold = Fold::new();
    fold.apply(("a", "a1"), "m", text("eitt"));
    fold.apply(("b", "b1"), "n", text("annað"));
    fold.apply(("b", "b1"), "r", react("m", false));
    fold.queue("d1", Body::Delete { target: "m".into() });
    fold.queue("d2", Body::Delete { target: "n".into() });
    let items = fold.items();
    assert_eq!(items[0].content, Content::Deleted);
    assert!(items[0].reactions.is_empty());
    assert_ne!(items[1].content, Content::Deleted);
    // The echo gives the same item.
    let before = fold.items();
    fold.apply(("a", "a1"), "d1", Body::Delete { target: "m".into() });
    fold.store
        .write(|tx| tx.execute("DELETE FROM outbox", []))
        .unwrap();
    let after = fold.items();
    assert_eq!(after[0], before[0]);
}

pub(super) fn media(caption: Option<&str>, name: Option<&str>, forwarded: bool) -> Body {
    Body::Media {
        object: "o".into(),
        mime: "image/png".into(),
        size: 7,
        key: "k".into(),
        sha256: "h".into(),
        caption: caption.map(Into::into),
        name: name.map(Into::into),
        forwarded,
    }
}

/// A file, a share and a place queued but not sent show as pending items
/// with their own content; a file name is never a path.
#[test]
fn queued_media_post_and_location_show_as_pending_items() {
    let mut fold = Fold::new();
    fold.queue("q1", media(Some("mynd"), Some("../../etc/y.png"), true));
    fold.queue(
        "q2",
        Body::Post {
            post_id: "p_1".into(),
            forwarded: true,
        },
    );
    fold.queue(
        "q3",
        Body::Location {
            lat_e6: 64_000_000,
            lon_e6: -21_000_000,
            accuracy: Some(5),
            forwarded: false,
        },
    );
    let items = fold.items();
    assert_eq!(items.len(), 3);
    assert!(items.iter().all(|i| i.own && i.status == Status::Pending));
    assert_eq!(
        items[0].content,
        Content::Media {
            mime: "image/png".into(),
            size: 7,
            caption: Some("mynd".into()),
            name: Some("y.png".into())
        }
    );
    assert_eq!(
        items[1].content,
        Content::Post {
            post_id: "p_1".into()
        }
    );
    assert_eq!(
        items[2].content,
        Content::Location {
            lat_e6: 64_000_000,
            lon_e6: -21_000_000,
            accuracy: Some(5)
        }
    );
    let forwarded: Vec<bool> = items.iter().map(|i| i.forwarded).collect();
    assert_eq!(forwarded, [true, true, false]);
}

#[test]
fn a_queued_item_that_failed_to_send_is_failed() {
    let mut fold = Fold::new();
    fold.queue("q1", text("hæ"));
    fold.store
        .write(|tx| tx.execute("UPDATE outbox SET failed = 1", []))
        .unwrap();
    assert_eq!(fold.items()[0].status, Status::Failed);
    // So does one this device cannot read back.
    fold.store
        .write(|tx| {
            tx.execute(
                "INSERT INTO outbox (group_id, kind, intent, created_at, failed)
                 VALUES (?1, 'message', x'7b', 0, 1)",
                [GROUP],
            )
        })
        .unwrap();
    let items = fold.items();
    assert_eq!(items[1].status, Status::Failed);
    assert!(matches!(items[1].content, Content::Unreadable { .. }));
}

/// A queued edit changes a stored text or a file's caption and nothing
/// else: a share has no text to change.
#[test]
fn a_queued_edit_changes_a_text_or_a_caption_and_nothing_else() {
    let mut fold = Fold::new();
    fold.apply(("a", "a1"), "t", text("eitt"));
    fold.apply(("a", "a1"), "f", media(Some("fyrr"), None, false));
    let share = Body::Post {
        post_id: "p_1".into(),
        forwarded: false,
    };
    fold.apply(("a", "a1"), "s", share);
    for target in ["t", "f", "s"] {
        fold.queue(
            &format!("e-{target}"),
            Body::Edit {
                target: target.into(),
                text: "nýtt".into(),
            },
        );
    }
    let items = fold.items();
    assert_eq!(
        items[0].content,
        Content::Text {
            text: "nýtt".into(),
            reply_to: None
        }
    );
    assert!(matches!(
        &items[1].content,
        Content::Media { caption, .. } if caption.as_deref() == Some("nýtt")
    ));
    assert_eq!(
        items[2].content,
        Content::Post {
            post_id: "p_1".into()
        }
    );
    let edited: Vec<bool> = items.iter().map(|i| i.edited).collect();
    assert_eq!(edited, [true, true, false]);
}

/// A queued add replaces the person's earlier reaction, as the fold does;
/// a chip left with nobody goes, one others share stays.
#[test]
fn a_queued_reaction_replaces_the_earlier_one() {
    let mut fold = Fold::new();
    fold.apply(("b", "b1"), "m", text("eitt"));
    fold.apply(("b", "b1"), "n", text("tvö"));
    let add = |target: &str, emoji: &str| Body::Reaction {
        target: target.into(),
        emoji: emoji.into(),
        remove: false,
    };
    fold.apply(("a", "a1"), "r1", add("m", "❤️"));
    fold.apply(("c", "c1"), "r2", add("m", "❤️"));
    fold.apply(("a", "a1"), "r3", add("n", "❤️"));
    fold.queue("q1", add("m", "👍"));
    fold.queue("q2", add("n", "👍"));
    let items = fold.items();
    let chips = |i: usize| -> Vec<(String, bool, usize)> {
        let all = items[i].reactions.iter();
        all.map(|r| (r.emoji.clone(), r.own, r.people.len()))
            .collect()
    };
    assert_eq!(chips(0), [("❤️".into(), false, 1), ("👍".into(), true, 1)]);
    assert_eq!(chips(1), [("👍".into(), true, 1)]);
}
