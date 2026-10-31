//! The app's own addresses (0121), for both apps.

use spjall_client as core;

/// A screen of the app that a web address stands for (0121).
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Enum)]
pub enum OwnLink {
    Post { id: String },
    Community { id: String },
}

/// The screen `link` opens in the app, or `None` for an ordinary web link.
#[uniffi::export]
pub fn own_link(link: String) -> Option<OwnLink> {
    core::own_link(&link).map(|found| match found {
        core::OwnLink::Post(id) => OwnLink::Post { id },
        core::OwnLink::Community(id) => OwnLink::Community { id },
    })
}
