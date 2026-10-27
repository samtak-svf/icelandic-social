//! The frames the socket sends the core, as the server writes them. Anything
//! it does not know parses as `Other`, so a newer server never breaks an older
//! core.

use serde::Deserialize;

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub(crate) enum Incoming {
    Hello {},
    Notify {
        #[serde(rename = "conversationId")]
        conversation: String,
        seq: u64,
    },
    Typing {
        #[serde(rename = "conversationId")]
        conversation: String,
        ciphertext: String,
    },
    Ping {
        nonce: Option<String>,
    },
    /// This account's mute changed on one of its devices (0042).
    Mute {
        #[serde(rename = "conversationId")]
        conversation: String,
        muted: bool,
        until: Option<u64>,
    },
    /// The backlog the socket had waiting is delivered (0108).
    #[serde(rename = "caught-up")]
    CaughtUp {},
    #[serde(other)]
    Other,
}
