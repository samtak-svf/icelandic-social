//! Profile photos (0039): one per account, seen by every signed-in account
//! but across a block, and not end-to-end encrypted. The server re-encodes
//! each upload to one WebP and names it by a version that changes with every
//! new photo. This device keeps each account's latest in the media folder's
//! `photos/<account>/<version>.webp` and fetches it again only when the
//! version changes; the folder goes with the media files when the store is
//! forgotten.

use std::fs;
use std::path::{Path, PathBuf};

use crate::api::{ApiError, Transport};
use crate::members::store_photo;
use crate::{Client, ClientError, MediaError, authed, is_id, this_device};

/// The largest image the server takes as a photo, in bytes (0039).
pub const MAX_PHOTO: u64 = 10 * 1024 * 1024;

/// Removes every file in `dir` but `keep`. Gone already is fine; anything
/// else is tried again on the next fetch.
fn clear(dir: &Path, keep: Option<&Path>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if Some(path.as_path()) != keep {
            let _ = fs::remove_file(&path);
        }
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
            clear(&dir, None);
            let _ = fs::remove_dir(&dir);
        }
    }

    /// Sets this account's photo from the image at `path`, in place of any
    /// it had. The server re-encodes it to a 512 px WebP without the
    /// image's metadata, and keeps only that; this device fetches it back
    /// by the version returned, as anyone else does.
    pub fn set_photo(&mut self, path: &Path) -> Result<String, ClientError> {
        let size = fs::metadata(path).map_err(MediaError::from)?.len();
        if size == 0 {
            return Err(ClientError::Invalid("an empty photo"));
        }
        if size > MAX_PHOTO {
            return Err(ClientError::Invalid("a photo over 10 MB"));
        }
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

    /// The file of `account`'s photo at `version`, the version a `Person`,
    /// a post's author or `me` gave: kept from an earlier call, else
    /// fetched now in place of the version before it. None when the server
    /// has no such photo for this account, or a block withholds it; the
    /// kept files go then too, and a stored profile shows none.
    pub fn photo(&mut self, account: &str, version: &str) -> Result<Option<PathBuf>, ClientError> {
        let dir = self.photos_of(account)?;
        if !is_id(version) {
            return Err(ClientError::Invalid("photo version"));
        }
        let kept = dir.join(format!("{version}.webp"));
        if kept.exists() {
            return Ok(Some(kept));
        }
        fs::create_dir_all(&dir).map_err(MediaError::from)?;
        let part = dir.join(format!("{version}.part"));
        let fetched = authed(&self.transport, &self.token, &self.client)?.get_photo(account, &part);
        match fetched {
            Ok(()) => {
                fs::rename(&part, &kept).map_err(MediaError::from)?;
                clear(&dir, Some(&kept));
                Ok(Some(kept))
            }
            Err(ApiError::Refused { status: 404, .. }) => {
                self.forget_photo(account);
                self.store.try_write(|tx| store_photo(tx, account, None))?;
                Ok(None)
            }
            Err(error) => {
                let _ = fs::remove_file(&part);
                Err(error.into())
            }
        }
    }
}
