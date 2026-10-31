//! The community calls that touch the store's files (0065, 0080).

use std::path::{Path, PathBuf};

use super::{MAX_POST_IMAGE, id};
use crate::api::{SocialMedia, Transport};
use crate::{Client, ClientError, MediaError, authed};

/// The calls that touch the store's files, so they stay on the client (0113).
impl<T: Transport> Client<T> {
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

    /// Sets a community's cover from the image at `path`; its owner or a
    /// moderator may. The server re-encodes it to a 1600 by 600 WebP and
    /// keeps only that. Returns the new version (0080).
    pub fn set_community_cover(&self, community: &str, path: &Path) -> Result<String, ClientError> {
        id(community, "community id")?;
        self.checked_image(path)?;
        Ok(authed(&self.transport, &self.token, &self.client)?
            .set_community_cover(community, path)?)
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
}
