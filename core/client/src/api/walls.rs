//! The wall (0115) as the server answers it: a wall's profile, its posts and
//! images, its cover, and what its owner may change.

use std::path::Path;

use serde::Deserialize;

use super::{
    Api, ApiError, CommunityImagePage, ImageSet, Method, Post, PostPage, SocialMedia, Transport,
    WallAudience, frame_query, with_query,
};
use crate::frames::{Frame, Framing};

/// `getWall`: the wall of an account, also when it has none yet.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WallProfile {
    pub account_id: String,
    /// None until the account's first wall post.
    #[serde(default)]
    pub wall_id: Option<String>,
    #[serde(default)]
    pub bio: Option<String>,
    /// The cover's version; none when it has none.
    #[serde(default)]
    pub cover: Option<String>,
    #[serde(default)]
    pub cover_frames: Option<Framing>,
    /// `YYYY-MM`.
    pub joined_month: String,
}

impl<T: Transport> Api<'_, T> {
    /// `getWall`.
    pub fn wall(&self, account: &str) -> Result<WallProfile, ApiError> {
        let path = format!("/v1/accounts/{account}/wall");
        self.call(Method::Get, path, None, "getWall")
    }

    /// `listWallPosts`: the empty last page when the caller may not read it.
    pub fn wall_posts(
        &self,
        account: &str,
        before: Option<&str>,
        limit: u32,
    ) -> Result<PostPage, ApiError> {
        let limit = limit.to_string();
        let params = [("before", before), ("limit", Some(limit.as_str()))];
        let path = with_query(&format!("/v1/accounts/{account}/wall/posts"), &params);
        self.call(Method::Get, path, None, "listWallPosts")
    }

    /// `listWallImages`.
    pub fn wall_images(
        &self,
        account: &str,
        cursor: Option<&str>,
        limit: u32,
    ) -> Result<CommunityImagePage, ApiError> {
        let limit = limit.to_string();
        let params = [("cursor", cursor), ("limit", Some(limit.as_str()))];
        let path = with_query(&format!("/v1/accounts/{account}/wall/images"), &params);
        self.call(Method::Get, path, None, "listWallImages")
    }

    /// `getWallCover`: the cover, a WebP, written to `to`.
    pub fn get_wall_cover(
        &self,
        account: &str,
        frame: Option<Frame>,
        to: &Path,
    ) -> Result<(), ApiError> {
        let query = frame_query(frame);
        let path = format!("/v1/accounts/{account}/wall/cover{query}");
        let request = self.request(Method::Get, path, None);
        Self::checked(self.transport.download(request, to)?).map(drop)
    }

    /// `createWallPost`: on the caller's own wall, made at its first post.
    pub fn create_wall_post(
        &self,
        body: &str,
        media: &[String],
        poll: Option<&[String]>,
        audience: WallAudience,
    ) -> Result<Post, ApiError> {
        let mut json = serde_json::json!({ "body": body, "media": media, "audience": audience });
        if let Some(options) = poll {
            json["poll"] = serde_json::json!({ "options": options });
        }
        let path = "/v1/wall/posts".to_owned();
        self.call(Method::Post, path, Self::json(&json), "createWallPost")
    }

    /// `uploadWallMedia`: the image at `file`, for a wall post.
    pub fn upload_wall_media(&self, file: &Path) -> Result<SocialMedia, ApiError> {
        let request = self.request(Method::Post, "/v1/wall/media".to_owned(), None);
        let response = Self::checked(self.transport.upload(request, file)?)?;
        serde_json::from_str(&response.body).map_err(|_| ApiError::Malformed("uploadWallMedia"))
    }

    /// `setPostAudience`.
    pub fn set_post_audience(&self, post: &str, audience: WallAudience) -> Result<(), ApiError> {
        let body = serde_json::json!({ "audience": audience });
        let path = format!("/v1/posts/{post}/audience");
        self.done(Method::Patch, path, Self::json(&body))
    }

    /// `setBio`: an empty one clears it.
    pub fn set_bio(&self, bio: &str) -> Result<(), ApiError> {
        let body = serde_json::json!({ "bio": bio });
        self.done(Method::Put, "/v1/me/bio".to_owned(), Self::json(&body))
    }

    /// `setWallCover`: the image at `file`. The new version.
    pub fn set_wall_cover(&self, file: &Path) -> Result<String, ApiError> {
        let request = self.request(Method::Put, "/v1/wall/cover".to_owned(), None);
        let response = Self::checked(self.transport.upload(request, file)?)?;
        let set: ImageSet = serde_json::from_str(&response.body)
            .map_err(|_| ApiError::Malformed("setWallCover"))?;
        Ok(set.version)
    }

    /// `removeWallCover`: no error when there was none.
    pub fn remove_wall_cover(&self) -> Result<(), ApiError> {
        self.done(Method::Delete, "/v1/wall/cover".to_owned(), None)
    }

    /// `frameWallCover`: frames it again from its master. The new version; 409
    /// `no_master` for a cover stored before masters were kept.
    pub fn frame_wall_cover(&self, framing: &Framing) -> Result<String, ApiError> {
        let path = "/v1/wall/cover/frames".to_owned();
        let set: ImageSet =
            self.call(Method::Patch, path, Self::json(framing), "frameWallCover")?;
        Ok(set.version)
    }

    /// `getWallCoverSource`: the caller's master, a WebP, written to `to`, for
    /// the editor. 404 when it has none.
    pub fn get_wall_cover_source(&self, to: &Path) -> Result<(), ApiError> {
        let request = self.request(Method::Get, "/v1/wall/cover/source".to_owned(), None);
        Self::checked(self.transport.download(request, to)?).map(drop)
    }

    /// `removeWallComment`: the wall's owner removes a comment, with a reason
    /// its writer reads (0115).
    pub fn remove_wall_comment(&self, comment: &str, reason: &str) -> Result<(), ApiError> {
        let body = serde_json::json!({ "reason": reason });
        let path = format!("/v1/wall/comments/{comment}/remove");
        self.done(Method::Post, path, Self::json(&body))
    }
}
