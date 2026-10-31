//! The app's own addresses (0121): what a link to a post or a community names.

use crate::is_id;

/// The web host's origin, as `hosts.web` in `identifiers/ids.json` names it; a test holds them equal.
const WEB_ORIGIN: &str = "https://spjall.samtak.is";

/// A screen of the app that a web address stands for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OwnLink {
    Post(String),
    Community(String),
}

/// The screen `link` opens in the app, or `None` for an ordinary web link.
///
/// Only the exact shape matches. A query, a fragment, a trailing slash or another segment may
/// mean something the screen would not honour, so those stay with the browser, and so does a
/// different port, scheme or user part, which is another site or a disguise for one.
pub fn own_link(link: &str) -> Option<OwnLink> {
    let path = link.strip_prefix(WEB_ORIGIN)?;
    if let Some(id) = path.strip_prefix("/posts/") {
        return is_id(id).then(|| OwnLink::Post(id.to_owned()));
    }
    let id = path.strip_prefix("/communities/")?;
    is_id(id).then(|| OwnLink::Community(id.to_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_origin_matches_ids_json() {
        let ids: serde_json::Value =
            serde_json::from_str(include_str!("../../../identifiers/ids.json")).unwrap();
        let origin = format!("https://{}", ids["hosts"]["web"].as_str().unwrap());
        assert_eq!(WEB_ORIGIN, origin);
    }

    #[test]
    fn a_post_and_a_community_are_found() {
        assert_eq!(
            own_link(&format!("{WEB_ORIGIN}/posts/p_a-1")),
            Some(OwnLink::Post("p_a-1".into()))
        );
        assert_eq!(
            own_link(&format!("{WEB_ORIGIN}/communities/c_a-1")),
            Some(OwnLink::Community("c_a-1".into()))
        );
    }

    #[test]
    fn everything_else_is_a_web_link() {
        for link in [
            // Another host, and hosts made to look like ours.
            "https://example.com/posts/p1".to_owned(),
            "https://spjall.samtak.is.example.com/posts/p1".to_owned(),
            "https://spjall.samtak.is@example.com/posts/p1".to_owned(),
            "https://spjall-samtak.is/posts/p1".to_owned(),
            "https://www.spjall.samtak.is/posts/p1".to_owned(),
            // The right host, reached another way.
            "http://spjall.samtak.is/posts/p1".to_owned(),
            "https://spjall.samtak.is:8443/posts/p1".to_owned(),
            // The right host, another shape.
            format!("{WEB_ORIGIN}/posts/p1/comments"),
            format!("{WEB_ORIGIN}/posts/p1/"),
            format!("{WEB_ORIGIN}/posts/p1?focus=true"),
            format!("{WEB_ORIGIN}/posts/p1#top"),
            format!("{WEB_ORIGIN}/posts/"),
            format!("{WEB_ORIGIN}/posts"),
            format!("{WEB_ORIGIN}/communities/c1/members"),
            format!("{WEB_ORIGIN}/communities/"),
            format!("{WEB_ORIGIN}/l/token"),
            format!("{WEB_ORIGIN}/"),
            WEB_ORIGIN.to_owned(),
            // An id that could escape a route.
            format!("{WEB_ORIGIN}/posts/..%2Fsettings"),
            format!("{WEB_ORIGIN}/posts/p%201"),
            format!("{WEB_ORIGIN}/posts/{}", "a".repeat(129)),
        ] {
            assert_eq!(own_link(&link), None, "{link}");
        }
    }
}
