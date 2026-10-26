use crate::common::{conversation, items, media_files, media_gets, photo, shown, strings};
use crate::phone::Phone;
use crate::relay::Relay;
use spjall_client::{ClientError, Content, Event, MediaError};
use spjall_envelope::Body;

#[test]
fn a_photo_is_sealed_before_it_leaves_and_opens_on_the_other_side() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let conversation = conversation(&mut a1, &mut b1);
    let files = tempfile::tempdir().unwrap();
    let (path, bytes) = photo(&files);

    a1.client
        .send_media(
            &conversation,
            &path,
            "image/png",
            Some("sólarlag".into()),
            // A name is a name: a path in it is cut away on both sides (#68).
            Some("../../sólarlag.png".into()),
        )
        .unwrap();
    // The server holds a blob that is not the photo and does not contain it.
    let blobs = relay.media(&conversation);
    assert_eq!(blobs.len(), 1);
    assert_eq!(blobs[0].len(), bytes.len() + 2 * 16);
    assert!(!blobs[0].windows(64).any(|w| w == &bytes[..64]));
    a1.sync();
    b1.deliver();

    for phone in [&mut a1, &mut b1] {
        let item = items(phone, &conversation).pop().unwrap();
        assert_eq!(
            item.content,
            Content::Media {
                mime: "image/png".into(),
                size: bytes.len() as u64,
                caption: Some("sólarlag".into()),
                name: Some("sólarlag.png".into()),
            }
        );
        let file = phone
            .client
            .media(&conversation, item.seq.unwrap())
            .unwrap();
        assert_eq!(std::fs::read(&file).unwrap(), bytes);
        assert_eq!(file.extension().unwrap(), "png");
        // Kept: asked for again, it is not fetched again.
        assert_eq!(
            phone
                .client
                .media(&conversation, item.seq.unwrap())
                .unwrap(),
            file
        );
    }
    // The sender kept its own copy and fetched nothing; the other side once.
    assert_eq!(media_gets(&relay, "a1"), 0);
    assert_eq!(media_gets(&relay, "b1"), 1);
    // Nothing is left over from sealing or opening.
    assert_eq!(media_files(&a1).len(), 1);
    assert_eq!(media_files(&b1).len(), 1);
}

#[test]
fn a_tampered_blob_is_refused_and_leaves_no_file() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let conversation = conversation(&mut a1, &mut b1);
    let files = tempfile::tempdir().unwrap();
    let (path, _) = photo(&files);
    a1.client
        .send_media(&conversation, &path, "image/png", None, None)
        .unwrap();
    a1.sync();
    b1.deliver();

    relay.tamper_media();
    let seq = items(&mut b1, &conversation).pop().unwrap().seq.unwrap();
    assert!(matches!(
        b1.client.media(&conversation, seq),
        Err(ClientError::Media(MediaError::Tampered))
    ));
    assert!(media_files(&b1).is_empty());
    // An item that is not media has no file.
    b1.send(&conversation, "texti");
    b1.sync();
    let text = items(&mut b1, &conversation).pop().unwrap().seq.unwrap();
    assert!(matches!(
        b1.client.media(&conversation, text),
        Err(ClientError::Invalid(_))
    ));
}

#[test]
fn a_file_over_25_mb_is_refused_before_anything_is_sent() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let conversation = conversation(&mut a1, &mut b1);
    let files = tempfile::tempdir().unwrap();
    let path = files.path().join("stórt.bin");
    std::fs::File::create(&path)
        .unwrap()
        .set_len(spjall_client::MAX_SIZE + 1)
        .unwrap();
    assert!(matches!(
        a1.client
            .send_media(&conversation, &path, "application/zip", None, None),
        Err(ClientError::Media(MediaError::TooLarge))
    ));
    assert!(relay.media(&conversation).is_empty());
    assert!(media_files(&a1).is_empty());
}

#[test]
fn what_disappears_is_deleted_with_its_file() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let conversation = conversation(&mut a1, &mut b1);
    a1.send(&conversation, "stays");
    a1.client
        .send(&conversation, Body::Disappearing { seconds: Some(1) })
        .unwrap();
    a1.sync();
    b1.deliver();
    let files = tempfile::tempdir().unwrap();
    let (path, _) = photo(&files);
    a1.client
        .send_media(&conversation, &path, "image/png", None, None)
        .unwrap();
    a1.send(&conversation, "goes");
    a1.sync();
    b1.deliver();
    let seqs: Vec<u64> = items(&mut b1, &conversation)
        .iter()
        .rev()
        .take(2)
        .map(|i| i.seq.unwrap())
        .rev()
        .collect();
    b1.client.media(&conversation, seqs[0]).unwrap();
    assert_eq!(media_files(&b1).len(), 1);

    std::thread::sleep(std::time::Duration::from_millis(1100));
    for phone in [&mut a1, &mut b1] {
        let outcome = phone.client.expire().unwrap();
        assert_eq!(
            outcome.events,
            vec![Event::Expired {
                conversation: conversation.clone(),
                removed: seqs.clone(),
            }]
        );
        assert!(media_files(phone).is_empty());
        // The text sent before the timer and the timer card stay.
        let left = items(phone, &conversation);
        assert!(
            left.iter()
                .all(|i| i.seq.is_none_or(|s| !seqs.contains(&s)))
        );
        assert_eq!(
            shown(&left).into_iter().flatten().collect::<Vec<_>>(),
            strings(&["stays"])
        );
        assert_eq!(phone.client.expire().unwrap().events, Vec::new());
        assert_eq!(
            phone
                .client
                .history(&conversation, None, 100)
                .unwrap()
                .iter()
                .filter(|m| matches!(m.envelope.body, Body::Text { .. } | Body::Media { .. }))
                .count(),
            1
        );
    }
}
