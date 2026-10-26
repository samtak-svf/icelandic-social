use crate::common::{conversation, items, photo, shared, strings};
use crate::phone::Phone;
use crate::relay::Relay;
use spjall_client::{Content, Item};
use spjall_envelope::Body;

/// `received_at` of each item, oldest first.
fn received(items: &[Item]) -> Vec<Option<u64>> {
    items.iter().map(|i| i.received_at).collect()
}

#[test]
fn times_are_the_servers_and_never_go_back() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let conversation = conversation(&mut a1, &mut b1);

    relay.set_clock(5_000);
    a1.send(&conversation, "eitt");
    // Still being sent: no server time yet.
    assert_eq!(
        items(&mut a1, &conversation).last().unwrap().received_at,
        None
    );
    a1.sync();
    // The server's clock went back; the time does not.
    relay.set_clock(4_000);
    b1.send(&conversation, "tvö");
    b1.sync();
    relay.set_clock(9_000);
    a1.send(&conversation, "þrjú");
    a1.sync();
    // A card takes the time of its commit.
    let _c1 = Phone::new(&relay, "c", "c1");
    relay.set_clock(12_000);
    a1.client
        .add_accounts(&conversation, &strings(&["c"]))
        .unwrap();
    a1.sync();
    a1.deliver();
    b1.deliver();

    let times = vec![Some(5_000), Some(5_000), Some(9_000), Some(12_000)];
    let a = items(&mut a1, &conversation);
    assert_eq!(received(&a), times);
    assert!(matches!(a[3].content, Content::Members { .. }));
    let b = items(&mut b1, &conversation);
    assert_eq!(received(&b), times);
    // The sender's clock is kept beside it.
    assert!(b[..3].iter().all(|i| i.ts > 12_000));
}

#[test]
fn an_edit_keeps_the_time_of_what_it_edits() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let conversation = conversation(&mut a1, &mut b1);
    relay.set_clock(5_000);
    a1.send(&conversation, "fyrst");
    a1.sync();
    b1.deliver();
    let id = items(&mut b1, &conversation)
        .last()
        .unwrap()
        .envelope_id
        .clone()
        .unwrap();
    relay.set_clock(8_000);
    a1.client
        .send(
            &conversation,
            Body::Edit {
                target: id,
                text: "breytt".into(),
            },
        )
        .unwrap();
    a1.sync();
    b1.deliver();
    let last = items(&mut b1, &conversation).pop().unwrap();
    assert!(last.edited);
    assert_eq!(last.received_at, Some(5_000));
}

#[test]
fn a_server_without_times_leaves_them_unknown() {
    let relay = Relay::new();
    relay.without_stored_at();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let conversation = conversation(&mut a1, &mut b1);
    a1.send(&conversation, "halló");
    a1.sync();
    b1.deliver();
    assert!(
        items(&mut b1, &conversation)
            .iter()
            .all(|i| i.received_at.is_none())
    );
}

fn media_kind(item: &Item) -> (String, Option<String>) {
    match &item.content {
        Content::Media { mime, name, .. } => (mime.clone(), name.clone()),
        other => panic!("not media: {other:?}"),
    }
}

#[test]
fn shared_lists_photos_and_files_newest_first_without_what_was_deleted() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let conversation = conversation(&mut a1, &mut b1);
    let files = tempfile::tempdir().unwrap();
    let (path, _) = photo(&files);
    a1.send(&conversation, "texti");
    a1.client
        .send_media(
            &conversation,
            &path,
            "image/png",
            Some("fyrst".into()),
            None,
        )
        .unwrap();
    let gone = a1
        .client
        .send_media(&conversation, &path, "image/png", None, None)
        .unwrap();
    a1.client
        .send_media(
            &conversation,
            &path,
            "application/pdf",
            None,
            Some("skýrsla.pdf".into()),
        )
        .unwrap();
    a1.client
        .send(&conversation, Body::Delete { target: gone })
        .unwrap();
    a1.sync();
    b1.deliver();

    for phone in [&mut a1, &mut b1] {
        let all = shared(phone, &conversation, None, 10);
        assert_eq!(
            all.iter().map(media_kind).collect::<Vec<_>>(),
            vec![
                ("application/pdf".into(), Some("skýrsla.pdf".into())),
                ("image/png".into(), None),
            ]
        );
        assert!(all.windows(2).all(|w| w[0].seq > w[1].seq));
        // Paged by seq, as the timeline is.
        let first = shared(phone, &conversation, None, 1);
        assert_eq!(first.len(), 1);
        let rest = shared(phone, &conversation, first[0].seq, 10);
        assert_eq!(
            rest.iter().map(|i| i.seq).collect::<Vec<_>>(),
            vec![all[1].seq]
        );
    }
}

#[test]
fn shared_leaves_out_what_a_timer_ended_before_any_purge() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let conversation = conversation(&mut a1, &mut b1);
    let files = tempfile::tempdir().unwrap();
    let (path, _) = photo(&files);
    a1.client
        .send_media(&conversation, &path, "image/png", None, None)
        .unwrap();
    a1.client
        .send(&conversation, Body::Disappearing { seconds: Some(1) })
        .unwrap();
    a1.client
        .send_media(
            &conversation,
            &path,
            "image/png",
            Some("hverfur".into()),
            None,
        )
        .unwrap();
    a1.sync();
    b1.deliver();
    assert_eq!(shared(&mut b1, &conversation, None, 10).len(), 2);
    std::thread::sleep(std::time::Duration::from_millis(1100));
    // No expire() yet: the read leaves the row out by itself (0056).
    for phone in [&mut a1, &mut b1] {
        let left = shared(phone, &conversation, None, 10);
        assert_eq!(left.len(), 1);
        assert!(matches!(
            &left[0].content,
            Content::Media { caption: None, .. }
        ));
    }
}
