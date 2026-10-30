//! `getMe`: who the account is, as the server answers it.

use serde::Deserialize;

use super::{DeviceKind, Platform};

/// `getMe`: this account and its devices.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Me {
    pub account_id: String,
    /// The registry name, if Kenni gave one.
    pub name: Option<String>,
    pub verified: bool,
    /// The version of this account's photo (0039), none when it has none.
    #[serde(default)]
    pub photo: Option<String>,
    pub devices: Vec<AccountDevice>,
    /// The suspension that stands now (0115); none from a server before it.
    #[serde(default)]
    pub suspension: Option<AccountSuspension>,
    /// Whether this account is a platform moderator (0115), so a client can
    /// lead to that work; false from a server before it. The server still
    /// decides each action.
    #[serde(default)]
    pub platform_moderator: bool,
}

/// A suspension that stands (0115): what the account may not write, it is
/// refused by the server, with the code `suspended`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountSuspension {
    /// Milliseconds since the epoch; none until a moderator lifts it.
    pub until: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountDevice {
    pub device_id: String,
    pub platform: Platform,
    /// A server older than 0064 names none: a phone.
    #[serde(default)]
    pub kind: DeviceKind,
    /// Milliseconds since the epoch.
    pub created_at: u64,
    /// The device that asked.
    pub current: bool,
}
