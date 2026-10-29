//! Decision 0113: a call that needs only the server (the profile, the
//! notifications) is not queued behind another request of the same client.

#[path = "support/app.rs"]
#[allow(dead_code)]
mod app;
#[path = "../../client/tests/support/relay.rs"]
#[allow(dead_code)]
mod relay;

use app::{phone, promptly};
use relay::Relay;
use spjall_core::client::HttpResponse;

#[test]
fn a_hosted_call_during_a_request_does_not_wait() {
    let relay = Relay::new();
    let a1 = phone(&relay, "a", "a1");

    let waiting = a1.app.hold_path("/v1/blocks");
    let slow = std::thread::spawn({
        let client = a1.client.clone();
        move || client.blocked()
    });
    waiting
        .recv_timeout(std::time::Duration::from_secs(5))
        .expect("the request was made");

    a1.app.canned.lock().unwrap().push_back(HttpResponse {
        status: 200,
        body: r#"{"notifications":[],"unread":0}"#.into(),
    });
    let notifications = promptly({
        let client = a1.client.clone();
        move || client.notifications(None, 20)
    });
    assert!(notifications.unwrap().notifications.is_empty());
    let me = promptly({
        let client = a1.client.clone();
        move || client.me()
    });
    assert_eq!(me.unwrap().devices.len(), 1);

    a1.app.release();
    slow.join().unwrap().unwrap();
}
