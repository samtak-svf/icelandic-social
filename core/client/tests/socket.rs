//! The frames the socket sends the core, as the core turns them into events.

#![allow(clippy::disallowed_methods)] // tests use files

#[path = "support/hosted.rs"]
mod hosted;
#[path = "support/relay.rs"]
#[allow(dead_code)]
mod relay;

use hosted::Phone;
use spjall_client::Event;

#[test]
fn the_caught_up_frame_is_an_event_and_nothing_else() {
    let mut phone = Phone::signed_in();

    let outcome = phone.client.on_frame(r#"{"type":"caught-up"}"#).unwrap();

    assert_eq!(outcome.events, vec![Event::CaughtUp]);
    assert!(outcome.frames.is_empty());
}
