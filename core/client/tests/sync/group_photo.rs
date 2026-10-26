use crate::common::{conversation, group, items, joined, strings};
use crate::phone::Phone;
use crate::relay::Relay;
use spjall_client::{ClientError, Content};
use spjall_envelope::Body;
use tempfile::TempDir;

/// A PNG, not square, as a phone's gallery might hand over, in a file.
fn picture(dir: &TempDir, shade: u8) -> std::path::PathBuf {
    let image = image::RgbImage::from_fn(240, 160, |x, _| image::Rgb([shade, (x % 256) as u8, 40]));
    let path = dir.path().join(format!("picture-{shade}.png"));
    image.save(&path).unwrap();
    path
}

fn photo_of(phone: &mut Phone) -> Option<std::path::PathBuf> {
    phone.client.conversations().unwrap()[0].photo.clone()
}

/// What a member holds of the group photo: a 512 px JPEG, which is not the
/// file that was chosen (0094).
fn assert_made_by_the_core(path: &std::path::Path) {
    let bytes = std::fs::read(path).unwrap();
    assert_eq!(
        image::guess_format(&bytes).unwrap(),
        image::ImageFormat::Jpeg
    );
    let decoded = image::load_from_memory(&bytes).unwrap();
    assert_eq!((decoded.width(), decoded.height()), (512, 512));
}

/// A group's photo is encrypted group state like its name (0094): a card on
/// every member, the picture on each device, and clearing it is a card too.
#[test]
fn a_group_photo_reaches_every_member_and_is_cleared_the_same_way() {
    let relay = Relay::new();
    let (mut a1, mut b1, mut c1, conversation) = group(&relay);
    assert_eq!(photo_of(&mut b1), None);

    let first = picture(&a1.dir, 10);
    a1.client.set_group_photo(&conversation, &first).unwrap();
    a1.sync();
    b1.deliver();
    c1.deliver();
    assert!(relay.has_group_photo(&conversation));
    let mut seen = Vec::new();
    for phone in [&mut a1, &mut b1, &mut c1] {
        let path = photo_of(phone).expect("the photo is shown");
        assert_made_by_the_core(&path);
        seen.push(std::fs::read(&path).unwrap());
        let items = items(phone, &conversation);
        let card = items.last().unwrap();
        assert_eq!(card.content, Content::Photo { set: true });
        assert_eq!(card.sender.account, "a");
    }
    assert!(
        seen.windows(2).all(|w| w[0] == w[1]),
        "one picture on all three"
    );

    // Another member replaces it: the server keeps one, the members the new.
    let second = picture(&b1.dir, 200);
    b1.client.set_group_photo(&conversation, &second).unwrap();
    b1.sync();
    a1.deliver();
    c1.deliver();
    for phone in [&mut a1, &mut b1, &mut c1] {
        let path = photo_of(phone).expect("the photo is shown");
        assert_ne!(std::fs::read(&path).unwrap(), seen[0]);
    }

    c1.client.clear_group_photo(&conversation).unwrap();
    c1.sync();
    a1.deliver();
    b1.deliver();
    assert!(!relay.has_group_photo(&conversation));
    for phone in [&mut a1, &mut b1, &mut c1] {
        assert_eq!(photo_of(phone), None);
        let items = items(phone, &conversation);
        assert_eq!(items.last().unwrap().content, Content::Photo { set: false });
    }
}

/// The web has no file path (0094): the bytes go in and come out, and what
/// the server holds is ciphertext, not the picture.
#[test]
fn a_group_photo_from_bytes_is_stored_sealed_and_read_back_as_bytes() {
    let relay = Relay::new();
    let (mut a1, mut b1, _c1, conversation) = group(&relay);
    assert_eq!(b1.client.group_photo_bytes(&conversation).unwrap(), None);

    let source = std::fs::read(picture(&a1.dir, 10)).unwrap();
    a1.client
        .set_group_photo_bytes(&conversation, &source)
        .unwrap();
    a1.sync();
    b1.deliver();

    let seen = b1
        .client
        .group_photo_bytes(&conversation)
        .unwrap()
        .expect("the member has the photo");
    assert_eq!(&seen[..2], &[0xFF, 0xD8], "a JPEG");
    assert_eq!(
        a1.client.group_photo_bytes(&conversation).unwrap(),
        Some(seen.clone())
    );
    let kept = std::fs::read(photo_of(&mut a1).unwrap()).unwrap();
    assert_eq!(kept, seen);

    // The server holds ciphertext (0023): not a JPEG, not the sender's copy.
    let stored = relay.group_photo_object(&conversation).expect("stored");
    assert!(!stored.starts_with(&[0xFF, 0xD8, 0xFF]));
    assert_ne!(stored, kept);

    // No source is left on the sender's device.
    let out = a1.dir.path().join("media").join("out");
    assert!(
        !out.exists() || std::fs::read_dir(&out).unwrap().next().is_none(),
        "nothing of the upload is left in out/"
    );

    a1.client.clear_group_photo(&conversation).unwrap();
    a1.sync();
    b1.deliver();
    assert_eq!(b1.client.group_photo_bytes(&conversation).unwrap(), None);
    assert_eq!(a1.client.group_photo_bytes(&conversation).unwrap(), None);

    assert!(matches!(
        a1.client
            .set_group_photo_bytes(&conversation, b"not an image"),
        Err(ClientError::GroupPhoto(_))
    ));
}

/// Two people are not a group (0094): the core will not set a photo, and
/// drops one that arrives.
#[test]
fn a_conversation_of_two_has_no_group_photo() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let one_to_one = conversation(&mut a1, &mut b1);
    let file = picture(&a1.dir, 10);
    assert!(matches!(
        a1.client.set_group_photo(&one_to_one, &file),
        Err(ClientError::NotAGroup)
    ));
    assert!(matches!(
        a1.client.clear_group_photo(&one_to_one),
        Err(ClientError::NotAGroup)
    ));
    assert!(!relay.has_group_photo(&one_to_one));

    // A peer that sends one anyway (the body is well formed) is not obeyed.
    let before = items(&mut b1, &one_to_one).len();
    a1.client
        .send(
            &one_to_one,
            Body::Photo {
                photo: Some(spjall_envelope::PhotoRef {
                    id: "A".repeat(22),
                    mime: "image/jpeg".into(),
                    size: 10,
                    key: "k".into(),
                    sha256: "0".into(),
                }),
            },
        )
        .unwrap();
    a1.sync();
    b1.deliver();
    assert_eq!(photo_of(&mut b1), None);
    assert_eq!(items(&mut b1, &one_to_one).len(), before);
}

/// An account added later, and a device that joins by external commit,
/// learn the photo from the snapshot the others send (0094).
#[test]
fn whoever_joins_later_learns_the_group_photo() {
    let relay = Relay::new();
    let (mut a1, mut b1, mut c1, conversation) = group(&relay);
    let file = picture(&a1.dir, 77);
    a1.client.set_group_photo(&conversation, &file).unwrap();
    a1.sync();
    b1.deliver();
    c1.deliver();

    let mut d1 = Phone::new(&relay, "d", "d1");
    a1.client
        .add_accounts(&conversation, &strings(&["d"]))
        .unwrap();
    a1.sync();
    assert_eq!(joined(&d1.deliver()), vec![conversation.clone()]);
    d1.deliver();
    assert_made_by_the_core(&photo_of(&mut d1).expect("the new member sees it"));

    let mut b2 = Phone::new(&relay, "b", "b2");
    a1.send(&conversation, "hæ");
    a1.sync();
    assert_eq!(joined(&b2.deliver()), vec![conversation.clone()]);
    for phone in [&mut a1, &mut b1, &mut c1, &mut d1] {
        phone.deliver();
    }
    b2.deliver();
    assert_made_by_the_core(&photo_of(&mut b2).expect("the new device sees it"));
}
