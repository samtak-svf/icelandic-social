//! What an id looks like.

/// An id the server gave: safe in a path, a route and a file name.
pub(crate) fn is_id(text: &str) -> bool {
    (1..=128).contains(&text.len())
        && text
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}
