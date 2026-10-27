use crate::common::{
    a_history, conversation, history_files, items, joined, media_files, media_gets, refused,
    strings, texts, timeline_texts,
};
use crate::phone::{KEY, Phone};
use crate::relay::Relay;
use spjall_client::api::ApiError;
use spjall_client::{ClientError, HistoryError, Imported, State, history_key};

#[test]
fn a_linked_device_starts_with_its_siblings_history() {
    let relay = Relay::new();
    let (mut a1, mut b1, mut a2, conversation, bytes) = a_history(&relay);
    let key = history_key().unwrap();
    let blob = a1.dir.path().join("history");
    a1.client.export_history(None, &key.public, &blob).unwrap();
    // The blob holds neither a text nor the photo in the clear.
    let sealed = std::fs::read(&blob).unwrap();
    assert_eq!(&sealed[..4], b"SPJH");
    assert!(!sealed.windows(5).any(|w| w == b"fyrir"));
    assert!(!sealed.windows(64).any(|w| w == &bytes[..64]));

    let imported = a2.client.import_history(&blob, &key.private).unwrap();
    assert_eq!((imported.conversations, imported.files), (1, 1));
    assert!(imported.items >= 3);
    assert_eq!(timeline_texts(&mut a2, &conversation), ["fyrir", "svar"]);
    let photo = items(&mut a2, &conversation).pop().unwrap();
    let file = a2.client.media(&conversation, photo.seq.unwrap()).unwrap();
    assert_eq!(std::fs::read(file).unwrap(), bytes);
    assert_eq!(media_gets(&relay, "a2"), 0);
    // Old messages raise no notices.
    assert!(a2.client.notices().unwrap().shown.is_empty());

    // Imported again: nothing new.
    assert_eq!(
        a2.client.import_history(&blob, &key.private).unwrap(),
        Imported::default()
    );

    // It joins the group, and the history goes on from there.
    assert_eq!(joined(&a2.sync()), vec![conversation.clone()]);
    b1.deliver();
    b1.send(&conversation, "velkomin");
    b1.sync();
    assert_eq!(texts(&a2.deliver()), strings(&["velkomin"]));
    assert_eq!(
        timeline_texts(&mut a2, &conversation),
        ["fyrir", "svar", "velkomin"]
    );
}

#[test]
fn a_history_travels_through_the_server_in_parts() {
    let relay = Relay::new();
    let (mut a1, _b1, mut a2, conversation, bytes) = a_history(&relay);
    relay.approve_link("lnk_1", "a1", "a2");
    // Small parts, so this history spans several and ends on a short one.
    relay.set_history_part(64 * 1024);
    let key = history_key().unwrap();

    let size = a1.client.send_history("lnk_1", None, &key.public).unwrap();
    let stored = relay.history("lnk_1").unwrap();
    assert_eq!(stored.len() as u64, size);
    assert_eq!(&stored[..4], b"SPJH");
    assert!(!stored.windows(5).any(|w| w == b"fyrir"));
    let parts = relay
        .requests("a1")
        .iter()
        .filter(|r| r.path.contains("/history/parts/"))
        .count() as u64;
    assert_eq!(parts, size.div_ceil(64 * 1024));
    assert!(parts > 1 && size % (64 * 1024) != 0);
    assert!(history_files(&a1).is_empty());

    let imported = a2.client.receive_history("lnk_1", &key.private).unwrap();
    assert_eq!((imported.conversations, imported.files), (1, 1));
    assert_eq!(timeline_texts(&mut a2, &conversation), ["fyrir", "svar"]);
    let photo = items(&mut a2, &conversation).pop().unwrap();
    let file = a2.client.media(&conversation, photo.seq.unwrap()).unwrap();
    assert_eq!(std::fs::read(file).unwrap(), bytes);
    // Deleted from the server once it is in the store.
    assert!(!relay.holds_history("lnk_1"));
    assert!(history_files(&a2).is_empty());
}

#[test]
fn a_history_goes_only_from_the_approver_to_the_linked_device() {
    let relay = Relay::new();
    let (mut a1, mut b1, mut a2, _conversation, _) = a_history(&relay);
    relay.approve_link("lnk_1", "a1", "a2");
    let key = history_key().unwrap();

    // Not the phone that approved it.
    assert!(refused(
        b1.client.send_history("lnk_1", None, &key.public).err(),
        403
    ));
    assert!(history_files(&b1).is_empty());
    // Nothing to receive yet.
    assert!(refused(
        a2.client.receive_history("lnk_1", &key.private).err(),
        404
    ));

    a1.client.send_history("lnk_1", None, &key.public).unwrap();
    // Once per link.
    assert!(refused(
        a1.client.send_history("lnk_1", None, &key.public).err(),
        409
    ));
    // Only the device the link made downloads it.
    assert!(refused(
        b1.client.receive_history("lnk_1", &key.private).err(),
        403
    ));

    // A history that does not open stays on the server, and the right key
    // still opens it.
    let other = history_key().unwrap();
    assert!(matches!(
        a2.client.receive_history("lnk_1", &other.private),
        Err(ClientError::History(HistoryError::Tampered))
    ));
    assert!(relay.history("lnk_1").is_some());
    assert!(history_files(&a2).is_empty());
    assert_eq!(
        a2.client
            .receive_history("lnk_1", &key.private)
            .unwrap()
            .conversations,
        1
    );
    assert!(!relay.holds_history("lnk_1"));
}

#[test]
fn a_history_upload_that_breaks_leaves_nothing_on_the_phone() {
    let relay = Relay::new();
    let (mut a1, _b1, _a2, _conversation, _) = a_history(&relay);
    relay.approve_link("lnk_1", "a1", "a2");
    relay.set_history_part(64 * 1024);
    let key = history_key().unwrap();
    relay.lose_history_part(2);
    assert!(matches!(
        a1.client.send_history("lnk_1", None, &key.public),
        Err(ClientError::Transport(ApiError::Unreachable(_)))
    ));
    assert!(history_files(&a1).is_empty());
    assert!(relay.history("lnk_1").is_none());
}

#[test]
fn a_history_opens_only_whole_and_only_with_its_key() {
    let relay = Relay::new();
    let (mut a1, _b1, mut a2, _conversation, _) = a_history(&relay);
    let key = history_key().unwrap();
    let blob = a1.dir.path().join("history");
    a1.client.export_history(None, &key.public, &blob).unwrap();
    let sealed = std::fs::read(&blob).unwrap();
    let other = history_key().unwrap();
    let broken = a2.dir.path().join("broken");
    let tampered = |result: Result<Imported, ClientError>| {
        matches!(result, Err(ClientError::History(HistoryError::Tampered)))
    };

    assert!(tampered(a2.client.import_history(&blob, &other.private)));
    for bytes in [
        sealed[..sealed.len() - 1].to_vec(),
        sealed[..sealed.len() - 64 * 1024].to_vec(),
        {
            let mut flipped = sealed.clone();
            flipped[100] ^= 1;
            flipped
        },
        {
            let mut grown = sealed.clone();
            grown.push(0);
            grown
        },
    ] {
        std::fs::write(&broken, bytes).unwrap();
        assert!(tampered(a2.client.import_history(&broken, &key.private)));
    }
    // Nothing of it was written.
    assert!(a2.client.conversations().unwrap().is_empty());
    assert!(media_files(&a2).is_empty());
}

#[test]
fn a_history_since_a_time_leaves_older_messages_out() {
    let relay = Relay::new();
    let (mut a1, _b1, mut a2, conversation, _) = a_history(&relay);
    let key = history_key().unwrap();
    let blob = a1.dir.path().join("history");
    let tomorrow = items(&mut a1, &conversation).pop().unwrap().ts + 86_400_000;
    a1.client
        .export_history(Some(tomorrow), &key.public, &blob)
        .unwrap();
    let imported = a2.client.import_history(&blob, &key.private).unwrap();
    assert_eq!((imported.conversations, imported.items), (1, 0));
    assert!(items(&mut a2, &conversation).is_empty());
}

#[test]
fn an_imported_conversation_survives_a_refused_join_and_a_removal_stays() {
    let relay = Relay::new();
    let (mut a1, mut b1, mut a2, talk, _) = a_history(&relay);
    let mut c1 = Phone::new(&relay, "c", "c1");
    let gone = conversation(&mut a1, &mut c1);
    // As a commit removing this account leaves it.
    let group = spjall_client::api::group_id(&gone).unwrap();
    let mut store = spjall_store::Store::open(a1.dir.path(), &KEY).unwrap();
    store
        .write(|tx| {
            tx.execute(
                "UPDATE conversations SET state = 'removed' WHERE group_id = ?1",
                [&group],
            )
        })
        .unwrap();
    drop(store);
    let key = history_key().unwrap();
    let blob = a1.dir.path().join("history");
    a1.client.export_history(None, &key.public, &blob).unwrap();
    a2.client.import_history(&blob, &key.private).unwrap();

    relay.refuse_sends("a2", 1);
    a2.sync();
    let state = |a2: &mut Phone, id: &str| {
        a2.client
            .conversations()
            .unwrap()
            .into_iter()
            .find(|c| c.id == id)
            .map(|c| c.state)
    };
    assert_eq!(state(&mut a2, &talk), Some(State::Stale));
    assert_eq!(timeline_texts(&mut a2, &talk), ["fyrir", "svar"]);
    assert_eq!(state(&mut a2, &gone), Some(State::Removed));

    let mut store = spjall_store::Store::open(a2.dir.path(), &KEY).unwrap();
    store
        .write(|tx| {
            tx.execute(
                "UPDATE conversations SET join_refused_at = join_refused_at - 3600000",
                [],
            )
        })
        .unwrap();
    drop(store);
    assert_eq!(joined(&a2.sync()), vec![talk.clone()]);
    b1.deliver();
    b1.send(&talk, "aftur");
    b1.sync();
    assert_eq!(texts(&a2.deliver()), strings(&["aftur"]));
}

/// A group's name and photo are folded state, not timeline rows: the cards
/// only say they changed (#327). A linked device has both from the
/// history, before any other device is online to send it the settings
/// snapshot.
#[test]
fn a_linked_device_has_its_groups_name_and_photo_from_the_history() {
    let relay = Relay::new();
    let (mut a1, mut b1, mut c1, talk) = crate::common::group(&relay);
    a1.client.rename(&talk, Some("Hópurinn".into())).unwrap();
    let picture = a1.dir.path().join("picture.png");
    image::RgbImage::from_fn(240, 160, |x, _| image::Rgb([90, (x % 256) as u8, 40]))
        .save(&picture)
        .unwrap();
    a1.client.set_group_photo(&talk, &picture).unwrap();
    a1.sync();
    b1.deliver();
    c1.deliver();
    let shown = |phone: &mut Phone| {
        let listed = phone.client.conversations().unwrap().remove(0);
        (listed.name, listed.photo.map(|p| std::fs::read(p).unwrap()))
    };
    let (name, photo) = shown(&mut a1);
    assert_eq!(name.as_deref(), Some("Hópurinn"));
    let photo = photo.expect("the phone shows the photo");

    let mut a2 = Phone::new(&relay, "a", "a2");
    let key = history_key().unwrap();
    let blob = a1.dir.path().join("history");
    a1.client.export_history(None, &key.public, &blob).unwrap();
    a2.client.import_history(&blob, &key.private).unwrap();
    assert_eq!(shown(&mut a2).0.as_deref(), Some("Hópurinn"));

    // The photo is fetched by the next sync, with no other device online.
    assert_eq!(joined(&a2.sync()), vec![talk.clone()]);
    assert_eq!(shown(&mut a2), (Some("Hópurinn".into()), Some(photo)));
}
