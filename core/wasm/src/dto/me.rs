//! `getMe` for the web: this account, its devices and its standing.

use serde::Serialize;
use spjall_client::api;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountDevice {
    pub device_id: String,
    pub platform: api::Platform,
    /// `phone` or `web`.
    pub kind: &'static str,
    pub created_at: u64,
    pub current: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Me {
    pub account_id: String,
    pub name: Option<String>,
    pub verified: bool,
    pub devices: Vec<AccountDevice>,
    pub photo: Option<String>,
    pub suspension: Option<AccountSuspension>,
    pub platform_moderator: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct AccountSuspension {
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
                        kind: match kind {
                            api::DeviceKind::Phone => "phone",
                            api::DeviceKind::Web => "web",
                        },
                        created_at,
                        current,
                    },
                )
                .collect(),
            photo,
            suspension: suspension
                .map(|api::AccountSuspension { until }| AccountSuspension { until }),
            platform_moderator,
        }
    }
}
