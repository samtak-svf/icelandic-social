//! Community invitations (0130) as the client offers them.

use super::id;
use crate::api::{CommunityInvitation, JoinRequest, Transport};
use crate::{ClientError, Hosted};

/// A moderator's view of who waits to come in: join requests and invitations.
impl<T: Transport> Hosted<T> {
    /// The join requests that wait, for a moderator of the community.
    pub fn join_requests(&self, community: &str) -> Result<Vec<JoinRequest>, ClientError> {
        id(community, "community id")?;
        Ok(self.api()?.join_requests(community)?)
    }

    /// Takes the requesting account in as a member.
    pub fn approve_join_request(&self, community: &str, account: &str) -> Result<(), ClientError> {
        id(community, "community id")?;
        id(account, "account id")?;
        let api = self.api()?;
        Ok(api.approve_join_request(community, account)?)
    }

    /// Declines a join request; the account may ask again later.
    pub fn decline_join_request(&self, community: &str, account: &str) -> Result<(), ClientError> {
        id(community, "community id")?;
        id(account, "account id")?;
        let api = self.api()?;
        Ok(api.decline_join_request(community, account)?)
    }

    /// The invitations that wait, newest first; for a moderator.
    pub fn community_invitations(
        &self,
        community: &str,
    ) -> Result<Vec<CommunityInvitation>, ClientError> {
        id(community, "community id")?;
        Ok(self.api()?.community_invitations(community)?)
    }

    /// Takes an invitation back; its notice goes with it.
    pub fn withdraw_invitation(&self, community: &str, account: &str) -> Result<(), ClientError> {
        id(community, "community id")?;
        id(account, "account id")?;
        Ok(self.api()?.withdraw_invitation(community, account)?)
    }
}
