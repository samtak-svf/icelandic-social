//! The wall (0115) as the client offers it. The cover keeps its files as a
//! community's cover does, in the media folder's `walls/<account>/cover`.

use std::path::{Path, PathBuf};

use super::{MAX_POST_IMAGE, check_post, id};
use crate::api::{
    CommunityImagePage, Post, PostPage, SocialMedia, Transport, WallAudience, WallProfile,
};
use crate::frames::{Frame, FrameKind, Framing};
use crate::photo::{forget_tree, frame_dir, framing_error};
use crate::text::{limits, text_length};
use crate::{Client, ClientError, Hosted, MediaError, authed, this_device};

/// The longest bio, in characters (0115).
pub const MAX_BIO: usize = limits::BIO_CHARS;

/// The longest reason for removing a comment, in characters (0115).
const MAX_REASON: usize = limits::MODERATION_NOTE_CHARS;

/// A bio as the server takes it: any line breaks a space, trimmed, at most
/// `MAX_BIO`. Empty clears it.
fn clean_bio(bio: &str) -> Result<String, ClientError> {
    let joined = bio
        .split(['\r', '\n'])
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    let clean = joined.trim();
    if text_length(clean) > MAX_BIO {
        return Err(ClientError::Invalid("a bio over 120 characters"));
    }
    Ok(clean.to_owned())
}

/// The wall's calls that need only the server.
impl<T: Transport> Hosted<T> {
    /// An account's wall, also when it has no post yet.
    pub fn wall(&self, account: &str) -> Result<WallProfile, ClientError> {
        id(account, "account id")?;
        Ok(self.api()?.wall(account)?)
    }

    /// A page of an account's wall posts, newest first; `before` is the `next`
    /// of the page before. At most 50 a page. A wall this account may not read
    /// answers as an empty last page.
    pub fn wall_posts(
        &self,
        account: &str,
        before: Option<&str>,
        size: u32,
    ) -> Result<PostPage, ClientError> {
        id(account, "account id")?;
        Ok(self.api()?.wall_posts(account, before, size.clamp(1, 50))?)
    }

    /// A page of the images on an account's wall; `cursor` is the `next` of the
    /// page before. At most 50 a page.
    pub fn wall_images(
        &self,
        account: &str,
        cursor: Option<&str>,
        size: u32,
    ) -> Result<CommunityImagePage, ClientError> {
        id(account, "account id")?;
        Ok(self
            .api()?
            .wall_images(account, cursor, size.clamp(1, 50))?)
    }

    /// A post on this account's own wall, with the checks a community's post
    /// has. There is no anonymous post and no pin on a wall (0115).
    pub fn create_wall_post(
        &self,
        body: &str,
        media: &[String],
        poll: Option<&[String]>,
        audience: WallAudience,
    ) -> Result<Post, ClientError> {
        let options = check_post(body, media, poll)?;
        Ok(self
            .api()?
            .create_wall_post(body, media, options.as_deref(), audience)?)
    }

    /// Changes who may read a wall post of this account's.
    pub fn set_post_audience(&self, post: &str, audience: WallAudience) -> Result<(), ClientError> {
        id(post, "post id")?;
        Ok(self.api()?.set_post_audience(post, audience)?)
    }

    /// Sets this account's bio; a blank one clears it. Line breaks read as a
    /// space; `Invalid` over 120 characters.
    pub fn set_bio(&self, bio: &str) -> Result<(), ClientError> {
        let clean = clean_bio(bio)?;
        Ok(self.api()?.set_bio(&clean)?)
    }

    /// Removes this account's cover; no error when there was none.
    pub fn remove_wall_cover(&self) -> Result<(), ClientError> {
        Ok(self.api()?.remove_wall_cover()?)
    }

    /// Removes a comment on this account's wall, with the reason its writer
    /// reads: 1 to 500 characters.
    pub fn remove_wall_comment(&self, comment: &str, reason: &str) -> Result<(), ClientError> {
        id(comment, "comment id")?;
        let reason = reason.trim();
        if reason.is_empty() {
            return Err(ClientError::Invalid("no reason"));
        }
        if text_length(reason) > MAX_REASON {
            return Err(ClientError::Invalid("a reason over 500 characters"));
        }
        Ok(self.api()?.remove_wall_comment(comment, reason)?)
    }
}

/// The wall's calls that touch the store's files, so they stay on the client
/// (0113).
impl<T: Transport> Client<T> {
    /// Uploads the image at `path` for a wall post; as `upload_social_media`.
    pub fn upload_wall_media(&self, path: &Path) -> Result<SocialMedia, ClientError> {
        let size = self.blobs.len(path).map_err(MediaError::from)?;
        if size == 0 {
            return Err(ClientError::Invalid("an empty image"));
        }
        if size > MAX_POST_IMAGE {
            return Err(ClientError::Invalid("an image over 10 MB"));
        }
        Ok(authed(&self.transport, &self.token, &self.client)?.upload_wall_media(path)?)
    }

    /// Sets this account's cover from the image at `path`, as a community's.
    /// The new version.
    pub fn set_wall_cover(&self, path: &Path) -> Result<String, ClientError> {
        self.checked_image(path)?;
        Ok(authed(&self.transport, &self.token, &self.client)?.set_wall_cover(path)?)
    }

    /// An account's cover at `version`: kept per version, none when the server
    /// has none or withholds it, and the kept files go then too.
    pub fn wall_cover(
        &mut self,
        account: &str,
        version: &str,
    ) -> Result<Option<PathBuf>, ClientError> {
        self.wall_cover_frame(account, version, None)
    }

    /// `wall_cover` in `frame`: `Compact`, `Medium` or `Expanded`, else
    /// `Invalid`.
    pub fn wall_cover_framed(
        &mut self,
        account: &str,
        version: &str,
        frame: Frame,
    ) -> Result<Option<PathBuf>, ClientError> {
        if FrameKind::Cover.size(frame).is_none() {
            return Err(ClientError::Invalid("a frame a cover has"));
        }
        self.wall_cover_frame(account, version, Some(frame))
    }

    fn wall_cover_dir(&self, account: &str) -> Result<PathBuf, ClientError> {
        id(account, "account id")?;
        Ok(self.media.join("walls").join(account).join("cover"))
    }

    fn wall_cover_frame(
        &mut self,
        account: &str,
        version: &str,
        frame: Option<Frame>,
    ) -> Result<Option<PathBuf>, ClientError> {
        let base = self.wall_cover_dir(account)?;
        let dir = frame_dir(base.clone(), frame);
        let found = self.kept_or_fetched(dir, version, |api, part| {
            api.get_wall_cover(account, frame, part)
        })?;
        if found.is_none() {
            forget_tree(&*self.blobs, &base);
        }
        Ok(found)
    }

    /// Frames this account's cover again from its master. The new version;
    /// `NoMaster` for one stored before masters were kept, `Invalid` for a
    /// framing the server would refuse. The frames kept here go.
    pub fn set_wall_cover_framing(&mut self, framing: &Framing) -> Result<String, ClientError> {
        if !framing.fits(FrameKind::Cover) {
            return Err(ClientError::Invalid("a framing the server would refuse"));
        }
        let version = authed(&self.transport, &self.token, &self.client)?
            .frame_wall_cover(framing)
            .map_err(framing_error)?;
        let me = self
            .store
            .try_write(|tx| Ok::<_, ClientError>(this_device(tx)?.1))?;
        let base = self.wall_cover_dir(&me.account)?;
        forget_tree(&*self.blobs, &base);
        Ok(version)
    }

    /// Writes the master of this account's cover to `to`, for the editor. False
    /// when it has none.
    pub fn wall_cover_source(&mut self, to: &Path) -> Result<bool, ClientError> {
        self.source_to(to, |api, part| api.get_wall_cover_source(part))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_bio_reads_as_one_trimmed_line_within_the_limit() {
        assert_eq!(clean_bio("  a\r\n\nb \n").unwrap(), "a b");
        assert_eq!(clean_bio(" \n ").unwrap(), "");
        let full = "þ".repeat(MAX_BIO);
        assert_eq!(clean_bio(&full).unwrap(), full);
        let over = format!("{full}þ");
        assert!(matches!(clean_bio(&over), Err(ClientError::Invalid(_))));
    }
}
