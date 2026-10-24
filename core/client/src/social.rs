//! Communities, posts, comments, reactions, reports, moderation and
//! notifications (0063), over the API. Social content is hosted, not
//! end-to-end encrypted, so it is fetched each time and never kept: none of
//! it goes into the store beside the conversations. A post's images (0065)
//! are the one exception, kept as files beside the photos.

use std::path::{Path, PathBuf};

use crate::api::{
    Audience, Author, Card, Comment, CommentPage, Community, CommunityMember, CommunityPage,
    JoinRequest, JoinState, Moderation, ModerationAction, ModerationLogPage, NewReport,
    NotificationPage, Post, PostPage, ReactionKind, Ref, ReportPage, ReportState, Role,
    SocialMedia, Transport,
};
use crate::{Client, ClientError, MediaError, authed, is_id};

/// The most references one `cards` call resolves; the server refuses more.
pub const MAX_CARDS: usize = 50;

/// The most images a post holds (0065); the server refuses more.
pub const MAX_POST_MEDIA: usize = 4;

/// The most images a comment carries (0082).
pub const MAX_COMMENT_MEDIA: usize = 1;

/// The largest image the server takes for a post, in bytes (0065).
pub const MAX_POST_IMAGE: u64 = 10 * 1024 * 1024;

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

    /// Renames a community, changes its description, or makes an open one
    /// private; only its owner may. A blank name is refused before it is
    /// sent, and a private community never becomes open (0063).
    pub fn update_community(
        &self,
        community: &str,
        name: Option<&str>,
        description: Option<&str>,
        audience: Option<Audience>,
    ) -> Result<Community, ClientError> {
        id(community, "community id")?;
        let name = name.map(str::trim);
        if name == Some("") {
            return Err(ClientError::Invalid("a community needs a name"));
        }
        let api = authed(&self.transport, &self.token, &self.client)?;
        Ok(api.update_community(community, name, description.map(str::trim), audience)?)
    }

    /// Sets a community's picture from the image at `path`; its owner or a
    /// moderator may. The server re-encodes it to a 512 px square WebP and
    /// keeps only that. Returns the new version (0080).
    pub fn set_community_avatar(
        &self,
        community: &str,
        path: &Path,
    ) -> Result<String, ClientError> {
        id(community, "community id")?;
        self.checked_image(path)?;
        Ok(authed(&self.transport, &self.token, &self.client)?
            .set_community_avatar(community, path)?)
    }

    /// Removes a community's picture; no error when there was none (0080).
    pub fn remove_community_avatar(&self, community: &str) -> Result<(), ClientError> {
        id(community, "community id")?;
        Ok(authed(&self.transport, &self.token, &self.client)?
            .remove_community_avatar(community)?)
    }

    /// Sets a community's cover from the image at `path`; its owner or a
    /// moderator may. The server re-encodes it to a 1600 by 600 WebP and
    /// keeps only that. Returns the new version (0080).
    pub fn set_community_cover(&self, community: &str, path: &Path) -> Result<String, ClientError> {
        id(community, "community id")?;
        self.checked_image(path)?;
        Ok(authed(&self.transport, &self.token, &self.client)?
            .set_community_cover(community, path)?)
    }

    /// Removes a community's cover; no error when there was none (0080).
    pub fn remove_community_cover(&self, community: &str) -> Result<(), ClientError> {
        id(community, "community id")?;
        Ok(
            authed(&self.transport, &self.token, &self.client)?
                .remove_community_cover(community)?,
        )
    }

    /// The community's members, its owner and moderators first.
    pub fn community_members(&self, community: &str) -> Result<Vec<CommunityMember>, ClientError> {
        id(community, "community id")?;
        Ok(authed(&self.transport, &self.token, &self.client)?.community_members(community)?)
    }

    /// Makes a member a moderator, or a moderator a member again; only the
    /// community's owner may.
    pub fn set_community_role(
        &self,
        community: &str,
        account: &str,
        role: Role,
    ) -> Result<(), ClientError> {
        id(community, "community id")?;
        id(account, "account id")?;
        let api = authed(&self.transport, &self.token, &self.client)?;
        Ok(api.set_community_role(community, account, role)?)
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

    /// The join requests that wait, for a moderator of the community.
    pub fn join_requests(&self, community: &str) -> Result<Vec<JoinRequest>, ClientError> {
        id(community, "community id")?;
        Ok(authed(&self.transport, &self.token, &self.client)?.join_requests(community)?)
    }

    /// Takes the requesting account in as a member.
    pub fn approve_join_request(&self, community: &str, account: &str) -> Result<(), ClientError> {
        id(community, "community id")?;
        id(account, "account id")?;
        let api = authed(&self.transport, &self.token, &self.client)?;
        Ok(api.approve_join_request(community, account)?)
    }

    /// Declines a join request; the account may ask again later.
    pub fn decline_join_request(&self, community: &str, account: &str) -> Result<(), ClientError> {
        id(community, "community id")?;
        id(account, "account id")?;
        let api = authed(&self.transport, &self.token, &self.client)?;
        Ok(api.decline_join_request(community, account)?)
    }

    /// Deletes a community (its owner or a platform moderator); it can be
    /// restored for 30 days.
    pub fn delete_community(&self, community: &str) -> Result<(), ClientError> {
        id(community, "community id")?;
        Ok(authed(&self.transport, &self.token, &self.client)?.delete_community(community)?)
    }

    /// Restores a deleted community; `Refused` with 409 `purged` after the
    /// 30 days.
    pub fn restore_community(&self, community: &str) -> Result<Community, ClientError> {
        id(community, "community id")?;
        Ok(authed(&self.transport, &self.token, &self.client)?.restore_community(community)?)
    }

    /// Leaves a community; its owner cannot (409) until it hands it over.
    pub fn leave_community(&self, community: &str) -> Result<(), ClientError> {
        id(community, "community id")?;
        Ok(authed(&self.transport, &self.token, &self.client)?.leave_community(community)?)
    }
}

/// Posts, comments and reactions.
impl<T: Transport> Client<T> {
    /// Posts of every community this account is a member of, newest first;
    /// `before` is the `next` of the page before. At most 50 a page.
    pub fn feed(&self, before: Option<&str>, size: u32) -> Result<PostPage, ClientError> {
        let api = authed(&self.transport, &self.token, &self.client)?;
        Ok(api.feed(before, size.clamp(1, 50))?)
    }

    /// A page of a community's posts, newest first, those whose body matches
    /// `query` when there is one; `before` is the `next` of the page before.
    /// At most 50 a page.
    pub fn community_posts(
        &self,
        community: &str,
        query: Option<&str>,
        before: Option<&str>,
        size: u32,
    ) -> Result<PostPage, ClientError> {
        id(community, "community id")?;
        let api = authed(&self.transport, &self.token, &self.client)?;
        Ok(api.community_posts(community, search(query), before, size.clamp(1, 50))?)
    }

    /// Posts a text, images `upload_social_media` returned, or both.
    pub fn create_post(
        &self,
        community: &str,
        body: &str,
        media: &[String],
    ) -> Result<Post, ClientError> {
        id(community, "community id")?;
        if body.trim().is_empty() && media.is_empty() {
            return Err(ClientError::Invalid("an empty post"));
        }
        if media.len() > MAX_POST_MEDIA {
            return Err(ClientError::Invalid("over 4 images in a post"));
        }
        for m in media {
            id(m, "media id")?;
        }
        Ok(authed(&self.transport, &self.token, &self.client)?
            .create_post(community, body, media)?)
    }

    /// `create_post` with the options of 0090 and 0091. `anonymous` posts
    /// without the author's name and waits for a moderator's approval; a
    /// community that does not allow it refuses with 409 `anonymous_off`.
    /// `poll` makes the post a poll: `body` is the question, there are two
    /// to six distinct options of at most 80 characters, and no image.
    pub fn create_post_with(
        &self,
        community: &str,
        body: &str,
        media: &[String],
        anonymous: bool,
        poll: Option<&[String]>,
    ) -> Result<Post, ClientError> {
        id(community, "community id")?;
        if let Some(options) = poll {
            check_poll(body, media, options)?;
        } else if body.trim().is_empty() && media.is_empty() {
            return Err(ClientError::Invalid("an empty post"));
        }
        if media.len() > MAX_POST_MEDIA {
            return Err(ClientError::Invalid("over 4 images in a post"));
        }
        for m in media {
            id(m, "media id")?;
        }
        let options: Option<Vec<String>> =
            poll.map(|o| o.iter().map(|t| t.trim().to_owned()).collect());
        Ok(
            authed(&self.transport, &self.token, &self.client)?.create_post_with(
                community,
                body,
                media,
                anonymous,
                options.as_deref(),
            )?,
        )
    }

    /// Votes in a poll, or changes the vote; 409 `poll_closed` once closed
    /// (0090). The post, as this account now sees it.
    pub fn vote_poll(&self, post: &str, option: &str) -> Result<Post, ClientError> {
        id(post, "post id")?;
        id(option, "option id")?;
        Ok(authed(&self.transport, &self.token, &self.client)?.vote_poll(post, option)?)
    }

    /// Takes this account's vote back; no error when it had none.
    pub fn withdraw_vote(&self, post: &str) -> Result<Post, ClientError> {
        id(post, "post id")?;
        Ok(authed(&self.transport, &self.token, &self.client)?.withdraw_vote(post)?)
    }

    /// Closes a poll; its author, the community's owner or a moderator may.
    /// A closed poll shows its results to every reader.
    pub fn close_poll(&self, post: &str) -> Result<Post, ClientError> {
        id(post, "post id")?;
        Ok(authed(&self.transport, &self.token, &self.client)?.close_poll(post)?)
    }

    /// Lets members of a community post without their name (0091), or stops
    /// it; only its owner may. Every such post waits for a moderator.
    pub fn set_anonymous_posts(&self, community: &str, on: bool) -> Result<Community, ClientError> {
        id(community, "community id")?;
        Ok(authed(&self.transport, &self.token, &self.client)?
            .set_anonymous_posts(community, on)?)
    }

    /// The anonymous posts waiting for approval, newest first (0091); a
    /// moderator's. `before` is the `next` of the page before. At most 50 a
    /// page.
    pub fn pending_anonymous_posts(
        &self,
        community: &str,
        before: Option<&str>,
        limit: u32,
    ) -> Result<PostPage, ClientError> {
        id(community, "community id")?;
        let api = authed(&self.transport, &self.token, &self.client)?;
        Ok(api.pending_anonymous_posts(community, before, limit.clamp(1, 50))?)
    }

    /// Publishes an anonymous post, still without its author; a moderator's.
    pub fn approve_anonymous_post(&self, post: &str) -> Result<(), ClientError> {
        id(post, "post id")?;
        Ok(authed(&self.transport, &self.token, &self.client)?.approve_anonymous_post(post)?)
    }

    /// Deletes an anonymous post and tells its author; a moderator's.
    pub fn decline_anonymous_post(&self, post: &str) -> Result<(), ClientError> {
        id(post, "post id")?;
        Ok(authed(&self.transport, &self.token, &self.client)?.decline_anonymous_post(post)?)
    }

    /// Who wrote an anonymous post; a moderator's, and the moderation log
    /// records who asked, never whom (0091).
    pub fn reveal_author(&self, post: &str) -> Result<Author, ClientError> {
        id(post, "post id")?;
        Ok(authed(&self.transport, &self.token, &self.client)?.reveal_author(post)?)
    }

    /// Uploads the image at `path` for a post in `community` (0065). The
    /// server re-encodes it to WebP; the id goes in `create_post` within a
    /// day, or the image is deleted.
    pub fn upload_social_media(
        &self,
        community: &str,
        path: &Path,
    ) -> Result<SocialMedia, ClientError> {
        id(community, "community id")?;
        let size = self.blobs.len(path).map_err(MediaError::from)?;
        if size == 0 {
            return Err(ClientError::Invalid("an empty image"));
        }
        if size > MAX_POST_IMAGE {
            return Err(ClientError::Invalid("an image over 10 MB"));
        }
        Ok(authed(&self.transport, &self.token, &self.client)?
            .upload_social_media(community, path)?)
    }

    /// The file of a post's image: kept from an earlier call, since an
    /// image never changes under its id, else fetched now. The images go
    /// with the media files when the store is forgotten.
    pub fn post_media(&self, post: &str, media: &str) -> Result<PathBuf, ClientError> {
        id(post, "post id")?;
        id(media, "media id")?;
        let dir = self.media.join("posts").join(post);
        let kept = dir.join(format!("{media}.webp"));
        if self.blobs.exists(&kept) {
            return Ok(kept);
        }
        self.blobs.create_dir_all(&dir).map_err(MediaError::from)?;
        let part = dir.join(format!("{media}.part"));
        let fetched =
            authed(&self.transport, &self.token, &self.client)?.get_post_media(post, media, &part);
        if let Err(error) = fetched {
            let _ = self.blobs.remove_file(&part);
            return Err(error.into());
        }
        self.blobs.rename(&part, &kept).map_err(MediaError::from)?;
        Ok(kept)
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

    /// Likes a comment; liking twice is one like (0080).
    pub fn like_comment(&self, comment: &str) -> Result<(), ClientError> {
        id(comment, "comment id")?;
        Ok(authed(&self.transport, &self.token, &self.client)?.like_comment(comment)?)
    }

    /// Takes this account's like off a comment; no error when it had none.
    pub fn unlike_comment(&self, comment: &str) -> Result<(), ClientError> {
        id(comment, "comment id")?;
        Ok(authed(&self.transport, &self.token, &self.client)?.unlike_comment(comment)?)
    }

    /// Features a post (0080, 0088); a moderator's. 409 `pin_limit` when
    /// three are featured already: release one first.
    pub fn pin_post(&self, community: &str, post: &str) -> Result<(), ClientError> {
        id(community, "community id")?;
        id(post, "post id")?;
        Ok(authed(&self.transport, &self.token, &self.client)?.pin_post(community, post)?)
    }

    /// Unpins the community's pinned post; no error when it is not pinned.
    pub fn unpin_post(&self, community: &str, post: &str) -> Result<(), ClientError> {
        id(community, "community id")?;
        id(post, "post id")?;
        Ok(authed(&self.transport, &self.token, &self.client)?.unpin_post(community, post)?)
    }

    /// Pins a community to the top of this account's own list (0080).
    pub fn pin_community(&self, community: &str) -> Result<(), ClientError> {
        id(community, "community id")?;
        Ok(authed(&self.transport, &self.token, &self.client)?.pin_community(community)?)
    }

    /// Unpins a community; no error when it was not pinned.
    pub fn unpin_community(&self, community: &str) -> Result<(), ClientError> {
        id(community, "community id")?;
        Ok(authed(&self.transport, &self.token, &self.client)?.unpin_community(community)?)
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

    /// Comments on a post: a text, an image `upload_social_media` returned,
    /// or both (0082). A reply when `parent_comment_id` names the comment it
    /// answers.
    pub fn create_comment(
        &self,
        post: &str,
        body: &str,
        parent_comment_id: Option<&str>,
        media: &[String],
    ) -> Result<Comment, ClientError> {
        id(post, "post id")?;
        if body.trim().is_empty() && media.is_empty() {
            return Err(ClientError::Invalid("an empty comment"));
        }
        if media.len() > MAX_COMMENT_MEDIA {
            return Err(ClientError::Invalid("over 1 image in a comment"));
        }
        for m in media {
            id(m, "media id")?;
        }
        if let Some(parent) = parent_comment_id {
            id(parent, "comment id")?;
        }
        let api = authed(&self.transport, &self.token, &self.client)?;
        Ok(api.create_comment(post, body, parent_comment_id, media)?)
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
        // A mute is for a time (0063): the server refuses one without an
        // end, and an end on anything else.
        if (moderation.action == ModerationAction::MuteMember) != moderation.until.is_some() {
            return Err(ClientError::Invalid(
                "an end with a mute, and only with a mute",
            ));
        }
        let api = authed(&self.transport, &self.token, &self.client)?;
        Ok(api.moderate(community, moderation)?)
    }

    /// A page of a community's moderation log, newest first, for its
    /// moderators; `before` is the `next` of the page before. At most 100 a
    /// page.
    pub fn community_moderation_log(
        &self,
        community: &str,
        before: Option<&str>,
        size: u32,
    ) -> Result<ModerationLogPage, ClientError> {
        id(community, "community id")?;
        let api = authed(&self.transport, &self.token, &self.client)?;
        Ok(api.community_moderation_log(community, before, size.clamp(1, 100))?)
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

/// The bounds of a poll's options (0090), as the server holds them.
const POLL_OPTIONS: std::ops::RangeInclusive<usize> = 2..=6;
const POLL_OPTION_CHARS: usize = 80;

/// A poll is refused before it is sent when the server would refuse it.
fn check_poll(body: &str, media: &[String], options: &[String]) -> Result<(), ClientError> {
    if body.trim().is_empty() {
        return Err(ClientError::Invalid("a poll needs a question"));
    }
    if !media.is_empty() {
        return Err(ClientError::Invalid("a poll takes no image"));
    }
    if !POLL_OPTIONS.contains(&options.len()) {
        return Err(ClientError::Invalid("a poll has two to six options"));
    }
    let mut seen = Vec::with_capacity(options.len());
    for option in options {
        let option = option.trim();
        if option.is_empty() || option.chars().count() > POLL_OPTION_CHARS {
            return Err(ClientError::Invalid("an option of 1 to 80 characters"));
        }
        if seen.contains(&option) {
            return Err(ClientError::Invalid("a poll's options differ"));
        }
        seen.push(option);
    }
    Ok(())
}
