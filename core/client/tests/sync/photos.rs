use crate::phone::Phone;
use crate::relay::Relay;
use spjall_client::ClientError;
use spjall_client::api::ApiError;
use spjall_client::frames::{Focus, Frame, FrameRect, Framing};

/// How many times `device` fetched `account`'s photo.
fn photo_fetches(relay: &Relay, device: &str, account: &str) -> usize {
    let path = format!("/v1/accounts/{account}/photo");
    relay
        .requests(device)
        .iter()
        .filter(|r| r.path == path)
        .count()
}

#[test]
fn a_photo_is_fetched_once_per_version_and_goes_when_removed() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let image = a1.dir.path().join("picked.jpg");

    // Refused here before a request: nothing, or over 10 MB; and by the
    // server, what is not an image.
    std::fs::write(&image, b"").unwrap();
    assert!(matches!(
        a1.client.set_photo(&image),
        Err(ClientError::Invalid(_))
    ));
    std::fs::File::create(&image)
        .unwrap()
        .set_len(spjall_client::text::limits::IMAGE_BYTES + 1)
        .unwrap();
    assert!(matches!(
        a1.client.set_photo(&image),
        Err(ClientError::Invalid(_))
    ));
    assert!(
        !relay
            .requests("a1")
            .iter()
            .any(|r| r.path == "/v1/me/photo")
    );
    std::fs::write(&image, b"not one").unwrap();
    assert!(matches!(
        a1.client.set_photo(&image),
        Err(ClientError::Transport(ApiError::Refused {
            status: 400,
            ..
        }))
    ));

    std::fs::write(&image, b"image:first").unwrap();
    let first = a1.client.set_photo(&image).unwrap();
    assert_eq!(
        a1.client.hosted().me().unwrap().photo.as_deref(),
        Some(first.as_str())
    );
    assert_eq!(
        b1.client.profile("a").unwrap().photo.as_deref(),
        Some(first.as_str())
    );

    // Fetched once, then kept for as long as the version stands.
    let kept = b1.client.photo("a", &first).unwrap().unwrap();
    assert_eq!(std::fs::read(&kept).unwrap(), b"webp:image:first");
    assert_eq!(b1.client.photo("a", &first).unwrap(), Some(kept.clone()));
    b1.reopen();
    assert_eq!(b1.client.photo("a", &first).unwrap(), Some(kept.clone()));
    assert_eq!(photo_fetches(&relay, "b1", "a"), 1);

    // A new version is fetched in place of the old one.
    std::fs::write(&image, b"image:second").unwrap();
    let second = a1.client.set_photo(&image).unwrap();
    assert_ne!(second, first);
    assert_eq!(
        b1.client.profile("a").unwrap().photo.as_deref(),
        Some(second.as_str())
    );
    let newer = b1.client.photo("a", &second).unwrap().unwrap();
    assert_eq!(std::fs::read(&newer).unwrap(), b"webp:image:second");
    assert!(!kept.exists());
    assert_eq!(photo_fetches(&relay, "b1", "a"), 2);

    // Removed: the profile shows none, and the kept file goes.
    a1.client.remove_photo().unwrap();
    assert_eq!(a1.client.hosted().me().unwrap().photo, None);
    assert_eq!(b1.client.profile("a").unwrap().photo, None);
    assert!(!newer.exists());
    assert_eq!(b1.client.photo("a", &second).unwrap(), None);

    // Ids never name a path outside the media folder.
    assert!(matches!(
        b1.client.photo("../a", &second),
        Err(ClientError::Invalid(_))
    ));
    assert!(matches!(
        b1.client.photo("a", "../../x"),
        Err(ClientError::Invalid(_))
    ));
}

#[test]
fn a_photo_is_framed_again_from_its_master_and_the_old_frames_go() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let image = a1.dir.path().join("picked.jpg");
    std::fs::write(&image, b"image:first").unwrap();
    let first = a1.client.set_photo(&image).unwrap();

    // Nothing stored yet: the editor opens at the centre, with the master.
    assert_eq!(a1.client.photo_framing().unwrap(), None);
    let source = a1.dir.path().join("master.webp");
    assert!(a1.client.photo_source(&source).unwrap());
    assert_eq!(std::fs::read(&source).unwrap(), b"image:first");
    assert!(!source.with_extension("part").exists());

    // The square frame is fetched under its name and kept in a folder of its own.
    let square = a1
        .client
        .photo_framed("a", &first, Frame::Square)
        .unwrap()
        .unwrap();
    assert!(square.ends_with(format!("photos/a/square/{first}.webp")));
    assert_eq!(
        a1.client.photo_framed("a", &first, Frame::Square).unwrap(),
        Some(square.clone())
    );
    assert!(
        relay
            .requests("a1")
            .iter()
            .any(|r| r.path == "/v1/accounts/a/photo?frame=square")
    );
    // A cover frame is no frame of a photo, and asks nothing.
    let asked = relay.requests("a1").len();
    assert!(matches!(
        a1.client.photo_framed("a", &first, Frame::Compact),
        Err(ClientError::Invalid(_))
    ));
    assert_eq!(relay.requests("a1").len(), asked);
    let plain = a1.client.photo("a", &first).unwrap().unwrap();

    // Re-framing makes a new version and clears every kept file of the old.
    let mut framing = Framing::centred();
    framing.focus = Focus { x: 0.25, y: 0.75 };
    let second = a1.client.set_photo_framing(&framing).unwrap();
    assert_ne!(second, first);
    assert!(!square.exists() && !plain.exists());
    assert!(!a1.dir.path().join("photos/a/square").exists());
    assert_eq!(
        a1.client.hosted().me().unwrap().photo.as_deref(),
        Some(second.as_str())
    );
    assert_eq!(a1.client.photo_framing().unwrap(), Some(framing));
    let cut = a1
        .client
        .photo_framed("a", &second, Frame::Square)
        .unwrap()
        .unwrap();
    assert!(std::fs::read(&cut).unwrap().starts_with(b"webp:framed:"));

    // A framing the server would refuse never leaves the device.
    let mut wrong = Framing::centred();
    wrong.overrides.insert(
        Frame::Compact,
        FrameRect {
            x: 0.0,
            y: 0.0,
            w: 1.0,
            h: 1.0,
        },
    );
    let asked = relay.requests("a1").len();
    assert!(matches!(
        a1.client.set_photo_framing(&wrong),
        Err(ClientError::Invalid(_))
    ));
    assert_eq!(relay.requests("a1").len(), asked);
}

#[test]
fn a_photo_without_a_master_is_its_own_error() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let image = a1.dir.path().join("picked.jpg");
    std::fs::write(&image, b"image:old").unwrap();
    let old = a1.client.set_photo(&image).unwrap();
    relay.forget_master("a");

    assert!(matches!(
        a1.client.set_photo_framing(&Framing::centred()),
        Err(ClientError::NoMaster)
    ));
    // The photo is untouched, and there is no master to write.
    assert_eq!(
        a1.client.hosted().me().unwrap().photo.as_deref(),
        Some(old.as_str())
    );
    let source = a1.dir.path().join("master.webp");
    assert!(!a1.client.photo_source(&source).unwrap());
    assert!(!source.exists() && !source.with_extension("part").exists());
}

#[test]
fn a_block_withholds_the_photo_both_ways_and_the_kept_one_goes() {
    let relay = Relay::new();
    let mut a1 = Phone::new(&relay, "a", "a1");
    let mut b1 = Phone::new(&relay, "b", "b1");
    let mut c1 = Phone::new(&relay, "c", "c1");
    let image = a1.dir.path().join("picked.jpg");
    std::fs::write(&image, b"image:a").unwrap();
    let of_a = a1.client.set_photo(&image).unwrap();
    std::fs::write(&image, b"image:b").unwrap();
    let of_b = b1.client.set_photo(&image).unwrap();

    // Seen by every signed-in account: as a profile and in the list.
    let kept = b1.client.photo("a", &of_a).unwrap().unwrap();
    let listed = c1.client.directory(None, None, 20).unwrap().people;
    assert_eq!(listed[0].photo.as_deref(), Some(of_a.as_str()));
    assert_eq!(listed[1].photo.as_deref(), Some(of_b.as_str()));

    // b blocks a: neither sees the other's photo, the name stays, and the
    // photo b kept is gone.
    b1.client.block("a").unwrap();
    assert!(!kept.exists());
    let a_to_b = b1.client.profile("a").unwrap();
    assert_eq!(a_to_b.name.as_deref(), Some("Name of a"));
    assert_eq!(a_to_b.photo, None);
    assert_eq!(b1.client.photo("a", &of_a).unwrap(), None);
    assert_eq!(a1.client.profile("b").unwrap().photo, None);
    assert_eq!(a1.client.photo("b", &of_b).unwrap(), None);

    // c, outside the block, still sees both.
    assert!(c1.client.photo("a", &of_a).unwrap().is_some());
    assert!(c1.client.photo("b", &of_b).unwrap().is_some());

    // Unblocked, it shows again.
    b1.client.unblock("a").unwrap();
    assert_eq!(
        b1.client.profile("a").unwrap().photo.as_deref(),
        Some(of_a.as_str())
    );
    assert!(b1.client.photo("a", &of_a).unwrap().is_some());
}
