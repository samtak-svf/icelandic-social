//! Errors as the page sees them: `{ code, message }`, the code stable and the
//! message a fixed sentence or a code, never a Debug string and never SQLite's
//! own text, which can quote SQL and the values in it (0049).
use serde::Serialize;
use spjall_client::api::{ApiError, Unreachable};
use spjall_client::{ClientError, HistoryError, LinkError, MediaError};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Failure {
    pub code: &'static str,
    pub message: String,
}

impl Failure {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    /// The call came before `open`, or after `wipe`.
    pub fn closed() -> Self {
        Self::new("closed", "the core is not open")
    }

    /// The store or its pool failed to open or to wipe.
    pub fn storage(what: &'static str) -> Self {
        Self::new("storage", what)
    }
}

impl From<&ClientError> for Failure {
    fn from(error: &ClientError) -> Self {
        match error {
            ClientError::Store(_) => Self::new("store", "the store failed"),
            ClientError::Mls(_) => Self::new("mls", "an MLS step failed"),
            ClientError::Transport(ApiError::Unreachable(Unreachable(detail))) => {
                Self::new("unreachable", detail.clone())
            }
            ClientError::Transport(ApiError::Refused { code, .. }) => {
                Self::new("refused", code.clone())
            }
            ClientError::Transport(ApiError::ClientTooOld { min, .. }) => {
                Self::new("client-too-old", min.clone())
            }
            ClientError::Transport(ApiError::Malformed(what)) => {
                Self::new("protocol", format!("malformed answer to {what}"))
            }
            ClientError::Envelope(_) => Self::new("envelope", "the envelope could not be read"),
            ClientError::NotRegistered => Self::new("not-registered", error.to_string()),
            ClientError::SignIn(detail) => Self::new("sign-in", detail.clone()),
            ClientError::UnknownConversation => {
                Self::new("unknown-conversation", error.to_string())
            }
            ClientError::Invalid(detail) => Self::new("invalid", *detail),
            ClientError::Protocol(detail) => Self::new("protocol", *detail),
            ClientError::Media(MediaError::TooLarge)
            | ClientError::History(HistoryError::TooLarge) => {
                Self::new("too-large", error.to_string())
            }
            ClientError::Media(MediaError::Tampered)
            | ClientError::History(HistoryError::Tampered) => {
                Self::new("tampered", error.to_string())
            }
            ClientError::Media(MediaError::File(file))
            | ClientError::History(HistoryError::File(file)) => {
                Self::new("file", format!("{:?}", file.kind()))
            }
            ClientError::CannotForward(_) => Self::new("cannot-forward", "cannot be forwarded"),
            ClientError::Link(LinkError::InvalidCode) => {
                Self::new("link-code-invalid", error.to_string())
            }
            ClientError::Link(LinkError::KeyMismatch) => {
                Self::new("link-key-mismatch", error.to_string())
            }
            ClientError::Link(LinkError::Gone) => Self::new("link-expired", error.to_string()),
            ClientError::Link(LinkError::AlreadyApproved) => {
                Self::new("link-already-approved", error.to_string())
            }
            ClientError::Link(LinkError::NotApproved) => {
                Self::new("link-not-approved", error.to_string())
            }
            ClientError::NameInvalid => Self::new("name-invalid", error.to_string()),
            ClientError::NotAGroup => Self::new("not-a-group", error.to_string()),
            ClientError::GroupPhoto(_) => Self::new("unsupported-image", error.to_string()),
            ClientError::NoMaster => Self::new("no-master", error.to_string()),
        }
    }
}
