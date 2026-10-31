//! The home feed and where its composer posts (0116) as the apps see them.

use spjall_client::PostTarget as ClientTarget;
use spjall_client::api;

use super::{Community, Post, PostImage, WallAudience};
use crate::CoreError;
use crate::client::CoreClient;

/// A page of the home feed. An empty `More` is a normal answer, since the
/// server filters a page after reading it: fetch again with `next`. Only `End`
/// says there is no more.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Enum)]
pub enum HomePage {
    More { posts: Vec<Post>, next: String },
    End { posts: Vec<Post> },
}

impl From<api::HomePage> for HomePage {
    fn from(page: api::HomePage) -> Self {
        let all = |posts: Vec<api::Post>| posts.into_iter().map(Into::into).collect();
        match page {
            api::HomePage::More { posts, next } => Self::More {
                posts: all(posts),
                next,
            },
            api::HomePage::End { posts } => Self::End { posts: all(posts) },
        }
    }
}

/// Where a post goes (0116). The audience belongs to the wall, the anonymous
/// choice to a community.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Enum)]
pub enum PostTarget {
    Wall {
        audience: WallAudience,
    },
    Community {
        community_id: String,
        anonymous: bool,
    },
}

impl From<PostTarget> for ClientTarget {
    fn from(target: PostTarget) -> Self {
        match target {
            PostTarget::Wall { audience } => Self::Wall { audience },
            PostTarget::Community {
                community_id,
                anonymous,
            } => Self::Community {
                community_id,
                anonymous,
            },
        }
    }
}

/// Where the composer starts (0116): the own wall, for friends.
#[uniffi::export]
pub fn default_post_target() -> PostTarget {
    match ClientTarget::default() {
        ClientTarget::Wall { audience } => PostTarget::Wall { audience },
        ClientTarget::Community {
            community_id,
            anonymous,
        } => PostTarget::Community {
            community_id,
            anonymous,
        },
    }
}

#[uniffi::export]
impl CoreClient {
    /// A page of the home feed, newest first; `before` is the `next` of the
    /// page before. At most 30 a page.
    #[uniffi::method(default(before = None, limit = 30))]
    pub fn home(&self, before: Option<String>, limit: u32) -> Result<HomePage, CoreError> {
        Ok(self.hosted.home(before.as_deref(), limit)?.into())
    }

    /// The communities the composer offers beside the own wall.
    pub fn post_communities(&self) -> Result<Vec<Community>, CoreError> {
        let mine = self.hosted.post_communities()?;
        Ok(mine.into_iter().map(Into::into).collect())
    }

    /// Posts to `target`; `poll` as in `create_post_with`.
    #[uniffi::method(default(media = [], poll = None))]
    pub fn post_to(
        &self,
        target: PostTarget,
        body: String,
        media: Vec<String>,
        poll: Option<Vec<String>>,
    ) -> Result<Post, CoreError> {
        let post = self
            .hosted
            .post_to(&target.into(), &body, &media, poll.as_deref())?;
        Ok(post.into())
    }

    /// Uploads the image at `path` for a post to `target`; its id goes in
    /// `post_to` within a day.
    pub fn upload_post_image_for(
        &self,
        target: PostTarget,
        path: String,
    ) -> Result<PostImage, CoreError> {
        let media = self
            .client()?
            .upload_post_media(&target.into(), std::path::Path::new(&path))?;
        Ok(media.into())
    }
}
