//! The own-link parser as the apps call it (0121); the core's tests hold every other shape.

use spjall_core::own_link::{OwnLink, own_link};

#[test]
fn the_apps_get_a_post_a_community_or_nothing() {
    assert_eq!(
        own_link("https://spjall.samtak.is/posts/p1".into()),
        Some(OwnLink::Post { id: "p1".into() })
    );
    assert_eq!(
        own_link("https://spjall.samtak.is/communities/c1".into()),
        Some(OwnLink::Community { id: "c1".into() })
    );
    assert_eq!(own_link("https://example.com/posts/p1".into()), None);
}
