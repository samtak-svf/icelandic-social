//! Community invitations (0130) as the apps see them.

pub use spjall_client::api::{CommunityInvitation, InvitedBy, JoinRequest};

use crate::CoreError;
use crate::client::CoreClient;

/// An account asking to join a private community.
#[uniffi::remote(Record)]
pub struct JoinRequest {
    pub account_id: String,
    /// None for an account that never gave one.
    pub name: Option<String>,
    pub verified: bool,
    /// Unix milliseconds.
    pub requested_at: u64,
}

/// The moderator who invited an account.
#[uniffi::remote(Record)]
pub struct InvitedBy {
    pub account_id: String,
    /// None for an account that never gave one.
    pub name: Option<String>,
}

/// An invitation that waits for its answer.
#[uniffi::remote(Record)]
pub struct CommunityInvitation {
    /// The invited account.
    pub account_id: String,
    /// None for an account that never gave one.
    pub name: Option<String>,
    /// None for an invitation from before the server kept its inviter.
    pub invited_by: Option<InvitedBy>,
    /// Unix milliseconds.
    pub created_at: u64,
}

#[uniffi::export]
impl CoreClient {
    /// The invitations that wait, newest first; for a moderator of the
    /// community. `Refused` with 403 for anyone else.
    pub fn community_invitations(
        &self,
        community_id: String,
    ) -> Result<Vec<CommunityInvitation>, CoreError> {
        Ok(self.hosted.community_invitations(&community_id)?)
    }

    /// Takes an invitation back, and its notice with it. `Refused` with 404
    /// when none waits.
    pub fn withdraw_invitation(
        &self,
        community_id: String,
        account_id: String,
    ) -> Result<(), CoreError> {
        Ok(self
            .hosted
            .withdraw_invitation(&community_id, &account_id)?)
    }
}
