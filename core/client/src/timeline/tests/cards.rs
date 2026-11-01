use super::*;

fn group_of_three(fold: &mut Fold) {
    fold.store
        .write(|tx| crate::members::set_members(tx, GROUP, &["a".into(), "b".into(), "c".into()]))
        .unwrap();
}

fn name(name: &str) -> Body {
    Body::Name {
        name: Some(name.into()),
    }
}

#[test]
fn a_name_is_a_groups_and_must_be_a_name() {
    let mut fold = Fold::new();
    // Not a group of more than two: refused.
    assert_eq!(fold.apply(("b", "b1"), "n1", name("Hópur")), None);
    group_of_three(&mut fold);
    assert_eq!(fold.apply(("b", "b1"), "n2", name("a\nb")), None);
    assert_eq!(fold.apply(("b", "b1"), "n3", name("Hópur")), Some(vec![3]));
    assert_eq!(
        fold.items()[0].content,
        Content::Name {
            name: Some("Hópur".into())
        }
    );
}

fn settings(name: Option<&str>, timer: Option<u32>) -> Body {
    Body::Settings {
        name: name.map(Into::into),
        timer,
        photo: None,
    }
}

#[test]
fn a_snapshot_writes_a_card_only_for_what_it_changes() {
    let mut fold = Fold::new();
    group_of_three(&mut fold);
    assert_eq!(
        fold.apply(("b", "b1"), "s0", settings(Some("a\nb"), None)),
        None
    );
    // Only the timer differs: a timer card.
    assert_eq!(
        fold.apply(("b", "b1"), "s1", settings(None, Some(60))),
        Some(vec![2])
    );
    assert_eq!(
        fold.items()[0].content,
        Content::Timer { seconds: Some(60) }
    );
    // The same again changes nothing and writes nothing.
    assert_eq!(
        fold.apply(("b", "b1"), "s2", settings(None, Some(60))),
        None
    );
    assert_eq!(fold.items().len(), 1);
    // A name takes the card before the timer.
    assert_eq!(
        fold.apply(("b", "b1"), "s3", settings(Some("Hópur"), Some(5))),
        Some(vec![4])
    );
    assert!(matches!(fold.items()[1].content, Content::Name { .. }));
}

#[test]
fn a_receipt_for_a_message_not_here_changes_nothing() {
    let mut fold = Fold::new();
    fold.apply(("a", "a1"), "m1", text("eitt"));
    let receipt = Body::Receipt { up_to: "x".into() };
    assert_eq!(fold.apply(("b", "b1"), "x1", receipt), None);
    assert_eq!(fold.items()[0].read_by, 0);
}

/// A mark that lands on no message (the one it read was deleted) shows no
/// face, not one under a message it never read.
#[test]
fn a_mark_on_a_deleted_message_shows_no_face() {
    let mut fold = Fold::new();
    group_of_three(&mut fold);
    fold.apply(("c", "c1"), "m1", text("eitt"));
    fold.apply(("c", "c1"), "m2", text("tvö"));
    fold.apply(("b", "b1"), "x1", Body::Receipt { up_to: "m1".into() });
    fold.apply(
        ("c", "c1"),
        "d1",
        Body::Delete {
            target: "m1".into(),
        },
    );
    let faces: Vec<usize> = fold.items().iter().map(|i| i.read_here.len()).collect();
    assert_eq!(faces, [0, 0]);
}

/// A card whose detail cannot be read keeps its place as unreadable.
#[test]
fn a_damaged_name_or_photo_card_is_unreadable() {
    for kind in ["name", "photo"] {
        let mut fold = Fold::new();
        group_of_three(&mut fold);
        fold.apply(("b", "b1"), "n", name("Hópur"));
        fold.store
            .write(|tx| {
                tx.execute(
                    "UPDATE timeline SET kind = ?1, detail = '{' WHERE seq = 1",
                    [kind],
                )
            })
            .unwrap();
        assert_eq!(
            fold.items()[0].content,
            Content::Unreadable {
                code: "protocol/a stored card".into()
            },
            "{kind}"
        );
    }
}

/// Forwarding a file or a place whose stored detail is damaged is a
/// protocol error, not a copy of nothing.
#[test]
fn forwarding_a_damaged_media_or_location_row_is_a_protocol_error() {
    for (kind, reason) in [
        ("media", "a stored media row"),
        ("location", "a stored location row"),
    ] {
        let mut fold = Fold::new();
        fold.apply(("a", "a1"), "m", text("eitt"));
        fold.store
            .write(|tx| {
                tx.execute(
                    "UPDATE timeline SET kind = ?1, detail = '{', text = NULL WHERE seq = 1",
                    [kind],
                )
            })
            .unwrap();
        let result = fold.store.try_write(|tx| forwardable(tx, GROUP, 1));
        assert!(
            matches!(result, Err(ClientError::Protocol(r)) if r == reason),
            "{kind}"
        );
    }
}

/// The shared-media list holds live files only, with no read marker.
#[test]
fn the_shared_list_holds_live_files_only() {
    let mut fold = Fold::new();
    group_of_three(&mut fold);
    fold.apply(("b", "b1"), "t", text("eitt"));
    fold.apply(("b", "b1"), "f1", super::queued::media(None, None, false));
    fold.apply(("b", "b1"), "f2", super::queued::media(None, None, false));
    fold.apply(
        ("b", "b1"),
        "d",
        Body::Delete {
            target: "f2".into(),
        },
    );
    fold.apply(("c", "c1"), "x", Body::Receipt { up_to: "f1".into() });
    let list = fold
        .store
        .try_write(|tx| shared(tx, GROUP, "a", None, 10))
        .unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].seq, Some(2));
    assert!(list[0].read_here.is_empty());
}
