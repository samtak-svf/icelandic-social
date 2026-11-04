//! Community invitations (0130) as the server answers them: who invited the
//! caller, and the moderator's list of what still waits.

use serde::Deserialize;

use super::{Api, ApiError, Method, Transport};

/// An account asking to join a private community.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JoinRequest {
    pub account_id: String,
    pub name: Option<String>,
    pub verified: bool,
    /// Unix milliseconds.
    pub requested_at: u64,
}

/// The moderator who invited an account.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvitedBy {
    pub account_id: String,
    /// None for an account that never gave one.
    pub name: Option<String>,
}

/// An invitation that waits for its answer, as a moderator sees it.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommunityInvitation {
    /// The invited account.
    pub account_id: String,
    pub name: Option<String>,
    /// None for an invitation from before the server kept its inviter.
    pub invited_by: Option<InvitedBy>,
    /// Unix milliseconds.
    pub created_at: u64,
}

#[derive(Deserialize)]
struct Invitations {
    invitations: Vec<CommunityInvitation>,
}

impl<T: Transport> Api<'_, T> {
    /// `listCommunityInvitations`: newest first; 403 unless the caller
    /// moderates.
    pub fn community_invitations(
        &self,
        community: &str,
    ) -> Result<Vec<CommunityInvitation>, ApiError> {
        let listed: Invitations = self.call(
            Method::Get,
            format!("/v1/communities/{community}/invitations"),
            None,
            "listCommunityInvitations",
        )?;
        Ok(listed.invitations)
    }

    /// `withdrawCommunityInvitation`: 404 when none waits.
    pub fn withdraw_invitation(&self, community: &str, account: &str) -> Result<(), ApiError> {
        let path = format!("/v1/communities/{community}/invitations/{account}");
        self.done(Method::Delete, path, None)
    }
}
