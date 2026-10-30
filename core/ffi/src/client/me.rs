//! `getMe` for the apps: this account, its devices and its standing.

use spjall_client::api::{self, DeviceKind, Platform};

#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct AccountDevice {
    pub device_id: String,
    pub platform: Platform,
    /// A phone unless it is a browser linked from a session (0064).
    pub kind: DeviceKind,
    /// Milliseconds since the epoch.
    pub created_at: u64,
    /// This device.
    pub current: bool,
}

/// This account: the registry's name when Kenni gave one, and its devices.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct Me {
    pub account_id: String,
    pub name: Option<String>,
    pub verified: bool,
    pub devices: Vec<AccountDevice>,
    /// The version of this account's photo (0039), for `photo`; none when
    /// it has none.
    #[uniffi(default = None)]
    pub photo: Option<String>,
    /// The suspension that stands now (0115), none when none does. What it
    /// refuses, the server refuses with the code `suspended`.
    #[uniffi(default = None)]
    pub suspension: Option<AccountSuspension>,
    /// Whether this account is a platform moderator (0115).
    #[uniffi(default = false)]
    pub platform_moderator: bool,
}

/// A suspension that stands (0115).
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Record)]
pub struct AccountSuspension {
    /// Unix milliseconds; none until a moderator lifts it.
    pub until: Option<u64>,
}

impl From<api::Me> for Me {
    fn from(me: api::Me) -> Self {
        let api::Me {
            account_id,
            name,
            verified,
            photo,
            devices,
            suspension,
            platform_moderator,
        } = me;

        Self {
            account_id,
            name,
            verified,
            photo,
            suspension: suspension
                .map(|api::AccountSuspension { until }| AccountSuspension { until }),
            platform_moderator,
            devices: devices
                .into_iter()
                .map(
                    |api::AccountDevice {
                         device_id,
                         platform,
                         kind,
                         created_at,
                         current,
                     }| AccountDevice {
                        device_id,
                        platform,
                        kind,
                        created_at,
                        current,
                    },
                )
                .collect(),
        }
    }
}
