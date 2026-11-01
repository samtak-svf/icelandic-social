use spjall_store::Store;

use super::*;

const GROUP: &[u8] = b"group";

#[test]
fn a_sent_file_name_is_a_name_and_never_a_path() {
    assert_eq!(file_name("skýrsla.pdf").as_deref(), Some("skýrsla.pdf"));
    assert_eq!(file_name("../../etc/passwd").as_deref(), Some("passwd"));
    assert_eq!(file_name("C:\\x\\y.txt").as_deref(), Some("y.txt"));
    assert_eq!(file_name(" a\u{0}b\n.png ").as_deref(), Some("ab.png"));
    assert_eq!(file_name(&"x".repeat(300)).map(|n| n.len()), Some(120));
    for nothing in ["", "/", "..", "a/.", " "] {
        assert_eq!(file_name(nothing), None, "{nothing:?}");
    }
}

struct Fold {
    store: Store,
    seq: u64,
    _dir: tempfile::TempDir,
}

impl Fold {
    fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let mut store = Store::open(dir.path(), &[3; 32]).unwrap();
        store
            .write(|tx| {
                tx.execute(
                    "INSERT INTO conversations (group_id, cursor, created_at) VALUES (?1, 0, 0)",
                    [GROUP],
                )
            })
            .unwrap();
        Self {
            store,
            seq: 0,
            _dir: dir,
        }
    }

    /// Folds `body` from `account`'s device `device` as "a" sees it;
    /// the envelope id is `id`.
    fn apply(&mut self, from: (&str, &str), id: &str, body: Body) -> Option<Vec<u64>> {
        self.seq += 1;
        let seq = self.seq;
        let sender = Device::new(from.0, from.1).unwrap();
        let envelope = Envelope {
            id: id.into(),
            ts: seq,
            body,
        };
        self.store
            .try_write(|tx| fold(tx, GROUP, seq, &sender, &envelope, "a"))
            .unwrap()
    }

    fn items(&mut self) -> Vec<Item> {
        self.store
            .try_write(|tx| items(tx, GROUP, "a", None, 100))
            .unwrap()
    }

    /// Queues `body` in the outbox as `send` does, under the envelope id `id`.
    fn queue(&mut self, id: &str, body: Body) {
        let bytes = Envelope {
            id: id.into(),
            ts: 99,
            body,
        }
        .encode()
        .unwrap();
        self.store
            .write(|tx| {
                tx.execute(
                    "INSERT INTO outbox (group_id, kind, intent, created_at)
                     VALUES (?1, 'message', ?2, 0)",
                    params![GROUP, bytes],
                )
            })
            .unwrap();
    }
}

/// One row this core cannot decode keeps its place as an unreadable
/// item; the rows around it read as before (0051).
#[test]
fn an_undecodable_row_is_an_unreadable_item_in_its_place() {
    for (kind, detail, code) in [
        ("text", "{", "protocol/a stored text row"),
        ("media", "{", "protocol/a stored media row"),
        ("post", "{", "protocol/a stored post row"),
        ("location", "{", "protocol/a stored location row"),
        ("members", "{", "protocol/a stored card"),
        ("timer", "{", "protocol/a stored card"),
    ] {
        let mut fold = Fold::new();
        fold.apply(("b", "b1"), "m1", text("fyrst"));
        fold.apply(("b", "b1"), "m2", text("brotin"));
        fold.apply(("b", "b1"), "m3", text("síðast"));
        fold.apply(("a", "a1"), "r1", react("m2", false));
        fold.store
            .write(|tx| {
                tx.execute(
                    "UPDATE timeline SET kind = ?1, detail = ?2, text = NULL,
                         envelope_id = IIF(?1 IN ('members', 'timer'), NULL, envelope_id)
                     WHERE seq = 2",
                    [kind, detail],
                )
            })
            .unwrap();
        let items = fold.items();
        assert_eq!(items.len(), 3, "{kind}");
        assert_eq!(
            items[1].content,
            Content::Unreadable { code: code.into() },
            "{kind}"
        );
        assert_eq!(items[1].seq, Some(2));
        assert_eq!(items[1].ts, 2);
        // Cards carry no reactions; a message keeps its own.
        let card = matches!(kind, "members" | "timer");
        assert_eq!(items[1].reactions.len(), usize::from(!card), "{kind}");
        assert!(matches!(&items[2].content, Content::Text { text, .. } if text == "síðast"));
        // What the conversation list reads.
        let last = fold
            .store
            .try_write(|tx| super::items(tx, GROUP, "a", Some(3), 1))
            .unwrap();
        assert_eq!(last[0].content, Content::Unreadable { code: code.into() });
    }
}

/// A queued message this device cannot read back is an unreadable
/// item too, after what is already sent.
#[test]
fn an_undecodable_queued_message_is_an_unreadable_item() {
    let mut fold = Fold::new();
    fold.apply(("b", "b1"), "m1", text("hæ"));
    fold.store
        .write(|tx| {
            tx.execute(
                "INSERT INTO outbox (group_id, kind, intent, created_at)
                 VALUES (?1, 'message', x'7b', 0)",
                [GROUP],
            )
        })
        .unwrap();
    let items = fold.items();
    assert_eq!(items.len(), 2);
    assert_eq!(
        items[1].content,
        Content::Unreadable {
            code: "envelope/malformed".into()
        }
    );
    assert_eq!(items[1].status, Status::Pending);
}

/// A failing store still fails: only decoding is softened (0051).
#[test]
fn a_store_failure_still_fails() {
    let mut fold = Fold::new();
    fold.apply(("b", "b1"), "m1", text("hæ"));
    fold.store
        .write(|tx| tx.execute_batch("ALTER TABLE timeline DROP COLUMN received_at"))
        .unwrap();
    let result = fold.store.try_write(|tx| items(tx, GROUP, "a", None, 100));
    assert!(matches!(result, Err(ClientError::Store(_))));
}

fn text(text: &str) -> Body {
    Body::Text {
        text: text.into(),
        forwarded: false,
    }
}

fn react(target: &str, remove: bool) -> Body {
    Body::Reaction {
        target: target.into(),
        emoji: "❤️".into(),
        remove,
    }
}

#[test]
fn an_edit_of_an_edit_shows_the_last_text() {
    let mut fold = Fold::new();
    fold.apply(("b", "b1"), "m", text("eitt"));
    let edit = |text: &str| Body::Edit {
        target: "m".into(),
        text: text.into(),
    };
    assert_eq!(fold.apply(("b", "b1"), "e1", edit("tvö")), Some(vec![1]));
    // From the sender's other device, too.
    assert_eq!(fold.apply(("b", "b2"), "e2", edit("þrjú")), Some(vec![1]));
    // Never from another account.
    assert_eq!(fold.apply(("c", "c1"), "e3", edit("fjögur")), None);
    let items = fold.items();
    assert_eq!(items.len(), 1);
    assert_eq!(
        items[0].content,
        Content::Text {
            text: "þrjú".into(),
            reply_to: None
        }
    );
    assert!(items[0].edited);
}

#[test]
fn a_deleted_message_takes_no_reaction_and_no_edit() {
    let mut fold = Fold::new();
    fold.apply(("b", "b1"), "m", text("eitt"));
    fold.apply(("a", "a1"), "r", react("m", false));
    let delete = Body::Delete { target: "m".into() };
    assert_eq!(fold.apply(("c", "c1"), "d0", delete.clone()), None);
    assert_eq!(fold.apply(("b", "b1"), "d1", delete.clone()), Some(vec![1]));
    assert_eq!(fold.apply(("b", "b1"), "d2", delete), None);
    assert_eq!(fold.apply(("c", "c1"), "r2", react("m", false)), None);
    let edit = Body::Edit {
        target: "m".into(),
        text: "aftur".into(),
    };
    assert_eq!(fold.apply(("b", "b1"), "e", edit), None);
    let items = fold.items();
    assert_eq!(items[0].content, Content::Deleted);
    assert!(items[0].reactions.is_empty());
}

#[test]
fn a_reaction_is_one_per_account_and_can_be_taken_back() {
    let mut fold = Fold::new();
    fold.apply(("b", "b1"), "m", text("eitt"));
    assert_eq!(
        fold.apply(("a", "a1"), "r1", react("m", false)),
        Some(vec![1])
    );
    // The same from another device of the account changes nothing.
    assert_eq!(fold.apply(("a", "a2"), "r2", react("m", false)), None);
    assert_eq!(
        fold.apply(("c", "c1"), "r3", react("m", false)),
        Some(vec![1])
    );
    let reactions = &fold.items()[0].reactions;
    assert_eq!(reactions.len(), 1);
    assert!(reactions[0].own);
    assert_eq!(reactions[0].people.len(), 2);

    assert_eq!(
        fold.apply(("a", "a2"), "r4", react("m", true)),
        Some(vec![1])
    );
    assert_eq!(fold.apply(("a", "a1"), "r5", react("m", true)), None);
    let reactions = &fold.items()[0].reactions;
    assert!(!reactions[0].own);
    assert_eq!(reactions[0].people[0].account, "c");
    // A reaction to nothing here is dropped.
    assert_eq!(fold.apply(("c", "c1"), "r6", react("x", false)), None);
}

/// A place off the globe from another client is skipped as an unknown
/// kind is: no row, and the conversation goes on (0059).
#[test]
fn a_location_off_the_globe_is_skipped() {
    let mut fold = Fold::new();
    let off = Body::Location {
        lat_e6: 90_000_001,
        lon_e6: 0,
        accuracy: None,
        forwarded: false,
    };
    assert_eq!(fold.apply(("b", "b1"), "l", off), None);
    assert_eq!(fold.apply(("b", "b1"), "m", text("eftir")), Some(vec![2]));
    assert_eq!(fold.items().len(), 1);
}

/// A share is a row of its own with only the post's id; an edit has no
/// text to change on it, and a delete for everyone takes it away (0040).
#[test]
fn a_shared_post_is_its_id_and_cannot_be_edited() {
    let mut fold = Fold::new();
    let share = Body::Post {
        post_id: "p_1".into(),
        forwarded: false,
    };
    assert_eq!(fold.apply(("b", "b1"), "s", share), Some(vec![1]));
    let shown = |fold: &mut Fold| fold.items()[0].content.clone();
    assert_eq!(
        shown(&mut fold),
        Content::Post {
            post_id: "p_1".into()
        }
    );
    let edit = Body::Edit {
        target: "s".into(),
        text: "annað".into(),
    };
    assert_eq!(fold.apply(("b", "b1"), "e", edit), None);
    assert!(!fold.items()[0].edited);
    let delete = Body::Delete { target: "s".into() };
    assert_eq!(fold.apply(("b", "b1"), "d", delete), Some(vec![1]));
    assert_eq!(shown(&mut fold), Content::Deleted);
}

#[test]
fn typing_and_unknown_kinds_leave_no_item() {
    let mut fold = Fold::new();
    let unknown = Body::Unknown {
        kind: "poll".into(),
    };
    assert_eq!(fold.apply(("b", "b1"), "u", unknown), None);
    assert_eq!(
        fold.apply(("b", "b1"), "t", Body::Typing { active: true }),
        None
    );
    assert!(fold.items().is_empty());
}

mod cards;
mod queued;
mod read;
