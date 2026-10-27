//! The events of one call, as the app gets them.

use spjall_client as core;

use crate::client::{GroupDevice, Message};

/// What changed, for the app to show.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Enum)]
pub enum Event {
    Message {
        message: Message,
    },
    Membership {
        conversation: String,
        added: Vec<String>,
        removed: Vec<String>,
    },
    Joined {
        conversation: String,
    },
    /// Devices new to the group; one of an account already in it is the
    /// "new device" card of 0006.
    Devices {
        conversation: String,
        joined: Vec<GroupDevice>,
    },
    Removed {
        conversation: String,
    },
    Stale {
        conversation: String,
    },
    Typing {
        conversation: String,
        active: bool,
    },
    /// Timeline items changed, by seq; `timeline()` gives them as they now
    /// are. Empty when only pending items changed.
    Timeline {
        conversation: String,
        changed: Vec<u64>,
    },
    /// Names or marks the server gave; `people()` has them.
    Profiles {
        accounts: Vec<String>,
    },
    /// Disappearing items were deleted, with their files, by seq.
    Expired {
        conversation: String,
        removed: Vec<u64>,
    },
    /// The server delivered everything that was waiting when the socket
    /// connected (0108).
    CaughtUp,
}

impl From<core::Event> for Event {
    fn from(event: core::Event) -> Self {
        use core::Event as E;
        match event {
            E::Message(message) => Self::Message {
                message: message.into(),
            },
            E::Membership {
                conversation,
                added,
                removed,
            } => Self::Membership {
                conversation,
                added,
                removed,
            },
            E::Joined { conversation } => Self::Joined { conversation },
            E::Devices {
                conversation,
                joined,
            } => Self::Devices {
                conversation,
                joined: joined
                    .into_iter()
                    .map(
                        |spjall_mls::group::Device { account, device }| GroupDevice {
                            account,
                            device,
                        },
                    )
                    .collect(),
            },
            E::Removed { conversation } => Self::Removed { conversation },
            E::Stale { conversation } => Self::Stale { conversation },
            E::Typing {
                conversation,
                active,
            } => Self::Typing {
                conversation,
                active,
            },
            E::Timeline {
                conversation,
                changed,
            } => Self::Timeline {
                conversation,
                changed,
            },
            E::Profiles { accounts } => Self::Profiles { accounts },
            E::Expired {
                conversation,
                removed,
            } => Self::Expired {
                conversation,
                removed,
            },
            E::CaughtUp => Self::CaughtUp,
        }
    }
}
