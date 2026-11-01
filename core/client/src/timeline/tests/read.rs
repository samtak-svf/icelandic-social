use super::*;

#[test]
fn a_receipt_counts_once_for_all_devices_of_an_account() {
    let mut fold = Fold::new();
    fold.apply(("a", "a1"), "m1", text("eitt"));
    fold.apply(("a", "a2"), "m2", text("tvö"));
    let receipt = |up_to: &str| Body::Receipt {
        up_to: up_to.into(),
    };
    assert_eq!(fold.apply(("b", "b1"), "x1", receipt("m1")), Some(vec![1]));
    assert_eq!(fold.apply(("b", "b2"), "x2", receipt("m1")), None);
    assert_eq!(
        fold.apply(("b", "b2"), "x3", receipt("m2")),
        Some(vec![1, 2])
    );
    // A mark never moves back.
    assert_eq!(fold.apply(("b", "b1"), "x4", receipt("m1")), None);
    let read: Vec<u32> = fold.items().iter().map(|i| i.read_by).collect();
    assert_eq!(read, vec![1, 1]);
    // This account's own receipt moves its own mark, and changes no item.
    fold.apply(("b", "b1"), "m3", text("þrjú"));
    assert_eq!(
        fold.apply(("a", "a2"), "x5", receipt("m3")),
        Some(Vec::new())
    );
    let unread = fold
        .store
        .try_write(|tx| crate::read::unread(tx, GROUP, "a"))
        .unwrap();
    assert_eq!(unread, 0);
}

#[test]
fn a_face_stays_under_the_newest_message_its_reader_read() {
    let mut fold = Fold::new();
    fold.store
        .write(|tx| crate::members::set_members(tx, GROUP, &["a".into(), "b".into(), "c".into()]))
        .unwrap();
    fold.apply(("a", "a1"), "m1", text("eitt"));
    fold.apply(("c", "c1"), "m2", text("tvö"));
    fold.apply(("a", "a1"), "m3", text("þrjú"));
    let receipt = |up_to: &str| Body::Receipt {
        up_to: up_to.into(),
    };
    let here = |fold: &mut Fold| -> Vec<Vec<String>> {
        let accounts = |i: &Item| i.read_here.iter().map(|p| p.account.clone()).collect();
        fold.items().iter().map(accounts).collect()
    };
    let empty = Vec::<String>::new();

    // Another person's message counts: the reader passed it too.
    assert_eq!(
        fold.apply(("b", "b1"), "x1", receipt("m2")),
        Some(vec![1, 2])
    );
    assert_eq!(
        here(&mut fold),
        vec![empty.clone(), vec!["b".to_owned()], empty.clone()]
    );
    // Moving on takes the face from where it was to where it is now.
    assert_eq!(
        fold.apply(("b", "b1"), "x2", receipt("m3")),
        Some(vec![2, 3])
    );
    assert_eq!(
        here(&mut fold),
        vec![empty.clone(), empty.clone(), vec!["b".to_owned()]]
    );

    // The face is worked out from the whole conversation, not the page.
    let mut page = |before| {
        fold.store
            .try_write(|tx| items(tx, GROUP, "a", before, 1))
            .unwrap()
    };
    assert!(page(Some(3)).iter().all(|i| i.read_here.is_empty()));
    assert_eq!(page(Some(4))[0].read_here[0].account, "b");

    // A message deleted under a face moves it back to the one before.
    fold.apply(
        ("a", "a1"),
        "d1",
        Body::Delete {
            target: "m3".into(),
        },
    );
    assert_eq!(
        here(&mut fold),
        vec![empty.clone(), vec!["b".to_owned()], empty.clone()]
    );

    // No face beside a person's own message: their name is already there.
    fold.apply(("c", "c1"), "x3", receipt("m2"));
    assert_eq!(here(&mut fold)[1], vec!["b".to_owned()]);

    // This account's own mark is never a face.
    fold.apply(("a", "a1"), "x4", receipt("m2"));
    assert_eq!(here(&mut fold)[1], vec!["b".to_owned()]);

    // Someone who left, or was blocked, shows no face; the toggle hides all.
    fold.store
        .write(|tx| crate::members::set_members(tx, GROUP, &["a".into(), "c".into()]))
        .unwrap();
    assert_eq!(here(&mut fold)[1], empty);
    fold.store
        .write(|tx| crate::members::set_members(tx, GROUP, &["a".into(), "b".into(), "c".into()]))
        .unwrap();
    assert_eq!(here(&mut fold)[1], vec!["b".to_owned()]);
    fold.store
        .write(|tx| {
            tx.execute(
                "INSERT INTO blocks (account, blocked_at) VALUES ('b', 0)",
                [],
            )
        })
        .unwrap();
    assert_eq!(here(&mut fold)[1], empty);
    fold.store
        .write(|tx| tx.execute("DELETE FROM blocks", []))
        .unwrap();
    assert_eq!(here(&mut fold)[1], vec!["b".to_owned()]);
    fold.store
        .write(|tx| {
            tx.execute(
                "INSERT INTO settings (id, read_markers, typing) VALUES (1, 0, 1)",
                [],
            )
        })
        .unwrap();
    assert_eq!(here(&mut fold)[1], empty);
}
