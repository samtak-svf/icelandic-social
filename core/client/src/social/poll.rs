//! The poll rule (0090): what the server refuses, refused before it is sent.

use crate::ClientError;

/// The bounds of a poll's options (0090), as the server holds them. Its schema
/// counts code points, which is what `chars()` counts.
const POLL_OPTIONS: std::ops::RangeInclusive<usize> = 2..=6;
const POLL_OPTION_CHARS: usize = 80;

/// `text` as the server trims it. JavaScript counts U+FEFF as white space and
/// U+0085 as not, the reverse of Rust.
pub(super) fn server_trim(text: &str) -> &str {
    text.trim_matches(|c: char| (c.is_whitespace() && c != '\u{85}') || c == '\u{FEFF}')
}

/// Whether the server would take this poll, for an app's form to ask before it
/// offers to send it (api/poll.vectors.json).
#[must_use]
pub fn poll_draft_valid(question: &str, options: &[String]) -> bool {
    check_poll(question, &[], options).is_ok()
}

/// A poll is refused before it is sent when the server would refuse it.
pub(super) fn check_poll(
    body: &str,
    media: &[String],
    options: &[String],
) -> Result<(), ClientError> {
    if server_trim(body).is_empty() {
        return Err(ClientError::Invalid("a poll needs a question"));
    }
    if !media.is_empty() {
        return Err(ClientError::Invalid("a poll takes no image"));
    }
    if !POLL_OPTIONS.contains(&options.len()) {
        return Err(ClientError::Invalid("a poll has two to six options"));
    }
    let mut seen = Vec::with_capacity(options.len());
    for option in options {
        let option = server_trim(option);
        if option.is_empty() || option.chars().count() > POLL_OPTION_CHARS {
            return Err(ClientError::Invalid("an option of 1 to 80 characters"));
        }
        let folded = option.to_lowercase();
        if seen.contains(&folded) {
            return Err(ClientError::Invalid("a poll's options differ"));
        }
        seen.push(folded);
    }
    Ok(())
}
