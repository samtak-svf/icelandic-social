use crate::common::{a_history, history_files, items, refused, timeline_texts};
use crate::phone::Phone;
use crate::relay::Relay;
use spjall_client::{ClientError, LinkCode, LinkError, history_key};

/// A browser of account `a` asks to be linked as `lnk_1` with `device`'s
/// key and `history`, and shows this code (0077).
fn link_code(relay: &Relay, device: &mut Phone, history: &[u8]) -> String {
    let device_key = device.client.device_key().unwrap();
    let in_ten_minutes = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
        + 600_000;
    relay.request_link("a", "lnk_1", &device_key, history, in_ten_minutes);
    LinkCode {
        link_id: "lnk_1".into(),
        device_key,
        history_key: history.to_vec(),
    }
    .to_string()
}

#[test]
fn a_phone_approves_a_link_code_and_sends_its_whole_history() {
    let relay = Relay::new();
    let (mut a1, _b1, mut a2, conversation, bytes) = a_history(&relay);
    let key = history_key().unwrap();
    let code = link_code(&relay, &mut a2, &key.public);

    let request = a1.client.inspect_link(&code).unwrap();
    assert_eq!(request.browser.as_deref(), Some("Firefox"));
    assert_eq!(request.os.as_deref(), Some("Linux"));
    assert!(!request.approved);

    let size = a1.client.approve_link(&code, None, true).unwrap();
    assert!(size > 0);
    assert_eq!(relay.link_approver("lnk_1").as_deref(), Some("a1"));
    let imported = a2.client.receive_history("lnk_1", &key.private).unwrap();
    assert_eq!((imported.conversations, imported.files), (1, 1));
    assert_eq!(timeline_texts(&mut a2, &conversation), ["fyrir", "svar"]);
    let photo = items(&mut a2, &conversation).pop().unwrap();
    let file = a2.client.media(&conversation, photo.seq.unwrap()).unwrap();
    assert_eq!(std::fs::read(file).unwrap(), bytes);

    // Once per link.
    assert!(a1.client.inspect_link(&code).unwrap().approved);
    assert!(matches!(
        a1.client.approve_link(&code, None, true),
        Err(ClientError::Link(LinkError::AlreadyApproved))
    ));
}

#[test]
fn a_phone_approves_a_link_code_with_only_the_slice_it_chose() {
    let relay = Relay::new();
    let (mut a1, _b1, mut a2, conversation, _) = a_history(&relay);
    let key = history_key().unwrap();
    let code = link_code(&relay, &mut a2, &key.public);
    let tomorrow = items(&mut a1, &conversation).pop().unwrap().ts + 86_400_000;

    a1.client.approve_link(&code, Some(tomorrow), true).unwrap();
    let imported = a2.client.receive_history("lnk_1", &key.private).unwrap();
    assert_eq!((imported.conversations, imported.items), (1, 0));
    assert!(items(&mut a2, &conversation).is_empty());
}

#[test]
fn a_phone_approves_a_link_code_and_sends_nothing() {
    let relay = Relay::new();
    let (mut a1, _b1, mut a2, _conversation, _) = a_history(&relay);
    let key = history_key().unwrap();
    let code = link_code(&relay, &mut a2, &key.public);

    assert_eq!(a1.client.approve_link(&code, None, false).unwrap(), 0);
    assert_eq!(relay.link_approver("lnk_1").as_deref(), Some("a1"));
    assert!(!relay.holds_history("lnk_1"));
    assert!(
        !relay
            .requests("a1")
            .iter()
            .any(|r| r.path.contains("/history"))
    );
    assert!(refused(
        a2.client.receive_history("lnk_1", &key.private).err(),
        404
    ));
    assert!(history_files(&a1).is_empty());
}

#[test]
fn a_phone_refuses_a_link_request_whose_keys_are_not_the_codes() {
    let relay = Relay::new();
    let (mut a1, _b1, mut a2, _conversation, _) = a_history(&relay);
    let key = history_key().unwrap();
    let code = link_code(&relay, &mut a2, &key.public);
    // The server swaps in a history key of its own.
    let other = history_key().unwrap();
    let parsed = LinkCode::parse(&code).unwrap();
    relay.request_link(
        "a",
        "lnk_1",
        &parsed.device_key,
        &other.public,
        4_000_000_000_000,
    );

    for error in [
        a1.client.inspect_link(&code).err(),
        a1.client.approve_link(&code, None, true).err(),
    ] {
        assert!(matches!(
            error,
            Some(ClientError::Link(LinkError::KeyMismatch))
        ));
    }
    assert_eq!(relay.link_approver("lnk_1"), None);
    assert!(!relay.holds_history("lnk_1"));
}

#[test]
fn only_a_phone_approves_a_live_link_code() {
    let relay = Relay::new();
    let (mut a1, _b1, mut a2, _conversation, _) = a_history(&relay);
    let key = history_key().unwrap();
    let code = link_code(&relay, &mut a2, &key.public);

    // Not a code.
    for text in ["", "SPJL2.lnk_1.a.b", "https://spjall.samtak.is/l/x"] {
        assert!(matches!(
            a1.client.inspect_link(text),
            Err(ClientError::Link(LinkError::InvalidCode))
        ));
    }
    // A browser cannot approve.
    relay.make_browser("a1");
    assert!(refused(
        a1.client.approve_link(&code, None, true).err(),
        403
    ));
    assert_eq!(relay.link_approver("lnk_1"), None);
    // Expired: no longer pending.
    relay.set_clock(u64::MAX - 1);
    let parsed = LinkCode::parse(&code).unwrap();
    relay.request_link("a", "lnk_1", &parsed.device_key, &key.public, 1);
    assert!(matches!(
        a2.client.inspect_link(&code),
        Err(ClientError::Link(LinkError::Gone))
    ));
}
