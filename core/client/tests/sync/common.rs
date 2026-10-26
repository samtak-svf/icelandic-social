use std::sync::Arc;

use crate::phone::Phone;
use crate::relay::Relay;
use spjall_client::api::ApiError;
use spjall_client::{ClientError, Content, Event, Item, NoticeKind};
use spjall_envelope::Body;
use tempfile::TempDir;

pub fn texts(events: &[Event]) -> Vec<String> {
    events
        .iter()
        .filter_map(|e| match e {
            Event::Message(m) => match &m.envelope.body {
                Body::Text { text, .. } => Some(text.clone()),
                _ => None,
            },
            _ => None,
        })
        .collect()
}

pub fn joined(events: &[Event]) -> Vec<String> {
    events
        .iter()
        .filter_map(|e| match e {
            Event::Joined { conversation } => Some(conversation.clone()),
            _ => None,
        })
        .collect()
}

pub fn membership(events: &[Event]) -> Vec<(Vec<String>, Vec<String>)> {
    events
        .iter()
        .filter_map(|e| match e {
            Event::Membership { added, removed, .. } => Some((added.clone(), removed.clone())),
            _ => None,
        })
        .collect()
}

/// `(account, device)` of each device a commit brought into the group.
pub fn devices(events: &[Event]) -> Vec<(String, String)> {
    events
        .iter()
        .filter_map(|e| match e {
            Event::Devices { joined, .. } => Some(joined),
            _ => None,
        })
        .flatten()
        .map(|d| (d.account.clone(), d.device.clone()))
        .collect()
}

/// The events of 0018, without the timeline and profile events of 0022.
pub fn classic(events: Vec<Event>) -> Vec<Event> {
    events
        .into_iter()
        .filter(|e| !matches!(e, Event::Timeline { .. } | Event::Profiles { .. }))
        .collect()
}

pub fn strings(items: &[&str]) -> Vec<String> {
    items.iter().map(|s| (*s).to_owned()).collect()
}

/// `a` makes a conversation with `b` and both are in it.
pub fn conversation(a: &mut Phone, b: &mut Phone) -> String {
    let conversation = a
        .client
        .create_conversation(&strings(&[&b.account]))
        .unwrap();
    assert_eq!(
        membership(&a.sync()),
        vec![(strings(&[&b.account]), Vec::new())]
    );
    assert_eq!(joined(&b.deliver()), vec![conversation.clone()]);
    conversation
}

/// `a1` and `a2` are in a conversation with `b1`, `a2` by external commit.
pub fn with_a_sibling(relay: &Arc<Relay>) -> (Phone, Phone, Phone, String) {
    let mut a1 = Phone::new(relay, "a", "a1");
    let mut b1 = Phone::new(relay, "b", "b1");
    let conversation = conversation(&mut a1, &mut b1);
    let mut a2 = Phone::new(relay, "a", "a2");
    a1.send(&conversation, "fyrir");
    a1.sync();
    assert_eq!(joined(&a2.deliver()), vec![conversation.clone()]);
    a1.deliver();
    b1.deliver();
    (a1, a2, b1, conversation)
}

pub fn items(phone: &mut Phone, conversation: &str) -> Vec<Item> {
    phone.client.timeline(conversation, None, 100).unwrap()
}

/// The text of each item, `None` for one that is not text.
pub fn shown(items: &[Item]) -> Vec<Option<String>> {
    items
        .iter()
        .map(|i| match &i.content {
            Content::Text { text, .. } => Some(text.clone()),
            _ => None,
        })
        .collect()
}

pub fn notices_of(shown: &[spjall_client::Notice]) -> Shown {
    shown
        .iter()
        .map(|n| {
            (
                n.conversation.clone(),
                n.sender.account.clone(),
                n.kind,
                n.text.clone(),
            )
        })
        .collect()
}

/// The files in a phone's media folder, sorted.
pub fn media_files(phone: &Phone) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(phone.dir.path().join("media")) else {
        return Vec::new();
    };
    let mut names: Vec<String> = entries
        .flatten()
        .filter(|e| e.path().is_file())
        .map(|e| e.file_name().into_string().unwrap())
        .collect();
    names.sort();
    names
}

pub fn media_gets(relay: &Relay, device: &str) -> usize {
    relay
        .requests(device)
        .iter()
        .filter(|r| r.path.contains("/media/") && r.method == spjall_client::api::Method::Get)
        .count()
}

/// A photo of some size that crosses a segment edge, written to a file.
pub fn photo(dir: &TempDir) -> (std::path::PathBuf, Vec<u8>) {
    let bytes: Vec<u8> = (0..70_000u32).map(|i| (i % 251) as u8).collect();
    let path = dir.path().join("mynd.png");
    std::fs::write(&path, &bytes).unwrap();
    (path, bytes)
}

pub fn urgency(relay: &Relay, device: &str) -> Vec<bool> {
    relay
        .sends(device)
        .iter()
        .map(|body| body["urgent"].as_bool().unwrap())
        .collect()
}

/// `(conversation, sender, kind, text)` of each notice shown.
pub type Shown = Vec<(String, String, NoticeKind, Option<String>)>;

pub fn notices(phone: &mut Phone) -> (Shown, Vec<String>) {
    let notices = phone.client.notices().unwrap();
    let shown = notices
        .shown
        .into_iter()
        .map(|n| (n.conversation, n.sender.account, n.kind, n.text))
        .collect();
    (shown, notices.cleared)
}

/// The newest message of a conversation as stored on `phone`.
pub fn newest(phone: &mut Phone, conversation: &str) -> spjall_client::Message {
    phone
        .client
        .history(conversation, None, 1)
        .unwrap()
        .pop()
        .unwrap()
}

/// `a` with `b` in one conversation and with `c` in another.
pub fn two_conversations(a: &mut Phone, b: &mut Phone, c: &mut Phone) -> (String, String) {
    (conversation(a, b), conversation(a, c))
}

/// The media of a conversation for its information screen (0055), newest first.
pub fn shared(phone: &mut Phone, conversation: &str, before: Option<u64>, limit: u32) -> Vec<Item> {
    phone.client.shared(conversation, before, limit).unwrap()
}

/// The texts of a conversation's timeline, cards left out.
pub fn timeline_texts(phone: &mut Phone, conversation: &str) -> Vec<String> {
    items(phone, conversation)
        .into_iter()
        .filter_map(|item| match item.content {
            Content::Text { text, .. } => Some(text),
            _ => None,
        })
        .collect()
}

/// `a1` talks with `b1` and sends a photo; `a2` is linked after.
pub fn a_history(relay: &Arc<Relay>) -> (Phone, Phone, Phone, String, Vec<u8>) {
    let mut a1 = Phone::new(relay, "a", "a1");
    let mut b1 = Phone::new(relay, "b", "b1");
    let conversation = conversation(&mut a1, &mut b1);
    a1.send(&conversation, "fyrir");
    a1.sync();
    b1.deliver();
    b1.send(&conversation, "svar");
    b1.sync();
    a1.deliver();
    let files = tempfile::tempdir().unwrap();
    let (path, bytes) = photo(&files);
    a1.client
        .send_media(&conversation, &path, "image/png", None, None)
        .unwrap();
    a1.sync();
    b1.deliver();
    let a2 = Phone::new(relay, "a", "a2");
    (a1, b1, a2, conversation, bytes)
}

/// Whether the server refused the call with `status`.
pub fn refused(error: Option<ClientError>, status: u16) -> bool {
    matches!(error, Some(ClientError::Transport(ApiError::Refused { status: s, .. })) if s == status)
}

/// A device's working files for a history, none of which may outlast a call.
pub fn history_files(phone: &Phone) -> Vec<std::path::PathBuf> {
    let media = phone.dir.path().join("media");
    ["out/history", "out/history.part", "in/history"]
        .iter()
        .map(|p| media.join(p))
        .filter(|p| p.exists())
        .collect()
}

/// `a`, `b` and `c` in one conversation, made by `a`.
pub fn group(relay: &Arc<Relay>) -> (Phone, Phone, Phone, String) {
    let mut a1 = Phone::new(relay, "a", "a1");
    let mut b1 = Phone::new(relay, "b", "b1");
    let mut c1 = Phone::new(relay, "c", "c1");
    let conversation = conversation(&mut a1, &mut b1);
    a1.client
        .add_accounts(&conversation, &strings(&["c"]))
        .unwrap();
    a1.sync();
    b1.deliver();
    assert_eq!(joined(&c1.deliver()), vec![conversation.clone()]);
    (a1, b1, c1, conversation)
}
