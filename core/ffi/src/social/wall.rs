//! The wall (0115) as the apps see it.

use std::path::Path;

use spjall_client::api;

use super::{CommunityImagePage, Post, PostImage, PostPage, WallAudience};
use crate::CoreError;
use crate::client::CoreClient;
use crate::foreign::path_string;
use crate::frames::{Frame, Framing};

/// An account's wall, also when it has no post yet.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct WallProfile {
    pub account_id: String,
    /// None until the account's first wall post.
    pub wall_id: Option<String>,
    pub bio: Option<String>,
    /// The cover's version, for `wall_cover`; none when it has none.
    pub cover: Option<String>,
    pub cover_frames: Option<Framing>,
    /// `YYYY-MM`.
    pub joined_month: String,
}

impl From<api::WallProfile> for WallProfile {
    fn from(wall: api::WallProfile) -> Self {
        let api::WallProfile {
            account_id,
            wall_id,
            bio,
            cover,
            cover_frames,
            joined_month,
        } = wall;
        Self {
            account_id,
            wall_id,
            bio,
            cover,
            cover_frames: cover_frames.map(Into::into),
            joined_month,
        }
    }
}

#[uniffi::export]
impl CoreClient {
    /// An account's wall. `Refused` with 404 when there is no such account, or
    /// a block stands between them.
    pub fn wall(&self, account_id: String) -> Result<WallProfile, CoreError> {
        Ok(self.hosted.wall(&account_id)?.into())
    }

    /// A page of an account's wall posts, newest first; `before` is the `next`
    /// of the page before. A wall this account may not read answers as an empty
    /// last page.
    #[uniffi::method(default(before = None, limit = 20))]
    pub fn wall_posts(
        &self,
        account_id: String,
        before: Option<String>,
        limit: u32,
    ) -> Result<PostPage, CoreError> {
        let page = self
            .hosted
            .wall_posts(&account_id, before.as_deref(), limit)?;
        Ok(PostPage {
            posts: page.posts.into_iter().map(Into::into).collect(),
            next: page.next,
        })
    }

    /// A page of the images on an account's wall; `cursor` is the `next` of the
    /// page before.
    #[uniffi::method(default(cursor = None, limit = 20))]
    pub fn wall_images(
        &self,
        account_id: String,
        cursor: Option<String>,
        limit: u32,
    ) -> Result<CommunityImagePage, CoreError> {
        let page = self
            .hosted
            .wall_images(&account_id, cursor.as_deref(), limit)?;
        Ok(CommunityImagePage {
            images: page.images.into_iter().collect(),
            next: page.next,
        })
    }

    /// A post on this account's own wall; `poll` as in `create_post_with`.
    /// `Refused` with 403 `suspended`.
    #[uniffi::method(default(media = [], poll = None))]
    pub fn create_wall_post(
        &self,
        body: String,
        media: Vec<String>,
        poll: Option<Vec<String>>,
        audience: WallAudience,
    ) -> Result<Post, CoreError> {
        let post = self
            .hosted
            .create_wall_post(&body, &media, poll.as_deref(), audience)?;
        Ok(post.into())
    }

    /// Uploads the image at `path` for a wall post; its id goes in
    /// `create_wall_post` within a day.
    pub fn upload_wall_image(&self, path: String) -> Result<PostImage, CoreError> {
        Ok(self.client()?.upload_wall_media(Path::new(&path))?.into())
    }

    /// Changes who may read a wall post of this account's.
    pub fn set_post_audience(
        &self,
        post_id: String,
        audience: WallAudience,
    ) -> Result<(), CoreError> {
        Ok(self.hosted.set_post_audience(&post_id, audience)?)
    }

    /// Sets this account's bio; a blank one clears it. Line breaks read as a
    /// space; `Invalid` over 120 characters.
    pub fn set_bio(&self, bio: String) -> Result<(), CoreError> {
        Ok(self.hosted.set_bio(&bio)?)
    }

    /// Sets this account's cover from the image at `path`. The new version.
    pub fn set_wall_cover(&self, path: String) -> Result<String, CoreError> {
        Ok(self.client()?.set_wall_cover(Path::new(&path))?)
    }

    /// Removes this account's cover; no error when there was none.
    pub fn remove_wall_cover(&self) -> Result<(), CoreError> {
        Ok(self.hosted.remove_wall_cover()?)
    }

    /// The path of an account's cover at `version`: fetched once per version,
    /// none when the server has none or withholds it.
    pub fn wall_cover(
        &self,
        account_id: String,
        version: String,
    ) -> Result<Option<String>, CoreError> {
        Ok(self
            .client()?
            .wall_cover(&account_id, &version)?
            .as_deref()
            .map(path_string))
    }

    /// `wall_cover` in `frame`: `Compact`, `Medium` or `Expanded`, else
    /// `Invalid`.
    pub fn wall_cover_framed(
        &self,
        account_id: String,
        version: String,
        frame: Frame,
    ) -> Result<Option<String>, CoreError> {
        Ok(self
            .client()?
            .wall_cover_framed(&account_id, &version, frame)?
            .as_deref()
            .map(path_string))
    }

    /// Frames this account's cover again from its master, with no new upload.
    /// The new version; `NoMaster` for one stored before masters were kept.
    pub fn set_wall_cover_framing(&self, framing: Framing) -> Result<String, CoreError> {
        Ok(self.client()?.set_wall_cover_framing(&framing.into())?)
    }

    /// Writes the master of this account's cover to `path`, for the editor to
    /// frame again. False when it has none.
    pub fn wall_cover_source(&self, path: String) -> Result<bool, CoreError> {
        Ok(self.client()?.wall_cover_source(Path::new(&path))?)
    }

    /// Removes a comment on this account's wall, with the reason its writer
    /// reads: 1 to 500 characters, else `Invalid`.
    pub fn remove_wall_comment(&self, comment_id: String, reason: String) -> Result<(), CoreError> {
        Ok(self.hosted.remove_wall_comment(&comment_id, &reason)?)
    }
}
