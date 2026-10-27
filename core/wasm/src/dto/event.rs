//! The events of one call, as the page gets them.

use serde::Serialize;
use spjall_client as core;

use super::{GroupDevice, Message};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Event {
    Message {
        message: Box<Message>,
    },
    Membership {
        conversation: String,
        added: Vec<String>,
        removed: Vec<String>,
    },
    Joined {
        conversation: String,
    },
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
    Timeline {
        conversation: String,
        changed: Vec<u64>,
    },
    Profiles {
        accounts: Vec<String>,
    },
    Expired {
        conversation: String,
        removed: Vec<u64>,
    },
    CaughtUp,
}

impl From<core::Event> for Event {
    fn from(event: core::Event) -> Self {
        use core::Event as E;
        match event {
            E::Message(message) => Self::Message {
                message: Box::new(message.into()),
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
