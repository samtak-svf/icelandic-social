//! Communities, posts, comments, reactions, reports, moderation and
//! notifications (0063), over the API. Social content is hosted, not
//! end-to-end encrypted, so it is fetched each time and never kept: none of
//! it goes into the store beside the conversations.

use crate::api::{
    Audience, Card, Comment, CommentPage, Community, CommunityPage, JoinState, Moderation,
    NewReport, NotificationPage, Post, PostPage, ReactionKind, Ref, ReportPage, ReportState,
    Transport,
};
use crate::{Client, ClientError, authed, is_id};

/// The most references one `cards` call resolves; the server refuses more.
pub const MAX_CARDS: usize = 50;

fn id(text: &str, what: &'static str) -> Result<(), ClientError> {
    if is_id(text) {
        Ok(())
    } else {
        Err(ClientError::Invalid(what))
    }
}

/// A search the server takes: trimmed, none when blank.
fn search(text: Option<&str>) -> Option<&str> {
    text.map(str::trim).filter(|t| !t.is_empty())
}

/// Communities.
impl<T: Transport> Client<T> {
    /// A page of the communities this account may see, those whose name
    /// matches `query` when there is one; `after` is the `next` of the
    /// page before. At most 50 a page.
    pub fn communities(
        &self,
        query: Option<&str>,
        after: Option<&str>,
        size: u32,
    ) -> Result<CommunityPage, ClientError> {
        let api = authed(&self.transport, &self.token, &self.client)?;
        Ok(api.communities(search(query), after, size.clamp(1, 50))?)
    }

    /// Every community this account is a member of.
    pub fn my_communities(&self) -> Result<Vec<Community>, ClientError> {
        Ok(authed(&self.transport, &self.token, &self.client)?.my_communities()?)
    }

    /// A new community, owned by this account.
    pub fn create_community(
        &self,
        name: &str,
        description: &str,
        audience: Audience,
    ) -> Result<Community, ClientError> {
        let name = name.trim();
        if name.is_empty() {
            return Err(ClientError::Invalid("a community needs a name"));
        }
        let api = authed(&self.transport, &self.token, &self.client)?;
        Ok(api.create_community(name, description.trim(), audience)?)
    }

    pub fn community(&self, community: &str) -> Result<Community, ClientError> {
        id(community, "community id")?;
        Ok(authed(&self.transport, &self.token, &self.client)?.community(community)?)
    }

    /// Joins an open community at once, or asks a private one's moderators.
    pub fn join_community(&self, community: &str) -> Result<JoinState, ClientError> {
        id(community, "community id")?;
        Ok(authed(&self.transport, &self.token, &self.client)?.join_community(community)?)
    }

    pub fn withdraw_join_request(&self, community: &str) -> Result<(), ClientError> {
        id(community, "community id")?;
        let api = authed(&self.transport, &self.token, &self.client)?;
        Ok(api.withdraw_join_request(community)?)
    }

    /// Leaves a community; its owner cannot (409) until it hands it over.
    pub fn leave_community(&self, community: &str) -> Result<(), ClientError> {
        id(community, "community id")?;
        Ok(authed(&self.transport, &self.token, &self.client)?.leave_community(community)?)
    }
}

/// Posts, comments and reactions.
impl<T: Transport> Client<T> {
    /// A page of a community's posts, newest first; `before` is the `next`
    /// of the page before. At most 50 a page.
    pub fn community_posts(
        &self,
        community: &str,
        before: Option<&str>,
        size: u32,
    ) -> Result<PostPage, ClientError> {
        id(community, "community id")?;
        let api = authed(&self.transport, &self.token, &self.client)?;
        Ok(api.community_posts(community, before, size.clamp(1, 50))?)
    }

    pub fn create_post(&self, community: &str, body: &str) -> Result<Post, ClientError> {
        id(community, "community id")?;
        if body.trim().is_empty() {
            return Err(ClientError::Invalid("an empty post"));
        }
        Ok(authed(&self.transport, &self.token, &self.client)?.create_post(community, body)?)
    }

    pub fn post(&self, post: &str) -> Result<Post, ClientError> {
        id(post, "post id")?;
        Ok(authed(&self.transport, &self.token, &self.client)?.post(post)?)
    }

    pub fn delete_post(&self, post: &str) -> Result<(), ClientError> {
        id(post, "post id")?;
        Ok(authed(&self.transport, &self.token, &self.client)?.delete_post(post)?)
    }

    /// Sets this account's one reaction on a post, in place of any other.
    pub fn react(&self, post: &str, kind: ReactionKind) -> Result<(), ClientError> {
        id(post, "post id")?;
        Ok(authed(&self.transport, &self.token, &self.client)?.react(post, kind)?)
    }

    pub fn unreact(&self, post: &str) -> Result<(), ClientError> {
        id(post, "post id")?;
        Ok(authed(&self.transport, &self.token, &self.client)?.unreact(post)?)
    }

    /// A page of a post's comments, oldest first; `after` is the `next` of
    /// the page before. At most 100 a page.
    pub fn comments(
        &self,
        post: &str,
        after: Option<&str>,
        size: u32,
    ) -> Result<CommentPage, ClientError> {
        id(post, "post id")?;
        let api = authed(&self.transport, &self.token, &self.client)?;
        Ok(api.comments(post, after, size.clamp(1, 100))?)
    }

    pub fn create_comment(&self, post: &str, body: &str) -> Result<Comment, ClientError> {
        id(post, "post id")?;
        if body.trim().is_empty() {
            return Err(ClientError::Invalid("an empty comment"));
        }
        Ok(authed(&self.transport, &self.token, &self.client)?.create_comment(post, body)?)
    }

    pub fn delete_comment(&self, comment: &str) -> Result<(), ClientError> {
        id(comment, "comment id")?;
        Ok(authed(&self.transport, &self.token, &self.client)?.delete_comment(comment)?)
    }
}

/// Reports, moderation and cards.
impl<T: Transport> Client<T> {
    /// Reports a post, a comment, a community or an account, to the
    /// community's moderators or, with `to_platform`, the platform's.
    pub fn report(&self, report: &NewReport) -> Result<(), ClientError> {
        id(&report.target.id, "report target id")?;
        Ok(authed(&self.transport, &self.token, &self.client)?.report(report)?)
    }

    /// A page of a community's reports, for its moderators.
    pub fn community_reports(
        &self,
        community: &str,
        state: ReportState,
        after: Option<&str>,
        size: u32,
    ) -> Result<ReportPage, ClientError> {
        id(community, "community id")?;
        let api = authed(&self.transport, &self.token, &self.client)?;
        Ok(api.community_reports(community, state, after, size.clamp(1, 50))?)
    }

    /// One moderator's action in a community, which its log keeps.
    pub fn moderate(&self, community: &str, moderation: &Moderation) -> Result<(), ClientError> {
        id(community, "community id")?;
        id(&moderation.target_id, "moderation target id")?;
        if let Some(report) = &moderation.report_id {
            id(report, "report id")?;
        }
        if moderation.reason.trim().is_empty() {
            return Err(ClientError::Invalid("a moderation needs a reason"));
        }
        let api = authed(&self.transport, &self.token, &self.client)?;
        Ok(api.moderate(community, moderation)?)
    }

    /// Closes a report with what was done about it.
    pub fn close_report(&self, report: &str, resolution: &str) -> Result<(), ClientError> {
        id(report, "report id")?;
        if resolution.trim().is_empty() {
            return Err(ClientError::Invalid("a closed report needs a resolution"));
        }
        let api = authed(&self.transport, &self.token, &self.client)?;
        Ok(api.close_report(report, resolution)?)
    }

    /// What each reference shows, in their order; none asked, none sent.
    pub fn cards(&self, refs: &[Ref]) -> Result<Vec<Card>, ClientError> {
        if refs.is_empty() {
            return Ok(Vec::new());
        }
        if refs.len() > MAX_CARDS {
            return Err(ClientError::Invalid("over 50 cards at once"));
        }
        for reference in refs {
            id(&reference.id, "card id")?;
        }
        Ok(authed(&self.transport, &self.token, &self.client)?.resolve_cards(refs)?)
    }
}

/// Notifications.
impl<T: Transport> Client<T> {
    /// A page of this account's notifications, newest first; `before` is
    /// the `next` of the page before. At most 50 a page.
    pub fn notifications(
        &self,
        before: Option<&str>,
        size: u32,
    ) -> Result<NotificationPage, ClientError> {
        let api = authed(&self.transport, &self.token, &self.client)?;
        Ok(api.notifications(before, size.clamp(1, 50))?)
    }

    /// Marks read every notification made at or before `up_to`, the
    /// `created_at` of the newest one shown.
    pub fn read_notifications(&self, up_to: u64) -> Result<(), ClientError> {
        Ok(authed(&self.transport, &self.token, &self.client)?.read_notifications(up_to)?)
    }
}
