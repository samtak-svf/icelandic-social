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
