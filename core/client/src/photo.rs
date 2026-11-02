//! Profile photos (0039): one per account, seen by every signed-in account
//! but across a block, and not end-to-end encrypted. The server re-encodes
//! each upload to one WebP and names it by a version that changes with every
//! new photo. This device keeps each account's latest in the media folder's
//! `photos/<account>/<version>.webp` and fetches it again only when the
//! version changes; the folder goes with the media files when the store is
//! forgotten.
//!
//! Since 0086 a picture is framed by the person who sets it and the server
//! keeps one WebP per frame, so a fetch may name a frame: those are kept in
//! a folder per frame beside the unnamed ones, each holding only its latest
//! version. The master the editor reframes from is fetched to a path the app
//! gives and is not kept.

use std::path::{Path, PathBuf};

use crate::api::{Api, ApiError, Transport};
use crate::blobs::BlobStore;
use crate::frames::{Frame, FrameKind, Framing};
use crate::members::store_photo;
use crate::{Client, ClientError, MediaError, authed, is_id, this_device};

/// The largest image the server takes as a photo, in bytes (0039).
pub(crate) const MAX_PHOTO: u64 = crate::text::limits::IMAGE_BYTES;

/// Removes every file in `dir` but `keep`. Gone already is fine; anything
/// else is tried again on the next fetch.
fn clear(blobs: &dyn BlobStore, dir: &Path, keep: Option<&Path>) {
    let Ok(paths) = blobs.list_files(dir) else {
        return;
    };
    for path in paths {
        if Some(path.as_path()) != keep {
            let _ = blobs.remove_file(&path);
        }
    }
}

/// Removes every file in `dir` and in the folder of each frame under it
/// (0086), then the folders; the next fetch makes them again.
pub(crate) fn forget_tree(blobs: &dyn BlobStore, dir: &Path) {
    for frame in FRAMES {
        let sub = dir.join(frame.name());
        clear(blobs, &sub, None);
        let _ = blobs.remove_dir(&sub);
    }
    clear(blobs, dir, None);
    let _ = blobs.remove_dir(dir);
}

/// Every frame there is, for the folders to forget.
const FRAMES: [Frame; 4] = [
    Frame::Compact,
    Frame::Medium,
    Frame::Expanded,
    Frame::Square,
];

/// The server's refusal of a re-framing as the apps see it: `no_master` is
/// its own error, for the apps to say "upload it again" (0086).
pub(crate) fn framing_error(error: ApiError) -> ClientError {
    match error {
        ApiError::Refused {
            status: 409,
            ref code,
            ..
        } if code == "no_master" => ClientError::NoMaster,
        other => other.into(),
    }
}

impl<T: Transport> Client<T> {
    /// An account's folder of photos; the account id is checked first, so
    /// it never names a path outside the media folder.
    fn photos_of(&self, account: &str) -> Result<PathBuf, ClientError> {
        if !is_id(account) {
            return Err(ClientError::Invalid("account id"));
        }
        Ok(self.media.join("photos").join(account))
    }

    /// Deletes the photos kept for `account`: it has none now, or a block
    /// withholds it.
    pub(crate) fn forget_photo(&self, account: &str) {
        if let Ok(dir) = self.photos_of(account) {
            forget_tree(&*self.blobs, &dir);
        }
    }

    /// Refuses an image the server would: empty, or over 10 MB (0039, 0080).
    pub(crate) fn checked_image(&self, path: &Path) -> Result<(), ClientError> {
        let size = self.blobs.len(path).map_err(MediaError::from)?;
        if size == 0 {
            return Err(ClientError::Invalid("an empty photo"));
        }
        if size > MAX_PHOTO {
            return Err(ClientError::Invalid("a photo over 10 MB"));
        }
        Ok(())
    }

    /// Sets this account's photo from the image at `path`, in place of any
    /// it had. The server re-encodes it to a 512 px WebP without the
    /// image's metadata, and keeps only that; this device fetches it back
    /// by the version returned, as anyone else does.
    pub fn set_photo(&mut self, path: &Path) -> Result<String, ClientError> {
        self.checked_image(path)?;
        let version = authed(&self.transport, &self.token, &self.client)?.set_photo(path)?;
        let me = self
            .store
            .try_write(|tx| Ok::<_, ClientError>(this_device(tx)?.1))?;
        self.store
            .try_write(|tx| store_photo(tx, &me.account, Some(&version)))?;
        self.forget_photo(&me.account);
        Ok(version)
    }

    /// Removes this account's photo, on the server and here.
    pub fn remove_photo(&mut self) -> Result<(), ClientError> {
        authed(&self.transport, &self.token, &self.client)?.remove_photo()?;
        let me = self
            .store
            .try_write(|tx| Ok::<_, ClientError>(this_device(tx)?.1))?;
        self.store
            .try_write(|tx| store_photo(tx, &me.account, None))?;
        self.forget_photo(&me.account);
        Ok(())
    }

    /// Sets the framing of this account's photo (0086): the server cuts it
    /// again from its master. Returns the new version, which `photo_framed`
    /// fetches; the frames kept here are of the old one and go. `NoMaster`
    /// for a photo stored before masters were kept.
    pub fn set_photo_framing(&mut self, framing: &Framing) -> Result<String, ClientError> {
        if !framing.fits(FrameKind::Photo) {
            return Err(ClientError::Invalid("a framing the server would refuse"));
        }
        let version = authed(&self.transport, &self.token, &self.client)?
            .set_photo_frames(framing)
            .map_err(framing_error)?;
        let me = self
            .store
            .try_write(|tx| Ok::<_, ClientError>(this_device(tx)?.1))?;
        self.store
            .try_write(|tx| store_photo(tx, &me.account, Some(&version)))?;
        self.forget_photo(&me.account);
        Ok(version)
    }

    /// How this account's photo is framed, as the server stored it; none
    /// without a photo or for one stored before frames. Asked of the server
    /// each time, for the editor to open where the person left it.
    pub fn photo_framing(&mut self) -> Result<Option<Framing>, ClientError> {
        let me = self
            .store
            .try_write(|tx| Ok::<_, ClientError>(this_device(tx)?.1))?;
        let profile = authed(&self.transport, &self.token, &self.client)?.profile(&me.account)?;
        Ok(profile.photo_frames)
    }

    /// Writes the master of this account's photo to `to`, a path the app
    /// owns, for the editor to frame again (0086). False when it has none:
    /// no photo, or one stored before masters were kept.
    pub fn photo_source(&mut self, to: &Path) -> Result<bool, ClientError> {
        self.source_to(to, |api, part| api.get_photo_source(part))
    }

    /// Fetches through `fetch` into `part`, then renames it to `to`, so a
    /// failed download leaves nothing at `to`. `part` is gone either way.
    /// False on a 404, which leaves `to` as it was.
    fn fetch_into(
        &mut self,
        to: &Path,
        part: &Path,
        fetch: impl FnOnce(&Api<'_, T>, &Path) -> Result<(), ApiError>,
    ) -> Result<bool, ClientError> {
        let fetched = fetch(&authed(&self.transport, &self.token, &self.client)?, part);
        match fetched {
            Ok(()) => {
                self.blobs.rename(part, to).map_err(MediaError::from)?;
                Ok(true)
            }
            Err(error) => {
                let _ = self.blobs.remove_file(part);
                match error {
                    ApiError::Refused { status: 404, .. } => Ok(false),
                    other => Err(other.into()),
                }
            }
        }
    }

    /// Fetches into `to` through a `.part` file beside it, so a failed
    /// download leaves nothing at `to`. False on a 404.
    pub(crate) fn source_to(
        &mut self,
        to: &Path,
        fetch: impl FnOnce(&Api<'_, T>, &Path) -> Result<(), ApiError>,
    ) -> Result<bool, ClientError> {
        self.fetch_into(to, &to.with_extension("part"), fetch)
    }

    /// The file at `dir/<version>.webp`: kept from an earlier call, else
    /// fetched now through `fetch` in place of the versions before it. None
    /// when the server answered 404; the caller then decides what to forget.
    pub(crate) fn kept_or_fetched(
        &mut self,
        dir: PathBuf,
        version: &str,
        fetch: impl FnOnce(&Api<'_, T>, &Path) -> Result<(), ApiError>,
    ) -> Result<Option<PathBuf>, ClientError> {
        if !is_id(version) {
            return Err(ClientError::Invalid("photo version"));
        }
        let kept = dir.join(format!("{version}.webp"));
        if self.blobs.exists(&kept) {
            return Ok(Some(kept));
        }
        self.blobs.create_dir_all(&dir).map_err(MediaError::from)?;
        let part = dir.join(format!("{version}.part"));
        if !self.fetch_into(&kept, &part, fetch)? {
            return Ok(None);
        }
        clear(&*self.blobs, &dir, Some(&kept));
        Ok(Some(kept))
    }

    /// The file of `account`'s photo at `version`, the version a `Person`,
    /// a post's author or `me` gave: kept from an earlier call, else
    /// fetched now in place of the version before it. None when the server
    /// has no such photo for this account, or a block withholds it; the
    /// kept files go then too, and a stored profile shows none. This is the
    /// frame an app from before 0086 knows; `photo_framed` names one.
    pub fn photo(&mut self, account: &str, version: &str) -> Result<Option<PathBuf>, ClientError> {
        self.photo_frame(account, version, None)
    }

    /// `photo` for one frame (0086). A photo has one, `Square`; any other is
    /// `Invalid`. Kept under `photos/<account>/<frame>/<version>.webp`, each
    /// frame with only its latest version.
    pub fn photo_framed(
        &mut self,
        account: &str,
        version: &str,
        frame: Frame,
    ) -> Result<Option<PathBuf>, ClientError> {
        if FrameKind::Photo.size(frame).is_none() {
            return Err(ClientError::Invalid("a frame a photo has"));
        }
        self.photo_frame(account, version, Some(frame))
    }

    fn photo_frame(
        &mut self,
        account: &str,
        version: &str,
        frame: Option<Frame>,
    ) -> Result<Option<PathBuf>, ClientError> {
        let base = self.photos_of(account)?;
        let dir = frame_dir(base, frame);
        let found = self.kept_or_fetched(dir, version, |api, part| {
            api.get_photo(account, frame, part)
        })?;
        if found.is_none() {
            self.forget_photo(account);
            self.store.try_write(|tx| store_photo(tx, account, None))?;
        }
        Ok(found)
    }

    /// A community's folder for the picture (`cover` false) or the cover.
    fn community_dir(&self, community: &str, cover: bool) -> Result<PathBuf, ClientError> {
        if !is_id(community) {
            return Err(ClientError::Invalid("community id"));
        }
        let kind = if cover { "cover" } else { "avatar" };
        Ok(self.media.join("communities").join(community).join(kind))
    }

    /// The file of a community's picture (`cover` false) or cover at
    /// `version`, the version a `Community` gave: kept under
    /// `communities/<community>/{avatar|cover}/[<frame>/]<version>.webp`,
    /// fetched once per version (and frame) in place of the one before it.
    /// None when the community has none, or the reader may not see it; the
    /// kept files go then too (0080).
    pub(crate) fn community_image(
        &mut self,
        community: &str,
        cover: bool,
        version: &str,
        frame: Option<Frame>,
    ) -> Result<Option<PathBuf>, ClientError> {
        let base = self.community_dir(community, cover)?;
        let dir = frame_dir(base.clone(), frame);
        let found = self.kept_or_fetched(dir, version, |api, part| {
            if cover {
                api.get_community_cover(community, frame, part)
            } else {
                api.get_community_avatar(community, frame, part)
            }
        })?;
        if found.is_none() {
            forget_tree(&*self.blobs, &base);
        }
        Ok(found)
    }

    /// A community's picture at `version`; see `community_image` (0080).
    pub fn community_picture(
        &mut self,
        community: &str,
        version: &str,
    ) -> Result<Option<PathBuf>, ClientError> {
        self.community_image(community, false, version, None)
    }

    /// A community's cover at `version`; see `community_image` (0080). This
    /// is the frame an app from before 0086 knows, `Expanded`.
    pub fn community_cover(
        &mut self,
        community: &str,
        version: &str,
    ) -> Result<Option<PathBuf>, ClientError> {
        self.community_image(community, true, version, None)
    }

    /// A community's picture at `version` in `frame` (0086): `Square`, or
    /// `Invalid`.
    pub fn community_picture_framed(
        &mut self,
        community: &str,
        version: &str,
        frame: Frame,
    ) -> Result<Option<PathBuf>, ClientError> {
        if FrameKind::Photo.size(frame).is_none() {
            return Err(ClientError::Invalid("a frame a picture has"));
        }
        self.community_image(community, false, version, Some(frame))
    }

    /// A community's cover at `version` in `frame` (0086): `Compact`,
    /// `Medium` or `Expanded`, else `Invalid`. The app picks it by the
    /// window's width with `frame_for_width`.
    pub fn community_cover_framed(
        &mut self,
        community: &str,
        version: &str,
        frame: Frame,
    ) -> Result<Option<PathBuf>, ClientError> {
        if FrameKind::Cover.size(frame).is_none() {
            return Err(ClientError::Invalid("a frame a cover has"));
        }
        self.community_image(community, true, version, Some(frame))
    }

    /// Frames a community's picture again from its master (0086); its owner
    /// or a moderator. The new version; `NoMaster` for a picture stored
    /// before masters were kept, `Invalid` for a framing the server would
    /// refuse. The frames kept here are of the old version and go.
    pub fn set_community_picture_framing(
        &mut self,
        community: &str,
        framing: &Framing,
    ) -> Result<String, ClientError> {
        self.set_community_framing(community, false, framing)
    }

    /// `set_community_picture_framing` for the cover, with a rectangle of
    /// its own for any size class the person adjusted.
    pub fn set_community_cover_framing(
        &mut self,
        community: &str,
        framing: &Framing,
    ) -> Result<String, ClientError> {
        self.set_community_framing(community, true, framing)
    }

    fn set_community_framing(
        &mut self,
        community: &str,
        cover: bool,
        framing: &Framing,
    ) -> Result<String, ClientError> {
        let base = self.community_dir(community, cover)?;
        let kind = if cover {
            FrameKind::Cover
        } else {
            FrameKind::Photo
        };
        if !framing.fits(kind) {
            return Err(ClientError::Invalid("a framing the server would refuse"));
        }
        let api = authed(&self.transport, &self.token, &self.client)?;
        let version = if cover {
            api.set_community_cover_frames(community, framing)
        } else {
            api.set_community_avatar_frames(community, framing)
        }
        .map_err(framing_error)?;
        forget_tree(&*self.blobs, &base);
        Ok(version)
    }

    /// Writes the master of a community's picture to `to`, a path the app
    /// owns, for the editor (0086); its owner or a moderator. False when it
    /// has none.
    pub fn community_picture_source(
        &mut self,
        community: &str,
        to: &Path,
    ) -> Result<bool, ClientError> {
        self.community_source(community, false, to)
    }

    /// `community_picture_source` for the cover.
    pub fn community_cover_source(
        &mut self,
        community: &str,
        to: &Path,
    ) -> Result<bool, ClientError> {
        self.community_source(community, true, to)
    }

    fn community_source(
        &mut self,
        community: &str,
        cover: bool,
        to: &Path,
    ) -> Result<bool, ClientError> {
        self.community_dir(community, cover)?;
        self.source_to(to, |api, part| {
            api.get_community_source(community, cover, part)
        })
    }
}

/// Where the files of `frame` are kept under `base`: the folder itself for
/// the unnamed frame an app from before 0086 knows, a folder of the frame's
/// name otherwise, so each frame keeps its own latest version.
pub(crate) fn frame_dir(base: PathBuf, frame: Option<Frame>) -> PathBuf {
    frame.map_or(base.clone(), |f| base.join(f.name()))
}
