//! A real browser meets a phone through the Worker under `cf dev`: the
//! phone's halves of web/e2e/chat.spec.ts and web/e2e/group.spec.ts. Ignored
//! by `cargo test`; interop.yml runs them through those specs, which start
//! them with `SPJALL_BROWSER_DIR`, the directory the two sides meet in.

#![allow(clippy::disallowed_methods)] // tests use files

#[path = "support/worker.rs"]
mod worker;

use std::path::Path;
use std::time::{Duration, Instant, SystemTime};

use spjall_client::Event;
use spjall_client::api::DeviceKind;
use spjall_envelope::Body;
use worker::*;

/// Waits for a file the browser's side writes, and reads it.
fn awaited(path: &Path) -> String {
    let deadline = Instant::now() + Duration::from_secs(120);
    loop {
        if let Ok(text) = std::fs::read_to_string(path) {
            return text.trim().to_owned();
        }
        assert!(Instant::now() < deadline, "no {}", path.display());
        std::thread::sleep(Duration::from_millis(200));
    }
}

/// The phone's half of web/e2e/chat.spec.ts (0081): a real browser, running
/// the core in its worker, links from this phone's account and talks to a
/// second account. The two halves meet in `SPJALL_BROWSER_DIR`: the spec
/// writes `subject` (the Google subject it signed in as) and later `code`
/// (read off the link page); this side writes `ready` once the conversation
/// has a message, and returns once the browser's reply arrives. Without the
/// directory it does nothing, so the plain interop run passes over it.
#[test]
#[ignore = "driven by web/e2e/chat.spec.ts under `cf dev --mode interop`"]
fn a_phone_links_a_real_browser() {
    let Ok(dir) = std::env::var("SPJALL_BROWSER_DIR") else {
        return;
    };
    let dir = Path::new(&dir);
    let run = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let subject = awaited(&dir.join("subject"));
    let mut phone = Phone::signed_in(Person::Google(&subject), None);
    let mut other = Phone::signed_in(Person::Google(&format!("interop-{run}-other")), None);

    let conversation = phone
        .client
        .create_conversation(std::slice::from_ref(&other.account))
        .unwrap();
    phone.sync();
    other.deliver_until(has(Event::Joined {
        conversation: conversation.clone(),
    }));
    phone.send(&conversation, "halló vafri");
    phone.sync();
    other.deliver_until(count(1));
    std::fs::write(dir.join("ready"), &conversation).unwrap();

    // The browser shows its code; the phone approves it with its history.
    let code = awaited(&dir.join("code"));
    phone.client.approve_link(&code, None, true).unwrap();

    // The browser's reply reaches the other account, and the phone's own.
    assert_eq!(
        texts(&other.deliver_until(count(1))),
        strings(&["svar úr vafra"])
    );
    let me = phone.client.hosted().me().unwrap();
    assert!(me.devices.iter().any(|d| d.kind == DeviceKind::Web));
}

/// A new account named `name`, a member for the browser to find by it.
fn named(run: u64, tag: &str, name: &str) -> Phone {
    let hint = format!("interop-{run}-{tag}&x_name={}", name.replace(' ', "%20"));
    Phone::signed_in(Person::Google(&hint), None)
}

/// The phone's half of web/e2e/group.spec.ts (0078): the phone makes a group
/// of three and links the browser, which then adds a fourth person, removes
/// the third, names the group and leaves it. Each change is checked on the
/// side of a member who stays, or of the one added. Files in
/// `SPJALL_BROWSER_DIR`: `subject` and `code` (the spec), `ready`, `third`
/// and `fourth` (the names the spec picks, written here).
#[test]
#[ignore = "driven by web/e2e/group.spec.ts under `cf dev --mode interop`"]
fn a_browser_manages_a_group() {
    let Ok(dir) = std::env::var("SPJALL_BROWSER_DIR") else {
        return;
    };
    let dir = Path::new(&dir);
    let run = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let subject = awaited(&dir.join("subject"));
    let mut phone = Phone::signed_in(Person::Google(&subject), None);
    let third_name = format!("Thridji {run}");
    let fourth_name = format!("Fjordi {run}");
    let mut second = named(run, "second", &format!("Annar {run}"));
    let mut third = named(run, "third", &third_name);
    let mut fourth = named(run, "fourth", &fourth_name);

    let conversation = phone
        .client
        .create_conversation(&[second.account.clone(), third.account.clone()])
        .unwrap();
    phone.sync();
    let joined = Event::Joined {
        conversation: conversation.clone(),
    };
    second.deliver_until(has(joined.clone()));
    third.deliver_until(has(joined.clone()));
    phone.send(&conversation, "halló hópur");
    phone.sync();
    second.deliver_until(count(1));
    std::fs::write(dir.join("third"), &third_name).unwrap();
    std::fs::write(dir.join("fourth"), &fourth_name).unwrap();
    std::fs::write(dir.join("ready"), &conversation).unwrap();

    let code = awaited(&dir.join("code"));
    phone.client.approve_link(&code, None, true).unwrap();

    // Added: the new person is welcomed, and a member who stays is told.
    fourth.deliver_until(has(joined));
    let fourth_account = fourth.account.clone();
    second.deliver_until(|events| {
        events.iter().any(
            |e| matches!(e, Event::Membership { added, .. } if added.contains(&fourth_account)),
        )
    });
    // Removed: a member who stays sees the third go.
    let third_account = third.account.clone();
    second.deliver_until(|events| {
        events.iter().any(
            |e| matches!(e, Event::Membership { removed, .. } if removed.contains(&third_account)),
        )
    });
    // Named: the name arrives as an envelope.
    second.deliver_until(|events| {
        events.iter().any(|e| {
            matches!(e, Event::Message(m)
                if matches!(&m.envelope.body, Body::Name { name: Some(n) } if n == "Hópur vafra"))
        })
    });
    // Left: the browser's account goes, and the phone's device with it.
    let phone_account = phone.account.clone();
    second.deliver_until(|events| {
        events.iter().any(
            |e| matches!(e, Event::Membership { removed, .. } if removed.contains(&phone_account)),
        )
    });
}
