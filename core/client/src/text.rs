//! How long a text is, and the limits every client shares with the server
//! (0123). The server's validator counts code points, so the core does too.

#[path = "generated/limits.rs"]
pub mod limits;

/// A text's length in code points, the only length a limit is held against.
#[must_use]
pub fn text_length(text: &str) -> usize {
    text.chars().count()
}

#[cfg(test)]
mod tests {
    use serde_json::Value;

    use super::text_length;

    #[test]
    fn counts_as_the_shared_vectors_say() {
        let vectors: Value =
            serde_json::from_str(include_str!("../../../api/text-length.vectors.json")).unwrap();
        let lengths = vectors["lengths"].as_array().unwrap();
        assert!(!lengths.is_empty());
        for case in lengths {
            assert_eq!(
                text_length(case["text"].as_str().unwrap()) as u64,
                case["codePoints"].as_u64().unwrap(),
                "{}",
                case["note"],
            );
        }
    }
}
